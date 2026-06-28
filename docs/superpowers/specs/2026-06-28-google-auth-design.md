# PRD 3 — Google sign-in (auth gateway)

**Status:** Proposed (awaiting implementation plan)
**Depends on:** nothing client-side; required by PRD 2 (extraction) to gate `/api/extract`.
**Scope:** a single feature with a server component.

## 1. Problem

PRD 2 introduces a server endpoint that fetches arbitrary URLs and runs an LLM. That endpoint
costs money per call and must not be open to the internet. We need a way for the app to know who
is calling and to allow only authorized users — without storing any user data server-side, since
the device remains the source of truth for recipes (per the local-first constraint in PRD 0).

## 2. Goal

Provide a "Sign in with Google" flow on the page that mints an auth token the browser can use to
call protected web APIs (extraction). No database, no server-side user records, no session store.

## 3. User stories

- As the app owner, I want only people I authorize (an email whitelist) to use the extraction API,
  so randoms can't burn my Workers AI budget.
- As a user, I sign in with Google once; afterwards "Import from URL" just works without
  re-prompting for the session lifetime.
- As a user, I can sign out, and the rest of the app (recipes, pantry, cart) keeps working
  offline.

## 4. Out of scope (YAGNI)

- No user database, no profile storage, no per-user server state.
- No roles/permissions beyond the single email whitelist.
- No refresh-token / long-lived offline access. Sessions expire; the user re-signs-in.
- No other identity providers (only Google).
- No multi-account switching.

## 5. Architecture

**Local-first, stateless auth.** Google Identity Services (GIS) runs in the browser; a Cloudflare
Worker verifies Google's token and mints its own short-lived session token. No server-side store.

```
1. Browser → Google Identity Services → Google ID token (JWT, signed by Google)
2. Browser → POST /api/auth { idToken }
3. Worker: verify Google signature (JWKS, cached) → read sub + email_verified + email
4. Worker: email ∈ ALLOWED_EMAILS?  → mint Worker-signed session JWT (sub, email, exp)
5. Browser stores session JWT; sends Authorization: Bearer on /api/extract
6. Worker validates its own session JWT on each protected request
7. Sign-out: browser discards the token
```

## 6. API

### 6.1 `POST /api/auth` (no auth required)
- **Request:** `{ "idToken": "<Google ID token>" }`.
- **Response (success):** `{ "token": "<session JWT>", "email": "<user email>", "expiresAt": <epoch seconds> }`.
- **Response (error):** `{ "error": "<code>" }`.
  - `400` missing/empty `idToken`.
  - `401` token signature invalid, expired, or wrong `iss`/`aud`.
  - `403` email not on the whitelist, or `email_verified` is false.

### 6.2 Protected endpoints (e.g. `/api/extract`)
- Require `Authorization: Bearer <session JWT>`.
- Worker validates: signature (`SESSION_SECRET`), `exp` not passed, `iss` == this Worker. On
  failure → `401`.

## 7. Worker configuration (env vars / secrets)

- `GOOGLE_CLIENT_ID` — the OAuth client ID; used to verify the ID token's `aud` claim.
- `ALLOWED_EMAILS` — comma-separated whitelist, e.g. `"you@example.com,friend@example.com"`. The
  gate that protects the extraction budget.
- `SESSION_SECRET` — high-entropy secret used to sign session JWTs (HS256) or the private key
  (RS256). v1 uses HS256 for simplicity.
- `SESSION_TTL` — session lifetime in seconds (default `604800` = 7 days).
- `APP_ORIGIN` — the frontend origin, used to set CORS / restrict token use.

## 8. Token details

### 8.1 Google ID token verification (`/api/auth`)
- Fetch and **cache** Google's public JWKS (`https://www.googleapis.com/oauth2/v3/certs`) with a
  TTL (e.g. 1 hour) to avoid fetching on every request.
- Verify: signature against the matching key (`kid`), `iss` == `https://accounts.google.com`
  (or the accounts.google.com issuer for the token), `aud` == `GOOGLE_CLIENT_ID`, `exp` not
  passed, `email_verified` == true.
- Read `sub` (stable Google user ID) and `email`.

### 8.2 Session JWT (Worker-signed)
- Payload: `{ sub, email, iat, exp }`, signed with `SESSION_SECRET` (HS256).
- Short-lived (`SESSION_TTL`). The browser stores it at `cb_token` (new localStorage key) and
  sends it as a Bearer token.
- The Worker is stateless: it validates the token purely from the signature + `exp`; there is no
  revocation list in v1. Sign-out is client-side (discard the token). If a session must be
  invalidated, rotate `SESSION_SECRET` (invalidates all sessions).

## 9. Frontend integration

- A **"Sign in with Google"** button (Google Identity Services, `accounts.google.com/gsi/client`).
  - Visible in the nav/topbar (e.g. where Import/Export live) or near the "Import from URL"
    affordance.
  - When signed in: show the signed-in email + a "Sign out" control; reveal the URL-extract UI
    (PRD 2).
  - When signed out: "Import from URL" shows "Sign in to import from a URL."
- Token storage: `cb_token` (string). On load, `load()` reads it; if `exp` has passed, discard.
- Sign-out: clear `cb_token`, update UI. Recipes/pantry/cart untouched.
- **Local-first invariant:** sign-in is **only** required for URL extraction. All other features
  work offline and signed-out exactly as today.

## 10. Security

- ID tokens are verified server-side; the browser never receives trust solely on its own say-so.
- `email_verified` must be true before accepting an email.
- The whitelist is the authoritative gate; it is checked server-side on every `/api/auth`, not in
  the browser.
- Session JWTs are signed with `SESSION_SECRET`; a compromised browser token can't be forged.
- CORS: the Worker only accepts requests from `APP_ORIGIN`.
- No cookies are used for the session (avoids CSRF surface); the token is an `Authorization`
  header chosen by the app. (If cookies are later preferred, add CSRF protection.)
- Rate-limit `/api/auth` to deter token-bombarding attempts.

## 11. Deployment

- The Worker is deployed alongside the extraction API (PRD 2). Recommended: Cloudflare Pages +
  Worker same-origin (see PRD 2 §11). The same Worker hosts `/api/auth` and `/api/extract`.
- `GOOGLE_CLIENT_ID` may be exposed to the browser (it is not secret); it is needed for GIS.
  `SESSION_SECRET` and `ALLOWED_EMAILS` stay server-side only.

## 12. Testing

- **Pure logic unit-tested under Node** where feasible:
  - Whitelist matching (`email ∈ ALLOWED_EMAILS`, case-insensitive, trimmed).
  - Session JWT sign + verify round-trip; expired-token rejection; wrong-`iss` rejection;
    tampered-payload rejection.
  - (Google JWKS verification is exercised with fixture tokens/keys where practical; live JWKS
    fetch is integration.)
- **Integration/manual:** full Google sign-in → `/api/auth` → `/api/extract` flow with a real
  whitelisted account.

## 13. Acceptance criteria

1. A whitelisted user can sign in with Google and receive a session token; non-whitelisted emails
   get `403`.
2. `/api/extract` (PRD 2) rejects calls without a valid session token (`401`).
3. Sessions expire per `SESSION_TTL`; expired tokens are rejected.
4. Sign-out clears the token; the app remains usable offline for all non-extraction features.
5. `SESSION_SECRET` rotation invalidates outstanding sessions.
6. The rest of the app works signed-out exactly as before this feature.