# Google Sign-in (Auth Gateway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sign in with Google" flow on the page that mints a server-signed session token, used to gate protected web APIs (the extraction endpoint in the next plan). No database, no server-side user records.

**Architecture:** The backend is **Cloudflare Pages Functions** on the existing `cookbook` Pages project (git-connected, already serving the static frontend same-origin at `cookbook-2ie.pages.dev`). Auth lives in `functions/api/auth.js` (same-origin `/api/auth`, no CORS). Auth is stateless: the browser gets a Google-signed ID token (Google Identity Services), the Function verifies it (JWKS), checks an email whitelist, and mints a short-lived HS256 session JWT. Worker/Function logic is factored into pure, dependency-injected modules under `functions/_lib/` so it tests under Node's built-in runner with no Workers runtime. The frontend gains a Google button + token storage; the rest of the app keeps working signed-out.

**Tech Stack:** Cloudflare Pages Functions (Workers runtime, Web APIs), `jose` for JWT (HS256 session + RS256 Google ID token), Node built-in test runner, Node ≥ 18. Frontend: native ES modules, Google Identity Services.

## Why Pages Functions (not a standalone Worker)

The `cookbook` Pages project is already git-connected and serving the frontend. Adding a `functions/` directory makes Cloudflare build and serve Functions on the same origin automatically — `/api/auth` is same-origin with the SPA, so there is **no CORS, no `APP_ORIGIN`, no second deployment, no `window.COOKBOOK_API` cross-origin dev config**. One project, one deploy, one origin. This also means PRD 2's extraction Function (`functions/api/extract.js`) will share the same origin and the same Workers AI binding when that plan runs.

## Global Constraints

- The frontend (`docs/`) stays zero-dependency. New frontend code is plain ES modules using the existing `lib/` helpers (`$`, `els`, `toast`, `esc`). The frontend never imports `jose`.
- `jose` is a root `package.json` dependency (used only by `functions/_lib/`). It is bundled into the Functions, never shipped to the browser.
- Function logic that can be pure MUST be pure and dependency-injected so it runs under `node --test` without the Workers runtime. Pure modules live in `functions/_lib/`; they never import `cloudflare:...` or touch `Request`/`Response`.
- `SESSION_SECRET` is a Pages **secret** (set via `wrangler pages secret put SESSION_SECRET --project-name cookbook`, or the dashboard), never committed. `GOOGLE_CLIENT_ID` and `ALLOWED_EMAILS` are non-secret vars.
- Sign-in is only required to call protected APIs. All other app features work offline and signed-out exactly as today (PRD 0 invariant).
- Auth state on the client lives in `localStorage` keys `cb_token` and `cb_email`.
- Follow the existing file header comment style in frontend files.
- No `Buffer` (avoid `nodejs_compat`): use `atob` + `TextDecoder` for any base64url decoding so code runs identically in Node tests and the Workers runtime.

---

## File Structure

Pages Functions (new, in the existing repo — the git-connected `cookbook` Pages project picks up `functions/` automatically on the next deploy):
- **Modify** root `package.json` — add `jose` dependency, a `dev` script (`wrangler pages dev docs`), `wrangler` devDependency.
- **Create** root `wrangler.toml` — Pages config for local dev + non-secret vars source of truth.
- **Create** `functions/_lib/whitelist.js` — `isAllowed(email, allowedCsv)`.
- **Create** `functions/_lib/session.js` — `signSession(claims, secret, ttlSec)`, `verifySession(token, secret)`.
- **Create** `functions/_lib/google.js` — `makeJwksGetter(jwksUrl)` (cached fetch), `verifyIdToken(idToken, clientId, getKey)`.
- **Create** `functions/_lib/handler.js` — pure `handleAuth(body, env, deps)` and `authorize(req, env, deps)`; injectable deps for testing.
- **Create** `functions/_lib/http.js` — `json(status, body)` Response helper (shared by the entry + middleware; not unit-tested, trivial).
- **Create** `functions/api/auth.js` — `onRequestPost(context)` wiring real deps to `handleAuth`, returns JSON.
- **Create** `functions/api/_middleware.js` — gates all `/api/*` except `/api/auth` with `authorize`.
- **Create** `test/auth-whitelist.test.js`, `test/auth-session.test.js`, `test/auth-google.test.js`, `test/auth-handler.test.js` (discovered by the existing `node --test` run).

Frontend:
- **Create** `docs/js/lib/auth.js` — GIS loader, sign-in button render, token exchange, storage, sign-out, `authFetch`.
- **Modify** `docs/index.html` — a sign-in/sign-out affordance in the sidebar; expose `window.COOKBOOK_GOOGLE_CLIENT_ID`.
- **Modify** `docs/js/app.js` — render signed-in state, wire sign-in/sign-out.
- **Modify** `docs/css/styles.css` — minimal auth styles.

Config/CI:
- **Modify** `.github/workflows/test.yml` — add an `npm install` step before `npm test` (now that `jose` is a real dependency CI must install).

Production environment (manual / MCP, not code):
- Set `GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`, `SESSION_TTL` (vars) and `SESSION_SECRET` (secret) on the existing `cookbook` Pages project. Done via `wrangler pages secret put` / dashboard / Cloudflare MCP after the code lands. Documented in Task 8.

---

### Task 1: Add `jose` dependency + whitelist module (TDD)

**Files:**
- Modify: `package.json`
- Create: `functions/_lib/whitelist.js`
- Create: `test/auth-whitelist.test.js`

**Interfaces:**
- Produces: `isAllowed(email: string, allowedCsv: string) => boolean` — case-insensitive, whitespace-trimmed match of `email` against a comma-separated list. Empty `allowedCsv` → `false` (deny by default).

- [ ] **Step 1: Add the dependency + dev script to the root package**

Modify `package.json` (keep the existing `"test": "node --test"`; add deps/scripts):

```json
{
  "name": "cookbook",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "dev": "wrangler pages dev docs"
  },
  "dependencies": {
    "jose": "^5.9.6"
  },
  "devDependencies": {
    "wrangler": "^3.90.0"
  },
  "engines": { "node": ">=18" }
}
```

Then install: `npm install`

- [ ] **Step 2: Write the failing test**

Create `test/auth-whitelist.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../functions/_lib/whitelist.js';

test('isAllowed matches a listed email case-insensitively', () => {
  assert.equal(isAllowed('You@Example.com', 'you@example.com,Friend@example.com'), true);
  assert.equal(isAllowed('friend@EXAMPLE.com', 'you@example.com,Friend@example.com'), true);
});

test('isAllowed trims whitespace around entries and the input', () => {
  assert.equal(isAllowed(' you@example.com ', ' you@example.com , friend@example.com '), true);
});

test('isAllowed denies emails not on the list', () => {
  assert.equal(isAllowed('stranger@example.com', 'you@example.com'), false);
});

test('isAllowed denies when the list is empty or missing', () => {
  assert.equal(isAllowed('you@example.com', ''), false);
  assert.equal(isAllowed('you@example.com', undefined), false);
  assert.equal(isAllowed('you@example.com', null), false);
});

test('isAllowed denies malformed input', () => {
  assert.equal(isAllowed('', 'you@example.com'), false);
  assert.equal(isAllowed(null, 'you@example.com'), false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/whitelist.js'`.

- [ ] **Step 4: Implement the whitelist**

Create `functions/_lib/whitelist.js`:

```js
// ════════════════════════════════════════════════════════
// whitelist.js — email allow-list gate (pure, no DOM/Workers)
// ════════════════════════════════════════════════════════

/**
 * True if email is in the comma-separated allow list (case-insensitive,
 * whitespace-trimmed). Empty/missing list or email → false (deny by default).
 * @param {string} email
 * @param {string} allowedCsv
 * @returns {boolean}
 */
export function isAllowed(email, allowedCsv) {
  if (typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  if (!e) return false;
  if (typeof allowedCsv !== 'string' || !allowedCsv.trim()) return false;
  const list = allowedCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(e);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all auth-whitelist tests green; existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json functions/_lib/whitelist.js test/auth-whitelist.test.js
git commit -m "feat(auth): add jose dep + email whitelist gate with tests"
```

---

### Task 2: Session JWT sign/verify with `jose` (TDD)

**Files:**
- Create: `functions/_lib/session.js`
- Create: `test/auth-session.test.js`

**Interfaces:**
- Produces:
  - `signSession({ sub, email }, secret, ttlSec) => Promise<string>` — HS256 JWT with `iss: 'cookbook-api'`, `iat`, `exp = iat + ttlSec`, payload `{ sub, email }`.
  - `verifySession(token, secret) => Promise<{ sub, email } | null>` — returns the claims if signature valid, `iss` matches, and not expired; `null` otherwise.

- [ ] **Step 1: Write the failing test**

Create `test/auth-session.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from '../functions/_lib/session.js';

const SECRET = 'test-secret-please-change-in-prod-32+chars';

test('signSession + verifySession round-trip the claims', async () => {
  const token = await signSession({ sub: '123', email: 'a@b.com' }, SECRET, 3600);
  const claims = await verifySession(token, SECRET);
  assert.deepEqual(claims, { sub: '123', email: 'a@b.com' });
});

test('verifySession rejects a token signed with a different secret', async () => {
  const token = await signSession({ sub: '123', email: 'a@b.com' }, SECRET, 3600);
  const claims = await verifySession(token, 'wrong-secret');
  assert.equal(claims, null);
});

test('verifySession rejects an expired token', async () => {
  // ttl 0 → already expired
  const token = await signSession({ sub: '123', email: 'a@b.com' }, SECRET, 0);
  const claims = await verifySession(token, SECRET);
  assert.equal(claims, null);
});

test('verifySession rejects garbage', async () => {
  assert.equal(await verifySession('not-a-jwt', SECRET), null);
  assert.equal(await verifySession('', SECRET), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/session.js'`.

- [ ] **Step 3: Implement session JWT**

Create `functions/_lib/session.js`:

```js
// ════════════════════════════════════════════════════════
// session.js — server-signed HS256 session JWT (pure, uses jose)
// ════════════════════════════════════════════════════════

import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'cookbook-api';

/**
 * Mint a session JWT for the given user. TTL is in seconds.
 * @param {{sub:string, email:string}} claims
 * @param {string} secret
 * @param {number} ttlSec
 * @returns {Promise<string>}
 */
export async function signSession({ sub, email }, secret, ttlSec) {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ sub, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(`${ttlSec} s`)
    .sign(key);
}

/**
 * Verify a session JWT. Returns the claims on success, null on any failure
 * (bad signature, wrong issuer, expired, malformed).
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<{sub:string,email:string}|null>}
 */
export async function verifySession(token, secret) {
  if (typeof token !== 'string' || !token) return null;
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/session.js test/auth-session.test.js
git commit -m "feat(auth): HS256 session JWT sign/verify via jose"
```

---

### Task 3: Google ID token verification (TDD with a fixture RSA key)

**Files:**
- Create: `functions/_lib/google.js`
- Create: `test/auth-google.test.js`

**Interfaces:**
- Produces:
  - `verifyIdToken(idToken, clientId, getKey) => Promise<{ sub, email, email_verified } | null>` — verifies the Google ID token's signature using `getKey(kid) => Promise<CryptoKey|KeyLike|JWK>`, checks `iss` (`https://accounts.google.com`), `aud` == `clientId`, `exp`, and `email_verified === true`. Returns the claims on success, `null` on any failure.
  - `makeJwksGetter(jwksUrl) => (kid) => Promise<CryptoKey>` — production key getter that fetches Google's JWKS (cached) and returns the key matching `kid`. Used only by the Function entry, not by the unit tests (tests inject a fixture key getter).

- [ ] **Step 1: Write the failing test**

Create `test/auth-google.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importPKCS8, SignJWT, exportJWK } from 'jose';
import crypto from 'node:crypto';
import { verifyIdToken } from '../functions/_lib/google.js';

async function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const priv = await importPKCS8(pkcs8, { alg: 'RS256' });
  const pubJwk = await exportJWK(publicKey);
  return { priv, pubJwk };
}

test('verifyIdToken returns claims for a valid Google ID token', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt()
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const getKey = async () => pubJwk; // tests ignore kid; return the fixture key
  const claims = await verifyIdToken(token, 'client-123', getKey);
  assert.deepEqual(claims, { sub: 'g-123', email: 'you@example.com', email_verified: true });
});

test('verifyIdToken rejects wrong audience', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const claims = await verifyIdToken(token, 'wrong-client', async () => pubJwk);
  assert.equal(claims, null);
});

test('verifyIdToken rejects unverified email', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: false })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const claims = await verifyIdToken(token, 'client-123', async () => pubJwk);
  assert.equal(claims, null);
});

test('verifyIdToken rejects garbage', async () => {
  const claims = await verifyIdToken('not-a-token', 'client-123', async () => (await makeKeyPair()).pubJwk);
  assert.equal(claims, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/google.js'`.

- [ ] **Step 3: Implement Google ID token verification**

Create `functions/_lib/google.js` (uses `atob` + `TextDecoder` — no `Buffer`, so it runs identically in Node tests and the Workers runtime without `nodejs_compat`):

```js
// ════════════════════════════════════════════════════════
// google.js — Google ID token verification (RS256 via jose)
// ════════════════════════════════════════════════════════

import { jwtVerify, importJWK, createRemoteJWKSet } from 'jose';

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function base64UrlDecode(str) {
  // base64url → bytes, using only Web APIs available in Node ≥16 and Workers.
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Verify a Google ID token and return its claims, or null on any failure.
 * getKey(kid) supplies the public key (in production, the cached Google JWKS;
 * in tests, a fixture key). Requires email_verified === true.
 * @param {string} idToken
 * @param {string} clientId expected `aud`
 * @param {(kid:string)=>Promise<CryptoKey|object>} getKey returns a key/JWK
 * @returns {Promise<{sub:string,email:string,email_verified:boolean}|null>}
 */
export async function verifyIdToken(idToken, clientId, getKey) {
  if (typeof idToken !== 'string' || !idToken) return null;
  // peek at the header to get kid without verifying
  let kid = '';
  try {
    const header = JSON.parse(base64UrlDecode(idToken.split('.')[0]));
    kid = header.kid || '';
  } catch {
    return null;
  }
  let key;
  try {
    key = await getKey(kid);
    // accept a raw JWK object by importing it
    if (key && typeof key === 'object' && !(key instanceof CryptoKey) && key.kty) {
      key = await importJWK(key);
    }
  } catch {
    return null;
  }
  try {
    const { payload } = await jwtVerify(idToken, key, {
      issuer: ISSUERS,
      audience: clientId,
    });
    if (payload.email_verified !== true) return null;
    return { sub: payload.sub, email: payload.email, email_verified: true };
  } catch {
    return null;
  }
}

/**
 * Build a cached JWKS key getter for production. Fetches once, then returns
 * the key matching `kid`. Not used by unit tests (they inject a fixture key).
 * @param {string} jwksUrl
 * @returns {(kid:string)=>Promise<CryptoKey>}
 */
export function makeJwksGetter(jwksUrl) {
  const set = createRemoteJWKSet(new URL(jwksUrl));
  return async (kid) => set.getKey({ kid });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/google.js test/auth-google.test.js
git commit -m "feat(auth): verify Google ID tokens (RS256) with injectable key"
```

---

### Task 4: Pure auth handler (TDD with injected fakes)

**Files:**
- Create: `functions/_lib/handler.js`
- Create: `test/auth-handler.test.js`

**Interfaces:**
- Produces:
  - `handleAuth({ idToken }, env, deps) => Promise<{ status: number, body: object }>` where `deps = { verifyIdToken, signSession, isAllowed }`. Verifies the ID token, checks the whitelist, mints a session. Returns `{ status: 200, body: { token, email, expiresAt } }` on success; `{ status: 401, body: { error } }` bad token; `{ status: 403, body: { error } }` not whitelisted / unverified email; `{ status: 400, body: { error } }` missing idToken.
  - `authorize(req, env, deps) => Promise<{ ok: true, claims } | { ok: false, status: number, body: object }>` — reads `Authorization: Bearer`, calls `verifySession`, returns claims or a 401 error envelope.

- [ ] **Step 1: Write the failing test**

Create `test/auth-handler.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuth, authorize } from '../functions/_lib/handler.js';

const env = {
  GOOGLE_CLIENT_ID: 'client-123',
  ALLOWED_EMAILS: 'you@example.com',
  SESSION_SECRET: 'secret-32-chars-min-aaaaaaaaaaaaa',
  SESSION_TTL: '3600',
};

const goodDeps = {
  verifyIdToken: async () => ({ sub: 'g-1', email: 'you@example.com', email_verified: true }),
  signSession: async () => 'session-jwt-xyz',
  isAllowed: (email, list) => email === 'you@example.com' && list === env.ALLOWED_EMAILS,
  verifySession: async (t) => (t === 'session-jwt-xyz' ? { sub: 'g-1', email: 'you@example.com' } : null),
};

test('handleAuth mints a session for a whitelisted user', async () => {
  const res = await handleAuth({ idToken: 'tok' }, env, goodDeps);
  assert.equal(res.status, 200);
  assert.equal(res.body.token, 'session-jwt-xyz');
  assert.equal(res.body.email, 'you@example.com');
  assert.ok(res.body.expiresAt > 0);
});

test('handleAuth 401 when the Google token is invalid', async () => {
  const deps = { ...goodDeps, verifyIdToken: async () => null };
  const res = await handleAuth({ idToken: 'bad' }, env, deps);
  assert.equal(res.status, 401);
});

test('handleAuth 403 when email is not whitelisted', async () => {
  const deps = { ...goodDeps, verifyIdToken: async () => ({ sub: 'g-2', email: 'stranger@example.com', email_verified: true }) };
  const res = await handleAuth({ idToken: 'tok' }, env, deps);
  assert.equal(res.status, 403);
});

test('handleAuth 400 when idToken missing', async () => {
  const res = await handleAuth({}, env, goodDeps);
  assert.equal(res.status, 400);
});

test('authorize accepts a valid Bearer token', async () => {
  const req = { headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer session-jwt-xyz' : null) } };
  const res = await authorize(req, env, goodDeps);
  assert.equal(res.ok, true);
  assert.equal(res.claims.email, 'you@example.com');
});

test('authorize 401 when no Authorization header', async () => {
  const req = { headers: { get: () => null } };
  const res = await authorize(req, env, goodDeps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test('authorize 401 when token invalid', async () => {
  const req = { headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer nope' : null) } };
  const res = await authorize(req, env, goodDeps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/handler.js'`.

- [ ] **Step 3: Implement the pure handler**

Create `functions/_lib/handler.js`:

```js
// ════════════════════════════════════════════════════════
// handler.js — pure request handlers (deps injected for testing)
// ════════════════════════════════════════════════════════

const DEFAULT_TTL = 604800; // 7 days

/**
 * Handle POST /api/auth. Returns a { status, body } envelope (no Response, so
 * it is unit-testable without the Workers runtime).
 * @param {{idToken?:string}} body
 * @param {object} env GOOGLE_CLIENT_ID, ALLOWED_EMAILS, SESSION_SECRET, SESSION_TTL
 * @param {object} deps verifyIdToken, signSession, isAllowed
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleAuth(body, env, deps) {
  const idToken = body && typeof body === 'object' ? body.idToken : undefined;
  if (typeof idToken !== 'string' || !idToken) {
    return { status: 400, body: { error: 'missing_id_token' } };
  }
  const claims = await deps.verifyIdToken(idToken, env.GOOGLE_CLIENT_ID);
  if (!claims || claims.email_verified !== true) {
    return { status: 401, body: { error: 'invalid_id_token' } };
  }
  if (!deps.isAllowed(claims.email, env.ALLOWED_EMAILS)) {
    return { status: 403, body: { error: 'not_allowed' } };
  }
  const ttl = Number(env.SESSION_TTL) || DEFAULT_TTL;
  const token = await deps.signSession({ sub: claims.sub, email: claims.email }, env.SESSION_SECRET, ttl);
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  return { status: 200, body: { token, email: claims.email, expiresAt } };
}

/**
 * Authorize a protected request via its Bearer token. Returns either
 * { ok: true, claims } or { ok: false, status, body }.
 * @param {object} req with headers.get(name)
 * @param {object} env SESSION_SECRET
 * @param {object} deps verifySession
 * @returns {Promise<object>}
 */
export async function authorize(req, env, deps) {
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return { ok: false, status: 401, body: { error: 'missing_token' } };
  const claims = await deps.verifySession(m[1], env.SESSION_SECRET);
  if (!claims) return { ok: false, status: 401, body: { error: 'invalid_token' } };
  return { ok: true, claims };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all handler tests green.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/handler.js test/auth-handler.test.js
git commit -m "feat(auth): pure handleAuth + authorize with injected deps"
```

---

### Task 5: Pages Function entry, middleware, wrangler config

**Files:**
- Create: `functions/_lib/http.js`
- Create: `functions/api/auth.js`
- Create: `functions/api/_middleware.js`
- Create: `wrangler.toml`

**Interfaces:**
- Produces:
  - `functions/api/auth.js` exports `onRequestPost(context)` → POST `/api/auth` (public, no auth): parse JSON body, call `handleAuth(body, env, deps)` with real deps, return JSON Response.
  - `functions/api/_middleware.js` exports `onRequest(context)` → runs for all `/api/*`; lets `/api/auth` pass through, otherwise requires `authorize` (returns 401 JSON on failure). Extraction (`/api/extract`) is added in the next plan; until then an authenticated but unmatched `/api/*` route returns Pages' default 404.
  - `wrangler.toml` — Pages config for local dev + non-secret vars.

- [ ] **Step 1: Create the shared JSON Response helper**

Create `functions/_lib/http.js`:

```js
// ════════════════════════════════════════════════════════
// http.js — tiny JSON Response helper for Pages Functions
// ════════════════════════════════════════════════════════

/**
 * Build a JSON Response. Same-origin API, so no CORS headers are needed.
 * @param {number} status
 * @param {object} body
 * @returns {Response}
 */
export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
```

- [ ] **Step 2: Create the auth Function**

Create `functions/api/auth.js`:

```js
// ════════════════════════════════════════════════════════
// auth.js — POST /api/auth : verify Google ID token, mint session
// ════════════════════════════════════════════════════════

import { handleAuth } from '../_lib/handler.js';
import { verifyIdToken, makeJwksGetter } from '../_lib/google.js';
import { signSession } from '../_lib/session.js';
import { isAllowed } from '../_lib/whitelist.js';
import { json } from '../_lib/http.js';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const keyGetter = makeJwksGetter(GOOGLE_JWKS);

const deps = {
  verifyIdToken: (idToken, clientId) => verifyIdToken(idToken, clientId, keyGetter),
  signSession,
  isAllowed,
};

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }
  const { status, body: out } = await handleAuth(body, env, deps);
  return json(status, out);
}
```

- [ ] **Step 3: Create the /api/* middleware (gates everything except /api/auth)**

Create `functions/api/_middleware.js`:

```js
// ════════════════════════════════════════════════════════
// _middleware.js — gate /api/* with a session token (skip /api/auth)
// ════════════════════════════════════════════════════════

import { authorize } from '../_lib/handler.js';
import { verifySession } from '../_lib/session.js';
import { json } from '../_lib/http.js';

const deps = { verifySession };

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  // /api/auth is the only public route; everything else under /api/* needs auth.
  if (url.pathname === '/api/auth') return next();
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return json(auth.status, auth.body);
  return next();
}
```

- [ ] **Step 4: Create the wrangler config (local dev + non-secret vars source of truth)**

Create `wrangler.toml`:

```toml
name = "cookbook"
pages_build_output_dir = "docs"
compatibility_date = "2025-09-01"

# Non-secret config. Set SESSION_SECRET separately:
#   local dev:  create a `.dev.vars` file with `SESSION_SECRET="<32+ char random>"`
#   production: wrangler pages secret put SESSION_SECRET --project-name cookbook
[vars]
GOOGLE_CLIENT_ID = "replace-me.apps.googleusercontent.com"
ALLOWED_EMAILS = "you@example.com"
SESSION_TTL = "604800"
```

- [ ] **Step 5: Verify the suite still passes**

Run: `npm test`
Expected: PASS (the entry/middleware/http modules are not unit-tested here — they are thin wiring verified by the smoke test in Task 7; the pure logic they call is covered by Tasks 1–4).

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/http.js functions/api/auth.js functions/api/_middleware.js wrangler.toml
git commit -m "feat(auth): Pages Function entry + /api/* middleware + wrangler config"
```

---

### Task 6: Frontend auth module — GIS sign-in, token storage, sign-out

**Files:**
- Create: `docs/js/lib/auth.js`

**Interfaces:**
- Produces:
  - `API_BASE` (constant) — `window.COOKBOOK_API || '/api'` (same-origin `/api` in both dev and prod; the override exists only for exotic setups).
  - `loadAuth() => { token, email }` — reads `cb_token`/`cb_email` from localStorage.
  - `saveAuth(token, email)` / `clearAuth()`.
  - `getToken() => string|null`.
  - `authFetch(path, init) => Promise<Response>` — fetch with `Authorization: Bearer` if a token exists.
  - `initGoogleSignIn({ buttonEl, clientId, onSignedIn, onError })` — loads GIS, renders the button, on credential POSTs to `/api/auth`, stores token/email, calls `onSignedIn(email)`.

- [ ] **Step 1: Implement the auth module**

Create `docs/js/lib/auth.js`:

```js
// ════════════════════════════════════════════════════════
// auth.js — Google sign-in + session token storage (no DOM beyond GIS)
// ════════════════════════════════════════════════════════

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'cb_token';
const EMAIL_KEY = 'cb_email';

/** API base: same-origin ('/api') in dev and prod; override only if needed. */
export const API_BASE = (typeof window !== 'undefined' && window.COOKBOOK_API) || '/api';

let gsiPromise = null;
function loadGsi() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/** Read persisted auth state. */
export function loadAuth() {
  return {
    token: localStorage.getItem(TOKEN_KEY) || '',
    email: localStorage.getItem(EMAIL_KEY) || '',
  };
}

/** Persist token + email. */
export function saveAuth(token, email) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

/** Clear persisted auth state (sign-out). */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

/** Current session token, or null. */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

/** fetch wrapper that attaches the Bearer token when present. */
export async function authFetch(path, init = {}) {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/**
 * Render a "Sign in with Google" button. On success, exchange the Google ID
 * token for a session token via /api/auth, persist it, and call onSignedIn.
 * @param {object} opts buttonEl, clientId, onSignedIn(email), onError(msg)
 */
export async function initGoogleSignIn({ buttonEl, clientId, onSignedIn, onError }) {
  try {
    const g = await loadGsi();
    g.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        if (!resp.credential) { onError?.('No credential returned'); return; }
        try {
          const res = await fetch(`${API_BASE}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: resp.credential }),
          });
          const data = await res.json();
          if (!res.ok) { onError?.(data.error || 'auth_failed'); return; }
          saveAuth(data.token, data.email);
          onSignedIn?.(data.email);
        } catch (e) {
          onError?.(e.message || 'network');
        }
      },
    });
    g.accounts.id.renderButton(buttonEl, { type: 'standard', size: 'medium', theme: 'outline' });
  } catch (e) {
    onError?.(e.message || 'gis_load_failed');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add docs/js/lib/auth.js
git commit -m "feat(auth): frontend GIS sign-in, token storage, authFetch"
```

---

### Task 7: Sign-in affordance in the UI + wire into `app.js`

**Files:**
- Modify: `docs/index.html` (sidebar sign-in area + Google client id)
- Modify: `docs/css/styles.css` (auth styles)
- Modify: `docs/js/app.js` (auth state render + wiring)

**Interfaces:**
- Consumes: `loadAuth`, `initGoogleSignIn`, `clearAuth`, `getToken` from `docs/js/lib/auth.js`; `$`, `toast` from `docs/js/lib/dom.js`; `esc` from `docs/js/lib/format.js`.

- [ ] **Step 1: Expose the Google client id + add the sign-in area**

In `docs/index.html`, in `<head>` (after the `<title>`), add:

```html
  <script>window.COOKBOOK_GOOGLE_CLIENT_ID = 'replace-me.apps.googleusercontent.com';</script>
```

In the `.sidebar-footer` (around line 43–45), replace its contents with:

```html
  <div class="sidebar-footer">
    <div class="auth-area" id="auth-area"></div>
    <p class="auth-status" id="auth-status">Stored as <a href="https://schema.org/Recipe" target="_blank" rel="noopener">schema.org/Recipe</a> JSON-LD</p>
  </div>
```

- [ ] **Step 2: Add minimal auth styles**

Append to `docs/css/styles.css`:

```css
/* ── Auth ── */
.auth-area { margin-bottom: .5rem; }
.auth-status { font-size: .75rem; }
.auth-signed-in { display: flex; flex-direction: column; gap: .25rem; }
.auth-email { font-size: .8rem; color: var(--ink, #fafaf9); word-break: break-all; }
.auth-signout { font-size: .75rem; background: none; border: none; color: var(--ink-light, #a8a29e); cursor: pointer; text-decoration: underline; padding: 0; }
```

- [ ] **Step 3: Wire auth into `app.js`**

In `docs/js/app.js`, add an import near the top (alongside the other `./lib/...` imports):

```js
import { loadAuth, initGoogleSignIn, clearAuth } from './lib/auth.js';
```

Confirm `esc` is already imported in `app.js`. If the existing format import is `import { esc, pluralize } from './lib/format.js';`, leave it; if `esc` is missing, add it.

Add a `renderAuth()` function near the other render functions (e.g. after `renderPantry`):

```js
function renderAuth() {
  const area = $('auth-area');
  if (!area) return;
  const { token, email } = loadAuth();
  if (token) {
    area.innerHTML =
      `<div class="auth-signed-in">
         <span class="auth-email">Signed in as ${esc(email)}</span>
         <button class="auth-signout" id="auth-signout-btn">Sign out</button>
       </div>`;
    $('auth-signout-btn').addEventListener('click', () => {
      clearAuth();
      renderAuth();
      renderRecipes();
      toast('Signed out');
    });
  } else {
    area.innerHTML = `<div id="g-signin-btn"></div>`;
    initGoogleSignIn({
      buttonEl: $('g-signin-btn'),
      clientId: window.COOKBOOK_GOOGLE_CLIENT_ID,
      onSignedIn: (em) => { renderAuth(); toast(`Signed in as ${em}`); },
      onError: (msg) => toast(`Sign-in failed: ${msg}`),
    });
  }
}
```

Call `renderAuth()` on boot — at the end of `app.js`, after the existing boot calls (`renderPantry(); renderCart();`):

```js
renderAuth();
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS (frontend wiring is not unit-tested; verified manually next).

- [ ] **Step 5: Manual smoke test (local, same-origin)**

1. Set a real Google OAuth web client ID in `wrangler.toml` (`GOOGLE_CLIENT_ID`) and `docs/index.html` (`window.COOKBOOK_GOOGLE_CLIENT_ID`), and add your email to `ALLOWED_EMAILS` in `wrangler.toml`. (Do not commit real values — use placeholders in commits; edit locally.)
2. Create a local secret file `wrangler.toml`'s sibling `.dev.vars` (gitignored) with:
   ```
   SESSION_SECRET="<a 32+ char random string>"
   ```
   Add `.dev.vars` to `.gitignore` if not already present.
3. Start the Pages dev server (serves the static frontend + Functions on one origin):
   `npm run dev` (i.e. `wrangler pages dev docs`)
   Note the local URL (e.g. `http://localhost:8788`).
4. Open the local URL, sign in with Google → sidebar shows "Signed in as …" + Sign out. Sign out returns to the Google button. Recipes/pantry/cart work throughout, signed-out.
5. Revert any local-only real values (`GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`, the index.html client id) back to placeholders before committing, unless you intentionally want them committed (the client id is non-secret; `ALLOWED_EMAILS` may be). Keep `.dev.vars` uncommitted.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/css/styles.css docs/js/app.js .gitignore
git commit -m "feat(auth): sign-in/sign-out affordance wired into app.js"
```

---

### Task 8: CI installs deps + production env config notes

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Add an install step to CI**

The root `package.json` now has a real dependency (`jose`), so CI must install before running tests. In `.github/workflows/test.yml`, add an `npm install` step to the existing `test` job (after setup-node, before `Run tests`):

```yaml
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test
```

(The full `test` job steps become: checkout → setup-node@v4 (node 20) → install dependencies → run tests. There is no separate worker job — the auth tests live under `test/` and are discovered by the same `node --test` run.)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: install deps before tests (jose) for auth suite"
```

- [ ] **Step 3: Production environment configuration (documented; not a code commit)**

Before the deployed `cookbook` Pages project can actually authenticate, set its environment on the existing git-connected project (not in the repo):

- **Vars (non-secret):** `GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`, `SESSION_TTL` — set via the Cloudflare dashboard (cookbook Pages project → Settings → Environment variables) or via the Cloudflare API/MCP, for the **Production** environment.
- **Secret:** `SESSION_SECRET` — set via `wrangler pages secret put SESSION_SECRET --project-name cookbook` (paste a ≥32-char random string), or the dashboard. Never committed.
- The frontend's Google client id is exposed via `window.COOKBOOK_GOOGLE_CLIENT_ID` in `docs/index.html`; set the real value there (it is non-secret) before deploying, or inject it at deploy time.

These are configuration actions, not code; record them in the PR handoff so the deployer sets them after merge. No commit is produced by this step.

---

## Self-review (run against PRD 3)

- **Sign in with Google → mint session token (§5, §6.1):** GIS in `auth.js` (Task 6) → same-origin `/api/auth` → `handleAuth` (Task 4) mints session JWT (Task 2). ✓
- **Email whitelist gate (§5, §6.1, §10):** `isAllowed` (Task 1) checked in `handleAuth`; non-whitelisted → 403 (Task 4 test). ✓
- **Stateless, no DB (§5, §8):** no storage anywhere; session is a signed JWT. ✓
- **`email_verified` true required (§8.1, §10):** `verifyIdToken` rejects false; `handleAuth` rejects unverified (Tasks 3, 4 tests). ✓
- **Protected routes require Bearer (§6.2):** `authorize` (Task 4) wired in `_middleware.js` (Task 5) for `/api/*` (except `/api/auth`). ✓
- **Session expiry (§8.2):** `signSession` sets `exp`; `verifySession` rejects expired (Task 2 test). ✓
- **Sign-out = discard token (§9, §13):** `clearAuth` (Task 6) wired to Sign out button (Task 7). ✓
- **Rest of app works signed-out (§9, §13):** no app flow depends on auth except the (PRD 2) extraction UI. ✓
- **Secrets not committed (§7, §11):** `SESSION_SECRET` via `wrangler pages secret put` / `.dev.vars` (gitignored); `wrangler.toml` only has non-secret vars. ✓
- **Same-origin, no CORS needed (PRD §11 "Pages + Worker same-origin"):** Pages Functions on the existing project; `/api/auth` is same-origin with the SPA. No `APP_ORIGIN`, no CORS headers. ✓
- **Whitelist + token verify unit-tested (§12):** Tasks 1–4, all under `node --test` via the root `npm test`. ✓

No placeholders. All referenced functions exist (`jose` installed in Task 1; frontend helpers `$`, `toast`, `esc` exist in the repo). The base64url decode in `google.js` uses `atob`/`TextDecoder` (no `Buffer`), so the same code runs in Node tests and the Workers runtime without `nodejs_compat`. Pages Functions routing: `functions/api/auth.js` (POST) + `functions/api/_middleware.js` (gate) are picked up automatically by the git-connected `cookbook` project on the next deploy.