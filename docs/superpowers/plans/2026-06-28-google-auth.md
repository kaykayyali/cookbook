# Google Sign-in (Auth Gateway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sign in with Google" flow on the page that mints a Worker-signed session token, used to gate protected web APIs (the extraction endpoint in the next plan). No database, no server-side user records.

**Architecture:** A Cloudflare Worker (`worker/`) hosts `POST /api/auth` and a protected-route helper. Auth is stateless: the browser gets a Google-signed ID token (Google Identity Services), the Worker verifies it (JWKS), checks an email whitelist, and mints a short-lived HS256 session JWT. Worker logic is factored into pure, dependency-injected modules so it tests under Node's built-in runner with no Workers runtime. The frontend gains a Google button + token storage; the rest of the app keeps working signed-out.

**Tech Stack:** Cloudflare Workers (Web APIs), `jose` for JWT (HS256 session + RS256 Google ID token), Node built-in test runner, Node ≥ 18. Frontend: native ES modules, Google Identity Services.

## Global Constraints

- The frontend (`docs/`) stays zero-dependency. New frontend code is plain ES modules using the existing `lib/` helpers (`$`, `els`, `toast`, `esc`).
- The Worker (`worker/`) is a separate package with its own `package.json`; its only runtime dependency is `jose`.
- Worker logic that can be pure MUST be pure and dependency-injected so it runs under `node --test` without the Workers runtime.
- `SESSION_SECRET` is a Worker **secret** (set via `wrangler secret put`), never committed. `GOOGLE_CLIENT_ID` and `ALLOWED_EMAILS` are non-secret vars.
- Sign-in is only required to call protected APIs. All other app features work offline and signed-out exactly as today (PRD 0 invariant).
- Auth state on the client lives in `localStorage` keys `cb_token` and `cb_email`.
- Follow the existing file header comment style in frontend files.

---

## File Structure

Worker (new sub-project under `worker/`):
- **Create** `worker/package.json` — package metadata, `jose` dep, test/dev/deploy scripts.
- **Create** `worker/wrangler.toml` — Worker config + non-secret vars.
- **Create** `worker/src/whitelist.js` — `isAllowed(email, allowedCsv)`.
- **Create** `worker/src/session.js` — `signSession(claims, secret, ttlSec)`, `verifySession(token, secret)`.
- **Create** `worker/src/google.js` — `makeJwksGetter(jwksUrl)` (cached fetch), `verifyIdToken(idToken, clientId, getKey)`.
- **Create** `worker/src/handler.js` — pure `handleAuth(body, env, deps)` and `authorize(req, env)`; injectable deps for testing.
- **Create** `worker/src/index.js` — Worker `fetch` entry wiring real deps to handlers, CORS, routing.
- **Create** `worker/test/whitelist.test.js`, `worker/test/session.test.js`, `worker/test/google.test.js`, `worker/test/handler.test.js`.

Frontend:
- **Create** `docs/js/lib/auth.js` — GIS loader, sign-in button render, token exchange, storage, sign-out, `authFetch`.
- **Modify** `docs/index.html` — a sign-in/sign-out affordance in the sidebar.
- **Modify** `docs/js/app.js` — render signed-in state, wire sign-in/sign-out.

Config:
- **Modify** `.github/workflows/test.yml` — add a job to run `worker` tests (so CI covers both packages).
- **Modify** root `package.json` (optional) — add `test:worker` script.

---

### Task 1: Worker package + whitelist module (TDD)

**Files:**
- Create: `worker/package.json`
- Create: `worker/src/whitelist.js`
- Create: `worker/test/whitelist.test.js`

**Interfaces:**
- Produces: `isAllowed(email: string, allowedCsv: string) => boolean` — case-insensitive, whitespace-trimmed match of `email` against a comma-separated list. Empty `allowedCsv` → `false` (deny by default).

- [ ] **Step 1: Create the worker package**

Create `worker/package.json`:

```json
{
  "name": "cookbook-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
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

Then install: `cd worker && npm install`

- [ ] **Step 2: Write the failing test**

Create `worker/test/whitelist.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../src/whitelist.js';

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

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/whitelist.js'`.

- [ ] **Step 4: Implement the whitelist**

Create `worker/src/whitelist.js`:

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

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/src/whitelist.js worker/test/whitelist.test.js
git commit -m "feat(worker): package + email whitelist gate with tests"
```

---

### Task 2: Session JWT sign/verify with `jose` (TDD)

**Files:**
- Create: `worker/src/session.js`
- Create: `worker/test/session.test.js`

**Interfaces:**
- Produces:
  - `signSession({ sub, email }, secret, ttlSec) => Promise<string>` — HS256 JWT with `iss: 'cookbook-api'`, `iat`, `exp = iat + ttlSec`, payload `{ sub, email }`.
  - `verifySession(token, secret) => Promise<{ sub, email } | null>` — returns the claims if signature valid, `iss` matches, and not expired; `null` otherwise.

- [ ] **Step 1: Write the failing test**

Create `worker/test/session.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from '../src/session.js';

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

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/session.js'`.

- [ ] **Step 3: Implement session JWT**

Create `worker/src/session.js`:

```js
// ════════════════════════════════════════════════════════
// session.js — Worker-signed HS256 session JWT (pure, uses jose)
// ════════════════════════════════════════════════════════

import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'cookbook-api';

/**
 * Mint a session JWT for the given user. Pure-ish (async). TTL is in seconds.
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

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/session.js worker/test/session.test.js
git commit -m "feat(worker): HS256 session JWT sign/verify via jose"
```

---

### Task 3: Google ID token verification (TDD with a fixture RSA key)

**Files:**
- Create: `worker/src/google.js`
- Create: `worker/test/google.test.js`

**Interfaces:**
- Produces:
  - `verifyIdToken(idToken, clientId, getKey) => Promise<{ sub, email, email_verified } | null>` — verifies the Google ID token's signature using `getKey(kid) => Promise<CryptoKey|KeyLike>`, checks `iss` (`https://accounts.google.com`), `aud` == `clientId`, `exp`, and `email_verified === true`. Returns the claims on success, `null` on any failure.
  - `makeJwksGetter(jwksUrl) => (kid) => Promise<CryptoKey>` — production key getter that fetches Google's JWKS once (cached) and returns the key matching `kid`. Used only by the Worker entry, not by the unit tests (tests inject a fixture key getter).

- [ ] **Step 1: Write the failing test**

Create `worker/test/google.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importPKCS8, SignJWT, exportJWK } from 'jose';
import crypto from 'node:crypto';
import { verifyIdToken } from '../src/google.js';

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

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/google.js'`.

- [ ] **Step 3: Implement Google ID token verification**

Create `worker/src/google.js`:

```js
// ════════════════════════════════════════════════════════
// google.js — Google ID token verification (RS256 via jose)
// ════════════════════════════════════════════════════════

import { jwtVerify, importJWK, createRemoteJWKSet } from 'jose';

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

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
    const headerB64 = idToken.split('.')[0];
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
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

> Note: `Buffer` is available in Node and in the Workers runtime (via its `nodejs_compat` or `Buffer` global on recent compatibility dates). If the Workers runtime lacks `Buffer`, replace the header-peek with a Web-API decode: `JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(idToken.split('.')[0]), (c) => c.charCodeAt(0))))`. Use whichever compiles under `wrangler dev`; the test runs under Node where `Buffer` exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/google.js worker/test/google.test.js
git commit -m "feat(worker): verify Google ID tokens (RS256) with injectable key"
```

---

### Task 4: Pure auth handler (TDD with injected fakes)

**Files:**
- Create: `worker/src/handler.js`
- Create: `worker/test/handler.test.js`

**Interfaces:**
- Produces:
  - `handleAuth({ idToken }, env, deps) => Promise<{ status: number, body: object }>` where `deps = { verifyIdToken, signSession, isAllowed }`. Verifies the ID token, checks the whitelist, mints a session. Returns `{ status: 200, body: { token, email, expiresAt } }` on success; `{ status: 401, body: { error } }` bad token; `{ status: 403, body: { error } }` not whitelisted / unverified email.
  - `authorize(req, env, deps) => Promise<{ ok: true, claims } | { ok: false, status: number, body: object }>` — reads `Authorization: Bearer`, calls `verifySession`, returns claims or a 401 error envelope.

- [ ] **Step 1: Write the failing test**

Create `worker/test/handler.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuth, authorize } from '../src/handler.js';

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

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/handler.js'`.

- [ ] **Step 3: Implement the pure handler**

Create `worker/src/handler.js`:

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

Run: `cd worker && npm test`
Expected: PASS — all handler tests green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/handler.js worker/test/handler.test.js
git commit -m "feat(worker): pure handleAuth + authorize with injected deps"
```

---

### Task 5: Worker entry — routing, CORS, real deps

**Files:**
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.js`

**Interfaces:**
- Produces: a Workers `fetch(request, env)` that routes `POST /api/auth` → `handleAuth` (no auth), `OPTIONS` → CORS preflight, and any other `/api/*` → requires `authorize` then 404 (extraction is added in the next plan). CORS allows `APP_ORIGIN`.

- [ ] **Step 1: Create wrangler config**

Create `worker/wrangler.toml`:

```toml
name = "cookbook-api"
main = "src/index.js"
compatibility_date = "2025-09-01"

# Non-secret config. Set SESSION_SECRET with: wrangler secret put SESSION_SECRET
[vars]
APP_ORIGIN = "http://localhost:8000"
GOOGLE_CLIENT_ID = "replace-me.apps.googleusercontent.com"
ALLOWED_EMAILS = "you@example.com"
SESSION_TTL = "604800"
```

- [ ] **Step 2: Implement the Worker entry**

Create `worker/src/index.js`:

```js
// ════════════════════════════════════════════════════════
// index.js — Cloudflare Worker entry: routing, CORS, real deps
// ════════════════════════════════════════════════════════

import { handleAuth, authorize } from './handler.js';
import { verifyIdToken, makeJwksGetter } from './google.js';
import { signSession, verifySession } from './session.js';
import { isAllowed } from './whitelist.js';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const keyGetter = makeJwksGetter(GOOGLE_JWKS);

const deps = {
  verifyIdToken: (idToken, clientId) => verifyIdToken(idToken, clientId, keyGetter),
  signSession,
  isAllowed,
  verifySession,
};

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.APP_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

function json(status, body, env) {
  return new Response(JSON.stringify(body), { status, headers: cors(env) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    if (url.pathname === '/api/auth' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }, env); }
      const { status, body: out } = await handleAuth(body, env, deps);
      return json(status, out, env);
    }

    // Any other /api/* route requires a valid session. Extraction (/api/extract)
    // is added in the next plan; until then this returns 404 after auth.
    if (url.pathname.startsWith('/api/')) {
      const auth = await authorize(request, env, deps);
      if (!auth.ok) return json(auth.status, auth.body, env);
      return json(404, { error: 'not_found' }, env);
    }

    return json(404, { error: 'not_found' }, env);
  },
};
```

- [ ] **Step 3: Verify the suite still passes**

Run: `cd worker && npm test`
Expected: PASS (entry is not unit-tested here; verified by smoke test next).

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.toml worker/src/index.js
git commit -m "feat(worker): entry with routing, CORS, real deps"
```

---

### Task 6: Frontend auth module — GIS sign-in, token storage, sign-out

**Files:**
- Create: `docs/js/lib/auth.js`

**Interfaces:**
- Produces:
  - `API_BASE` (constant) — `window.COOKBOOK_API || '/api'`.
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

/** API base: same-origin ('/api') in prod; set window.COOKBOOK_API for dev. */
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
- Modify: `docs/index.html` (sidebar sign-in area)
- Modify: `docs/js/app.js` (auth state render + wiring)

**Interfaces:**
- Consumes: `loadAuth`, `initGoogleSignIn`, `clearAuth`, `getToken` from `docs/js/lib/auth.js`; `$`, `toast` from `docs/js/lib/dom.js`.

- [ ] **Step 1: Add the sign-in area to the sidebar**

In `docs/index.html`, inside the `.sidebar-footer` (around line 43-45), replace its contents with:

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

In `docs/js/app.js`, add an import near the top:

```js
import { loadAuth, initGoogleSignIn, clearAuth } from './lib/auth.js';
```

Add `GOOGLE_CLIENT_ID` config. The frontend needs the Google client ID; expose it on `window` from `index.html` (non-secret). Add this script tag in `docs/index.html` `<head>` (after the title):

```html
  <script>window.COOKBOOK_GOOGLE_CLIENT_ID = 'replace-me.apps.googleusercontent.com';</script>
```

Add a `renderAuth()` function and wiring. In `docs/js/app.js`, after the `renderPantry` function (or near the other render functions), add:

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

> `esc` is already imported in `app.js` (line 5). Confirm it is in the import list; if not, add `esc` to the existing `import { esc, pluralize } from './lib/format.js';`.

Call `renderAuth()` on boot — at the end of `app.js`, after `renderPantry();` (and the cart `renderCart();` from the previous plan):

```js
renderAuth();
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS (frontend wiring is not unit-tested; verified manually next).

- [ ] **Step 5: Manual smoke test**

1. Set a real Google OAuth client ID in `worker/wrangler.toml` (`GOOGLE_CLIENT_ID`) and `docs/index.html` (`window.COOKBOOK_GOOGLE_CLIENT_ID`), and add your email to `ALLOWED_EMAILS`.
2. Set the session secret: `cd worker && wrangler secret put SESSION_SECRET` (paste a ≥32-char random string).
3. Start the Worker: `cd worker && wrangler dev` (serves on `http://localhost:8787`).
4. Set the frontend API base for dev: in `docs/index.html` add to the existing config script:
   ```html
   <script>window.COOKBOOK_API = 'http://localhost:8787/api'; window.COOKBOOK_GOOGLE_CLIENT_ID = 'your-client-id';</script>
   ```
   (Replace the earlier placeholder script with this dev-configured one locally; do not commit the dev URL.)
5. Serve the frontend: `npx serve docs` (or `python3 -m http.server -d docs 8000`), open it, sign in with Google → sidebar shows "Signed in as …" + Sign out. Sign out returns to the Google button. Recipes/pantry/cart work throughout.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/css/styles.css docs/js/app.js
git commit -m "feat(auth): sign-in/sign-out affordance wired into app.js"
```

---

### Task 8: CI for the worker tests

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Add a worker test job**

In `.github/workflows/test.yml`, add a second job after `test`:

```yaml
  test-worker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install worker deps
        run: cd worker && npm install
      - name: Run worker tests
        run: cd worker && npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run worker test suite on push/PR"
```

---

## Self-review (run against PRD 3)

- **Sign in with Google → mint session token (§5, §6.1):** GIS in `auth.js` (Task 6) → `/api/auth` → `handleAuth` (Task 4) mints session JWT (Task 2). ✓
- **Email whitelist gate (§5, §6.1, §10):** `isAllowed` (Task 1) checked in `handleAuth`; non-whitelisted → 403 (Task 4 test). ✓
- **Stateless, no DB (§5, §8):** no storage anywhere; session is a signed JWT. ✓
- **`email_verified` true required (§8.1, §10):** `verifyIdToken` rejects false; `handleAuth` rejects unverified (Tasks 3, 4 tests). ✓
- **Protected routes require Bearer (§6.2):** `authorize` (Task 4) wired in `index.js` (Task 5) for `/api/*`. ✓
- **Session expiry (§8.2):** `signSession` sets `exp`; `verifySession` rejects expired (Task 2 test). ✓
- **Sign-out = discard token (§9, §13):** `clearAuth` (Task 6) wired to Sign out button (Task 7). ✓
- **Rest of app works signed-out (§9, §13):** no app flow depends on auth except the (PRD 2) extraction UI. ✓
- **Secrets not committed (§7, §11):** `SESSION_SECRET` via `wrangler secret put`; `wrangler.toml` only has non-secret vars. ✓
- **CORS to APP_ORIGIN (§10):** `cors()` in `index.js` (Task 5). ✓
- **Whitelist + token verify unit-tested (§12):** Tasks 1-4. ✓

No placeholders. All referenced functions exist (`jose` is installed in Task 1; frontend helpers `$`, `toast`, `esc` exist in the repo). The one open implementation note (Buffer vs Web-API header peek in `google.js`) is flagged inline with a concrete fallback.