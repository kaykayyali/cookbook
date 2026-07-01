# Shared Recipes (Community) Implementation Plan (Pages Functions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let all signed-in (allowlisted) users browse each other's recipes in a shared Community feed, each marked by its author, with author-only edit/delete and a one-tap "Save to my library" copy — without disturbing the existing local-first library.

**Architecture:** Adds D1-backed `/api/community` routes (list/get/share/edit/delete) as Pages Functions, auth-gated by the existing `_middleware.js` which already attaches `context.data.auth`. The session JWT is extended to carry the author's Google `name` + `picture` so the server can stamp author metadata onto each shared recipe (no users table). Pure, D1-injected handlers in `functions/_lib/community.js` are unit-tested under `node --test`; thin `functions/api/community*` Functions wire `context` → handler → `json()`. The frontend gains a `community` panel + controller (mirroring the existing `controllers/` pattern) and a community-detail flow that reuses `recipeDetail` components. The client sends/receives **canonical schema.org/Recipe JSON-LD** (via existing `toSchema`/`fromSchema`); the server stores the blob verbatim and only validates + stamps author.

**Depends on:** PRD 3 (Google auth — middleware `context.data.auth`, `authFetch`, signed-in state) and the `context.data` fix from PR #7. Already shipped to `main`.

**Tech Stack:** Cloudflare Pages Functions + D1 binding (`env.DB`, `[[d1_databases]]` in repo `wrangler.toml`), `jose` (already a dep), Node built-in test runner (`node --test` from repo root). Frontend: native ES modules, the existing `controllers/` + `components/` + `lib/` layering.

## Global Constraints

- **Local-first is preserved.** `state.recipes` / `cb_recipes` / `save()` / `load()` are untouched. The Community feature is additive; when the server is unreachable the Community panel shows a banner and the rest of the app keeps working offline.
- **schema.org/Recipe is canonical on the wire.** `POST`/`PUT /api/community` send `{ recipe: <canonical JSON-LD object> }` (the client produces it via `toSchema`); `GET` returns the stored canonical object (the client consumes it via `fromSchema`). The server stores `JSON.stringify(recipe)` verbatim and only validates a non-empty `name` — it does **not** import `toSchema`/`fromSchema` (those live in `docs/js/lib/schema.js`, a different tree).
- **Author metadata is DB columns, not recipe fields.** `author_sub` / `author_name` / `author_picture` are stamped from `context.data.auth` at share/edit time. They never appear inside `recipe_json`, so a recipe stays portable and "Save to my library" copies just the recipe.
- **Author-only mutation.** `editRecipe` / `deleteCommunity` load the row's `author_sub` and return `403 not_author` on mismatch, `404 not_found` if the row is absent.
- **No `Buffer`** (the project does not set `nodejs_compat`). Use `btoa`/`atob` (web standards, available in Workers + Node ≥ 16) for the base64url cursor; `crypto.randomUUID()` (with a `Math.random` fallback) for ids; `TextDecoder`/`Date.now()` as elsewhere.
- **Pure handlers, injected D1.** `functions/_lib/community.js` handlers take `db` (and `author`) as parameters so they test under `node --test` with a stub D1 — same pattern as `extract.js`/`handler.js`. Thin `functions/api/community*` Functions are not unit-tested (the pure handlers are).
- **Reuse the controller pattern.** New frontend logic is a `controllers/community.js` factory `initCommunity({ state, …callbacks })` returning an API, wired in `app.js` like the other controllers; new markup is a `components/communityCard.js`; nav uses the existing `data-panel` + `#panel-<id>` convention.
- **Follow the existing file header comment style** (the `═══` banner used in `functions/_lib/*.js` and `docs/js/controllers/*.js`).
- **`npm test` runs from the repo root** (`node --test`, picks up `test/**/*.test.js`). Import server libs as `../functions/_lib/…` and frontend libs as `../docs/js/lib/…`.

---

## File Structure

Backend (Pages Functions):
- **Modify** `functions/_lib/google.js` — `verifyIdToken` also returns `name` + `picture` (with a name fallback to the email local-part).
- **Modify** `functions/_lib/session.js` — `signSession`/`verifySession` carry `{ sub, email, name, picture }`.
- **Modify** `functions/_lib/handler.js` — `handleAuth` passes `name` + `picture` into `signSession`.
- **Create** `functions/_lib/community.js` — `SCHEMA`, `ensureSchema(db)`, `ensureOnce(db)`, `authorFrom(context)`, `encodeCursor`/`decodeCursor`, `validateRecipe`, `uuid`, and the handlers `listCommunity` / `getCommunity` / `shareRecipe` / `editRecipe` / `deleteCommunity`. Each handler returns `{ status, body }`.
- **Create** `functions/api/community.js` — `onRequestGet` (list) + `onRequestPost` (share).
- **Create** `functions/api/community/[id].js` — `onRequestGet` (one) + `onRequestPut` (edit) + `onRequestDelete` (delete).
- **Modify** `wrangler.toml` — add the `[[d1_databases]]` binding (`binding = "DB"`).
- **Create** `docs/superpowers/migrations/0001_community_recipes.sql` — the same DDL, for an explicit `wrangler d1 execute` apply.

Tests:
- **Modify** `test/auth-session.test.js` — round-trip now includes `name` + `picture`; add a "picture nullable" case.
- **Modify** `test/auth-google.test.js` — the valid-token test includes `name` + `picture` claims and asserts they are surfaced; add a name-fallback case.
- **Create** `test/community.test.js` — the 5 handlers + cursor + validation + author/404/403 with a stub D1.
- **Create** `test/community-client.test.js` — the pure client helpers (`toShareable`, `toLocalCopy`).

Frontend:
- **Create** `docs/js/lib/community.js` — pure helpers (`toShareable`, `toLocalCopy`) + thin `authFetch` wrappers (`fetchCommunity`, `shareRecipe`, `saveCommunityRecipe`, `editCommunityRecipe`, `deleteCommunityRecipe`) + `communityState`.
- **Create** `docs/js/components/communityCard.js` — `communityCardHTML(item)` + `communityEmptyHTML()`.
- **Create** `docs/js/controllers/community.js` — `initCommunity({ state, panels, drawer, onSignedOut })` owning the `community` panel: list render, load-more, card click → community detail, share/save/edit/delete actions.
- **Modify** `docs/js/controllers/detail.js` — refactor `open(id)` to delegate to a new `openRecipe(r, ctx)` that renders an arbitrary internal recipe; add `openCommunity(item)` (author badge, Save-to-library, author Edit/Delete); wire the new footer buttons.
- **Modify** `docs/js/controllers/drawer.js` — add `openCommunityEdit(item)` + an `onCommunitySave` dep so `save()` can PUT to the community store instead of writing local.
- **Modify** `docs/js/app.js` — instantiate the community controller and wire its callbacks.
- **Modify** `docs/index.html` — `data-panel="community"` nav item, `#panel-community` section with `#community-grid`, and the new detail-footer buttons (`#dm-author-badge`, `#dm-save-local-btn`, `#dm-community-edit-btn`, `#dm-community-delete-btn`).
- **Modify** `docs/css/styles.css` — author badge + community card styles (small).

---

### Task 1: Carry author name + picture in the session (TDD, server)

**Files:**
- Modify: `functions/_lib/google.js`
- Modify: `functions/_lib/session.js`
- Modify: `functions/_lib/handler.js`
- Modify: `test/auth-session.test.js`
- Modify: `test/auth-google.test.js`

**Interfaces:**
- Produces: `verifyIdToken(idToken, clientId, getKey) => { sub, email, email_verified, name, picture } | null` (`name` is always a non-empty string — falls back to the email local-part, then `'member'`; `picture` is `string | null`). `signSession({ sub, email, name, picture }, secret, ttlSec) => Promise<string>` and `verifySession(token, secret) => { sub, email, name, picture } | null`. `handleAuth` passes `name` + `picture` into `signSession`; `authorize`'s returned `claims` (from `verifySession`) now include them, so `context.data.auth` (set by `_middleware.js`) carries `name` + `picture` with no middleware change.

- [ ] **Step 1: Update `functions/_lib/session.js`**

Replace the `signSession` and `verifySession` bodies so the payload carries `name` + `picture`:

```js
/**
 * Mint a session JWT for the given user. TTL is in seconds.
 * @param {{sub:string, email:string, name?:string, picture?:string|null}} claims
 * @param {string} secret
 * @param {number} ttlSec
 * @returns {Promise<string>}
 */
export async function signSession({ sub, email, name, picture }, secret, ttlSec) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('SESSION_SECRET not configured or too short (need >=16 chars)');
  }
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ sub, email, name, picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(`${ttlSec} s`)
    .sign(key);
}

/**
 * Verify a session JWT. Returns the claims on success, null on any failure
 * (bad signature, wrong issuer, expired, malformed). `name`/`picture` may be
 * undefined for tokens minted before this field existed.
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<{sub:string,email:string,name?:string,picture?:string|null}|null>}
 */
export async function verifySession(token, secret) {
  if (typeof token !== 'string' || !token) return null;
  if (typeof secret !== 'string' || secret.length < 16) return null;
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update `functions/_lib/google.js`**

Change the `return` inside `verifyIdToken` to surface `name` + `picture` with a name fallback. Replace the `if (payload.email_verified !== true) return null;` + `return { … }` block with:

```js
    if (payload.email_verified !== true) return null;
    const name = (typeof payload.name === 'string' && payload.name.trim())
      || (typeof payload.email === 'string' && payload.email.split('@')[0])
      || 'member';
    return { sub: payload.sub, email: payload.email, email_verified: true, name, picture: payload.picture || null };
```

Also update the `@returns` JSDoc on `verifyIdToken` to `{sub,email,email_verified,name,picture}|null`.

- [ ] **Step 3: Update `functions/_lib/handler.js`**

In `handleAuth`, change the `signSession` call (around the `const token = await deps.signSession(…)` line) to pass `name` + `picture`:

```js
	const token = await deps.signSession(
		{ sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture },
		env.SESSION_SECRET,
		ttl,
	);
```

(`authorize` is unchanged — it already returns `claims` from `deps.verifySession`, which now includes `name` + `picture`.)

- [ ] **Step 4: Update `test/auth-session.test.js`**

Replace the round-trip test and add a nullable-picture case. Replace the first test:

```js
test('signSession + verifySession round-trip the claims including name + picture', async () => {
  const token = await signSession({ sub: '123', email: 'a@b.com', name: 'A', picture: 'https://x/a.png' }, SECRET, 3600);
  const claims = await verifySession(token, SECRET);
  assert.deepEqual(claims, { sub: '123', email: 'a@b.com', name: 'A', picture: 'https://x/a.png' });
});

test('verifySession preserves a missing picture as undefined', async () => {
  const token = await signSession({ sub: '123', email: 'a@b.com', name: 'A' }, SECRET, 3600);
  const claims = await verifySession(token, SECRET);
  assert.equal(claims.name, 'A');
  assert.equal(claims.picture, undefined);
});
```

Leave the wrong-secret / expired / garbage / short-secret / `signSession`-throws tests as-is (they mint `{ sub, email }` only, which is still a valid input — `name`/`picture` are optional).

- [ ] **Step 5: Update `test/auth-google.test.js`**

In the existing "returns claims for a valid Google ID token" test, add `name` + `picture` to the signed JWT and to the assertion; add a name-fallback test. Replace that first test with:

```js
test('verifyIdToken returns claims (incl. name + picture) for a valid Google ID token', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: true, name: 'You', picture: 'https://x/a.png' })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt()
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const getKey = async () => pubJwk;
  const claims = await verifyIdToken(token, 'client-123', getKey);
  assert.deepEqual(claims, { sub: 'g-123', email: 'you@example.com', email_verified: true, name: 'You', picture: 'https://x/a.png' });
});

test('verifyIdToken falls back to the email local-part when name is absent', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const claims = await verifyIdToken(token, 'client-123', async () => pubJwk);
  assert.equal(claims.name, 'you');
  assert.equal(claims.picture, null);
});
```

Leave the wrong-audience / unverified-email / garbage tests as-is.

> **GIS scopes note (resolves spec §13 item 1):** Google Identity Services' default "Sign in with Google" button already requests `openid email profile`, so the id-token already contains `name` + `picture`. No `docs/js/lib/auth.js` scope change is needed; only the server-side extraction above.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the updated auth-session + auth-google tests and the rest of the suite green.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/google.js functions/_lib/session.js functions/_lib/handler.js test/auth-session.test.js test/auth-google.test.js
git commit -m "feat(auth): carry author name + picture in the session JWT"
```

---

### Task 2: D1 binding + schema (config + ensureSchema)

**Files:**
- Modify: `wrangler.toml`
- Create: `docs/superpowers/migrations/0001_community_recipes.sql`
- Create: `functions/_lib/community.js` (only `SCHEMA`, `ensureSchema`, `ensureOnce`, `authorFrom`, `uuid` for now — handlers come in Task 3)
- Create: `test/community.test.js` (only the `ensureSchema` + `authorFrom` tests for now — handler tests come in Task 3)

**Interfaces:**
- Produces: `SCHEMA` (string of `CREATE TABLE IF NOT EXISTS community_recipes …` + two `CREATE INDEX IF NOT EXISTS …`); `ensureSchema(db) => Promise<void>` (runs the DDL as a `db.batch([…])`); `ensureOnce(db) => Promise<void>` (idempotent per-isolate via a module flag); `authorFrom(context) => { sub, name, picture } | null` (name falls back to the email local-part, then `'member'`; `picture` is `string | null` — robust against tokens minted before Task 1); `uuid() => string` (`crypto.randomUUID()` with a `Math.random` fallback).

- [ ] **Step 1: Add the D1 binding to `wrangler.toml`**

Append after the existing `[ai]` block:

```toml
# D1 database for the Community feed — accessible in Pages Functions as env.DB.
# Create it once (`npx wrangler d1 create cookbook`) and paste the printed
# database_id below. Git-connected deploys apply this binding from wrangler.toml.
# The table self-creates on first request via ensureSchema() (see
# functions/_lib/community.js), so a manual migration is optional; the SQL is
# also committed at docs/superpowers/migrations/0001_community_recipes.sql.
[[d1_databases]]
binding = "DB"
database_name = "cookbook"
database_id = "REPLACE_WITH_wrangler_d1_create_OUTPUT"
```

(The `database_id` is the one value that cannot be known ahead of time — it is produced by `wrangler d1 create`. It is config, not code; the deploy step in Self-review/Deploy notes covers filling it in. The app still boots with the placeholder because `ensureSchema` runs at request time, but D1 calls will fail until a real id is set + redeployed.)

- [ ] **Step 2: Create the migration SQL**

`docs/superpowers/migrations/0001_community_recipes.sql`:

```sql
CREATE TABLE IF NOT EXISTS community_recipes (
  id             TEXT PRIMARY KEY,
  author_sub     TEXT NOT NULL,
  author_name    TEXT NOT NULL,
  author_picture TEXT,
  recipe_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_created ON community_recipes(created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_community_author  ON community_recipes(author_sub, created_at DESC);
```

- [ ] **Step 3: Create `functions/_lib/community.js` with schema + helpers**

```js
// ════════════════════════════════════════════════════════
// community.js — shared-recipe store: schema + pure handlers (D1 injected)
// ════════════════════════════════════════════════════════

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Server-side UUID (crypto.randomUUID with a Math.random fallback). */
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * D1 DDL for the community_recipes table + indexes. Idempotent (IF NOT EXISTS),
 * so ensureSchema is safe to run on every cold start.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS community_recipes (
  id             TEXT PRIMARY KEY,
  author_sub     TEXT NOT NULL,
  author_name    TEXT NOT NULL,
  author_picture TEXT,
  recipe_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_created ON community_recipes(created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_community_author  ON community_recipes(author_sub, created_at DESC);
`;

/**
 * Run the schema DDL (idempotent). Uses db.batch so the statements apply in one
 * transaction. Safe to call repeatedly.
 * @param {object} db D1 binding (env.DB)
 */
export async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS community_recipes (
      id TEXT PRIMARY KEY,
      author_sub TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_picture TEXT,
      recipe_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_community_created ON community_recipes(created_at DESC, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_community_author ON community_recipes(author_sub, created_at DESC)`),
  ]);
}

let schemaEnsured = false;
/** Idempotent per-isolate schema ensure — routes call this once, then handlers run. */
export async function ensureOnce(db) {
  if (schemaEnsured) return;
  await ensureSchema(db);
  schemaEnsured = true;
}

/**
 * Pull the author identity off the Pages context (set by _middleware.js as
 * context.data.auth). Returns null when unauthenticated. `name` falls back to
 * the email local-part then 'member' so author_name is never empty — this also
 * covers tokens minted before name/picture were added.
 * @param {object} context
 * @returns {{sub:string,name:string,picture:string|null}|null}
 */
export function authorFrom(context) {
  const a = context && context.data && context.data.auth;
  if (!a || typeof a.sub !== 'string' || !a.sub) return null;
  const name = (typeof a.name === 'string' && a.name.trim())
    || (typeof a.email === 'string' && a.email.split('@')[0])
    || 'member';
  return { sub: a.sub, name, picture: a.picture || null };
}

// (handlers + cursor helpers are appended in Task 3)
export { DEFAULT_LIMIT, MAX_LIMIT, uuid };
```

- [ ] **Step 4: Create `test/community.test.js` with the schema + authorFrom tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, ensureSchema, authorFrom } from '../functions/_lib/community.js';

function stubDb() {
  const calls = { batch: 0, prepared: [] };
  const stmt = (sql) => ({ _sql: sql });
  return {
    db: {
      prepare: (sql) => { calls.prepared.push(sql); return stmt(sql); },
      batch: async (arr) => { calls.batch += 1; calls.batchCount = arr.length; return arr.map(() => ({ meta: {} })); },
    },
    calls,
  };
}

test('ensureSchema runs a batch of 3 DDL statements', async () => {
  const { db, calls } = stubDb();
  await ensureSchema(db);
  assert.equal(calls.batch, 1);
  assert.equal(calls.batchCount, 3);
  assert.ok(calls.prepared.some((s) => s.includes('CREATE TABLE') && s.includes('community_recipes')));
});

test('authorFrom reads context.data.auth and guarantees a non-empty name', () => {
  assert.deepEqual(
    authorFrom({ data: { auth: { sub: 's1', email: 'you@example.com', name: 'You', picture: 'p' } } }),
    { sub: 's1', name: 'You', picture: 'p' },
  );
  // name missing -> email local-part
  assert.equal(authorFrom({ data: { auth: { sub: 's1', email: 'you@example.com' } } }).name, 'you');
  // picture missing -> null
  assert.equal(authorFrom({ data: { auth: { sub: 's1', email: 'you@example.com' } } }).picture, null);
});

test('authorFrom returns null when there is no auth', () => {
  assert.equal(authorFrom({ data: {} }), null);
  assert.equal(authorFrom({ data: { auth: {} } }), null);
  assert.equal(authorFrom({}), null);
});

test('SCHEMA constant contains the table and both indexes', () => {
  assert.ok(SCHEMA.includes('community_recipes'));
  assert.ok(SCHEMA.includes('idx_community_created'));
  assert.ok(SCHEMA.includes('idx_community_author'));
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the 4 new community tests + the full suite green.

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml docs/superpowers/migrations/0001_community_recipes.sql functions/_lib/community.js test/community.test.js
git commit -m "feat(community): D1 binding + schema (ensureSchema) + authorFrom"
```

---

### Task 3: Pure community handlers + keyset cursor (TDD, stub D1)

**Files:**
- Modify: `functions/_lib/community.js` (append handlers + cursor helpers + `validateRecipe` + `rowToRecipe`)
- Modify: `test/community.test.js` (append handler tests)

**Interfaces:**
- Produces:
  - `encodeCursor({ createdAt, id }) => string` and `decodeCursor(cursor) => { c, i } | null` (base64url of `{c,i}` via `btoa`/`atob`; `null` on missing/garbage).
  - `validateRecipe(recipe) => null | 'bad_recipe'` (a non-empty string `name` is required).
  - `listCommunity(db, { cursor, limit }) => Promise<{ status: 200, body: { recipes, nextCursor } }>` — keyset paginated on `(created_at DESC, id DESC)`, fetching `limit+1` to detect a next page.
  - `getCommunity(db, id) => Promise<{ status, body }>` — 200 `{ id, recipe, author, createdAt, updatedAt }` or 404 `{ error: 'not_found' }`.
  - `shareRecipe(db, { recipe, author }) => Promise<{ status, body }>` — 201 with the created item, or 400 `{ error: 'bad_recipe' }`.
  - `editRecipe(db, { id, recipe, author }) => Promise<{ status, body }>` — 200 updated, 400 `bad_recipe`, 404 `not_found`, 403 `not_author`.
  - `deleteCommunity(db, { id, author }) => Promise<{ status, body }>` — 204 `null`, 404 `not_found`, 403 `not_author`.
  - A "recipe item" shape (returned by list/get/share/edit): `{ id, recipe, author: { sub, name, picture }, createdAt, updatedAt }` where `recipe` is the canonical JSON-LD object.

- [ ] **Step 1: Append the cursor helpers, validation, row mapper, and handlers to `functions/_lib/community.js`**

```js
/** base64url encode (no Buffer — uses btoa, a web standard in Workers + Node>=16). */
function b64url(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return atob(b64 + pad);
}

/** Encode a keyset cursor from the last row's (created_at, id). */
export function encodeCursor({ createdAt, id }) {
  return b64url(JSON.stringify({ c: createdAt, i: id }));
}

/** Decode a cursor to { c, i } or null (missing/garbage). */
export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !cursor) return null;
  try {
    const obj = JSON.parse(b64urlDecode(cursor));
    if (typeof obj.c !== 'number' || typeof obj.i !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

/** A canonical recipe needs a non-empty name. Returns null if valid, 'bad_recipe' if not. */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return 'bad_recipe';
  if (typeof recipe.name !== 'string' || !recipe.name.trim()) return 'bad_recipe';
  return null;
}

const COLS = 'id, author_sub, author_name, author_picture, recipe_json, created_at, updated_at';

/** Map a D1 row to a recipe item (recipe is the parsed canonical JSON-LD). */
function rowToRecipe(row) {
  let recipe;
  try { recipe = JSON.parse(row.recipe_json); } catch { recipe = {}; }
  return {
    id: row.id,
    recipe,
    author: { sub: row.author_sub, name: row.author_name, picture: row.author_picture || null },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List community recipes, newest first, keyset-paginated on (created_at, id).
 * Fetches limit+1 to detect a next page.
 * @param {object} db
 * @param {{cursor?:string, limit?:number}} opts
 * @returns {Promise<{status:number, body:object}>}
 */
export async function listCommunity(db, { cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cur = decodeCursor(cursor);
  let results;
  if (cur) {
    results = await db.prepare(
      `SELECT ${COLS} FROM community_recipes
       WHERE created_at < ? OR (created_at = ? AND id < ?)
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    ).bind(cur.c, cur.c, cur.i, lim + 1).all();
  } else {
    results = await db.prepare(
      `SELECT ${COLS} FROM community_recipes ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(lim + 1).all();
  }
  const rows = (results && results.results) || [];
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { status: 200, body: { recipes: page.map(rowToRecipe), nextCursor } };
}

/**
 * Get one community recipe by id.
 * @param {object} db
 * @param {string} id
 * @returns {Promise<{status:number, body:object}>}
 */
export async function getCommunity(db, id) {
  const row = await db.prepare(`SELECT ${COLS} FROM community_recipes WHERE id = ?`).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: rowToRecipe(row) };
}

/**
 * Share a recipe to the community. Stamps author from the session and stores
 * the canonical JSON-LD blob verbatim.
 * @param {object} db
 * @param {{recipe:object, author:{sub,name,picture}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function shareRecipe(db, { recipe, author }) {
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const id = uuid();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO community_recipes (id, author_sub, author_name, author_picture, recipe_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, author.sub, author.name, author.picture || null, JSON.stringify(recipe), now, now).run();
  return {
    status: 201,
    body: { id, recipe, author: { sub: author.sub, name: author.name, picture: author.picture || null }, createdAt: now, updatedAt: now },
  };
}

/**
 * Edit a community recipe (author only). Loads the row to check ownership first.
 * @param {object} db
 * @param {{id:string, recipe:object, author:{sub,name,picture}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function editRecipe(db, { id, recipe, author }) {
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const row = await db.prepare(`SELECT author_sub, created_at FROM community_recipes WHERE id = ?`).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.author_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  const now = Date.now();
  await db.prepare(`UPDATE community_recipes SET recipe_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(recipe), now, id).run();
  return {
    status: 200,
    body: { id, recipe, author: { sub: author.sub, name: author.name, picture: author.picture || null }, createdAt: row.created_at, updatedAt: now },
  };
}

/**
 * Delete a community recipe (author only).
 * @param {object} db
 * @param {{id:string, author:{sub}}} args
 * @returns {Promise<{status:number, body:null}>}
 */
export async function deleteCommunity(db, { id, author }) {
  const row = await db.prepare(`SELECT author_sub FROM community_recipes WHERE id = ?`).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.author_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  await db.prepare(`DELETE FROM community_recipes WHERE id = ?`).bind(id).run();
  return { status: 204, body: null };
}
```

- [ ] **Step 2: Append the handler tests to `test/community.test.js`**

Append (the `stubDb` below is queue-based: `.all()` returns the next queued `{ results }`, `.first()` returns the next queued row, `.run()` records and returns a default meta):

```js
import { encodeCursor, decodeCursor, validateRecipe, listCommunity, getCommunity, shareRecipe, editRecipe, deleteCommunity } from '../functions/_lib/community.js';

// Queue-based stub D1. all/first/run each pull from their queue (defaulting sensibly).
function stubDb({ all = [], first = [] } = {}) {
  const sqls = [];
  const allQ = [...all];
  const firstQ = [...first];
  function mkStmt(sql) {
    const s = {
      bind(...vals) { s._vals = vals; return s; },
      all: async () => { sqls.push({ op: 'all', sql, vals: s._vals }); return allQ.shift() ?? { results: [], meta: {} }; },
      first: async () => { sqls.push({ op: 'first', sql, vals: s._vals }); return firstQ.shift() ?? null; },
      run: async () => { sqls.push({ op: 'run', sql, vals: s._vals }); return { meta: { changes: 1 } }; },
    };
    return s;
  }
  return { db: { prepare: (sql) => mkStmt(sql), batch: async (a) => a.map(() => ({ meta: {} })) }, sqls };
}

const row = (over = {}) => ({
  id: 'r1', author_sub: 's1', author_name: 'You', author_picture: 'p',
  recipe_json: JSON.stringify({ '@type': 'Recipe', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: ['Bake'] }),
  created_at: 1000, updated_at: 1000, ...over,
});

test('encodeCursor + decodeCursor round-trip', () => {
  const cur = encodeCursor({ createdAt: 1000, id: 'r1' });
  assert.deepEqual(decodeCursor(cur), { c: 1000, i: 'r1' });
});

test('decodeCursor returns null for missing/garbage', () => {
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(''), null);
  assert.equal(decodeCursor('!!!not-base64!!!'), null);
});

test('validateRecipe requires a non-empty name', () => {
  assert.equal(validateRecipe({ name: 'Pie' }), null);
  assert.equal(validateRecipe({ name: '  ' }), 'bad_recipe');
  assert.equal(validateRecipe({}), 'bad_recipe');
  assert.equal(validateRecipe(null), 'bad_recipe');
});

test('listCommunity maps rows + sets nextCursor when there is a next page', async () => {
  const { db } = stubDb({ all: [{ results: [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })] }] });
  const res = await listCommunity(db, { limit: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.recipes.length, 2); // page trimmed to limit
  assert.equal(res.body.recipes[0].id, 'a');
  assert.equal(res.body.recipes[0].recipe.name, 'Pie');
  assert.ok(res.body.nextCursor, 'nextCursor set when hasMore');
});

test('listCommunity omits nextCursor when the page is the last', async () => {
  const { db } = stubDb({ all: [{ results: [row({ id: 'a' })] }] });
  const res = await listCommunity(db, { limit: 2 });
  assert.equal(res.body.recipes.length, 1);
  assert.equal(res.body.nextCursor, null);
});

test('listCommunity applies a keyset cursor', async () => {
  const cur = encodeCursor({ createdAt: 1000, id: 'r1' });
  const { db, sqls } = stubDb({ all: [{ results: [row({ id: 'b' })] }] });
  await listCommunity(db, { cursor: cur, limit: 5 });
  const q = sqls.find((s) => s.op === 'all');
  assert.ok(q.sql.includes('created_at < ?'), 'cursor query uses keyset WHERE');
  assert.deepEqual(q.vals, [1000, 1000, 'r1', 6]); // cur.c, cur.c, cur.i, limit+1
});

test('getCommunity returns 200 with the item, or 404', async () => {
  const ok = stubDb({ first: [row({ id: 'r1' })] });
  const r1 = await getCommunity(ok.db, 'r1');
  assert.equal(r1.status, 200);
  assert.equal(r1.body.id, 'r1');
  const miss = stubDb({ first: [null] });
  const r2 = await getCommunity(miss.db, 'nope');
  assert.equal(r2.status, 404);
  assert.equal(r2.body.error, 'not_found');
});

test('shareRecipe stamps author + inserts + returns 201', async () => {
  const { db, sqls } = stubDb();
  const res = await shareRecipe(db, { recipe: { '@type': 'Recipe', name: 'Pie' }, author: { sub: 's1', name: 'You', picture: 'p' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.author.name, 'You');
  assert.ok(res.body.id, 'server-generated id');
  const ins = sqls.find((s) => s.op === 'run' && s.sql.includes('INSERT'));
  assert.ok(ins, 'INSERT ran');
});

test('shareRecipe 400 bad_recipe when name missing', async () => {
  const { db } = stubDb();
  const res = await shareRecipe(db, { recipe: { '@type': 'Recipe' }, author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad_recipe');
});

test('editRecipe 200 for the author', async () => {
  const ok = stubDb({ first: [{ author_sub: 's1', created_at: 1000 }] });
  const r1 = await editRecipe(ok.db, { id: 'r1', recipe: { name: 'Pie2' }, author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.recipe.name, 'Pie2');
  assert.equal(r1.body.createdAt, 1000);
});

test('editRecipe 403 not_author for a non-author', async () => {
  const other = stubDb({ first: [{ author_sub: 's2', created_at: 1000 }] });
  const r2 = await editRecipe(other.db, { id: 'r1', recipe: { name: 'Pie2' }, author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(r2.status, 403);
  assert.equal(r2.body.error, 'not_author');
});

test('editRecipe 404 not_found when the row is absent', async () => {
  const absent = stubDb({ first: [null] });
  const r3 = await editRecipe(absent.db, { id: 'nope', recipe: { name: 'Pie' }, author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(r3.status, 404);
});

test('deleteCommunity 204 for the author, 403 for others, 404 when absent', async () => {
  const ok = stubDb({ first: [{ author_sub: 's1' }] });
  const r1 = await deleteCommunity(ok.db, { id: 'r1', author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(r1.status, 204);
  assert.equal(r1.body, null);

  const other = stubDb({ first: [{ author_sub: 's2' }] });
  const r2 = await deleteCommunity(other.db, { id: 'r1', author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(r2.status, 403);

  const absent = stubDb({ first: [null] });
  const r3 = await deleteCommunity(absent.db, { id: 'nope', author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(r3.status, 404);
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all community handler tests + the full suite green.

- [ ] **Step 4: Commit**

```bash
git add functions/_lib/community.js test/community.test.js
git commit -m "feat(community): pure list/get/share/edit/delete handlers + keyset cursor"
```

---

### Task 4: Pages Function routes for `/api/community`

**Files:**
- Create: `functions/api/community.js`
- Create: `functions/api/community/[id].js`

**Interfaces:**
- Consumes: `listCommunity`, `shareRecipe`, `getCommunity`, `editRecipe`, `deleteCommunity`, `ensureOnce`, `authorFrom` from `functions/_lib/community.js`; `json`, `misconfigured` from `functions/_lib/http.js`; the middleware-attached `context.data.auth` (provided by `functions/api/_middleware.js`, which gates every non-public `/api/*` route — `/api/community*` is NOT added to `PUBLIC_PATHS`); the dynamic segment `context.params.id` (Pages `[id]` routing).
- Produces: `GET/POST /api/community` and `GET/PUT/DELETE /api/community/:id`. All guard `env.DB` (`500 server_misconfigured db_binding`), call `ensureOnce(env.DB)`, read the author via `authorFrom(context)` (401 `invalid_token` if absent on mutations), parse the body, call the handler, and return `json(res.status, res.body)` (204 → empty `Response`).

- [ ] **Step 1: Create `functions/api/community.js`**

```js
// ════════════════════════════════════════════════════════
// community.js — /api/community: list (GET) + share (POST)
// Auth-gated by functions/api/_middleware.js (context.data.auth).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../_lib/http.js';
import { listCommunity, shareRecipe, ensureOnce, authorFrom } from '../_lib/community.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return misconfigured('db_binding');
  await ensureOnce(env.DB);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || null;
  const limit = url.searchParams.get('limit') || null;
  const res = await listCommunity(env.DB, { cursor, limit });
  return json(res.status, res.body);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  await ensureOnce(env.DB);
  const res = await shareRecipe(env.DB, { recipe: body && body.recipe, author });
  return json(res.status, res.body);
}
```

- [ ] **Step 2: Create `functions/api/community/[id].js`**

```js
// ════════════════════════════════════════════════════════
// community/[id].js — /api/community/:id: get (GET) + edit (PUT) + delete (DELETE)
// Auth-gated by functions/api/_middleware.js (context.data.auth).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../../_lib/http.js';
import { getCommunity, editRecipe, deleteCommunity, ensureOnce, authorFrom } from '../../_lib/community.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  await ensureOnce(env.DB);
  const res = await getCommunity(env.DB, params.id);
  return json(res.status, res.body);
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  await ensureOnce(env.DB);
  const res = await editRecipe(env.DB, { id: params.id, recipe: body && body.recipe, author });
  return json(res.status, res.body);
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  await ensureOnce(env.DB);
  const res = await deleteCommunity(env.DB, { id: params.id, author });
  if (res.status === 204) return new Response(null, { status: 204 });
  return json(res.status, res.body);
}
```

> **No `authorize` call in these routes** — `_middleware.js` has already run `authorize`, returned `401 missing_token`/`invalid_token` on failure, and set `context.data.auth` on success. The routes read `context.data.auth` via `authorFrom`.
> **`/api/community*` is NOT in `PUBLIC_PATHS`**, so the middleware gates it. No `_middleware.js` edit needed.

- [ ] **Step 3: Verify the suite still passes**

Run: `npm test`
Expected: PASS — the routes are not unit-tested (the pure handlers are, in Task 3); the live routes are exercised by the post-merge smoke test.

- [ ] **Step 4: Commit**

```bash
git add functions/api/community.js functions/api/community/[id].js
git commit -m "feat(community): /api/community Pages Function routes (list/get/share/edit/delete)"
```

---

### Task 5: Frontend community client (pure helpers + thin fetch)

**Files:**
- Create: `docs/js/lib/community.js`
- Create: `test/community-client.test.js`

**Interfaces:**
- Produces:
  - `communityState` — `{ recipes: [], nextCursor: null, loading: false, hasMore: true, error: null }`.
  - `toShareable(recipe) => object` — `toSchema(recipe)` (internal → canonical JSON-LD for the wire).
  - `toLocalCopy(canonicalRecipe) => object` — `fromSchema(canonicalRecipe)` with a fresh `_id` (for "Save to my library").
  - `fetchCommunity({ cursor, limit, onUnauthorized }) => Promise<{ ok, recipes?, nextCursor?, status?, error? }>`
  - `shareRecipe(recipe, { onUnauthorized }) => Promise<{ ok, recipe?, status?, error? }>` (POSTs `toShareable(recipe)`)
  - `saveCommunityRecipe(id, { onUnauthorized }) => Promise<{ ok, recipe?, status?, error? }>` (GETs one, returns the canonical `recipe`)
  - `editCommunityRecipe(id, recipe, { onUnauthorized }) => Promise<{ ok, recipe?, status?, error? }>` (PUTs `toShareable(recipe)`)
  - `deleteCommunityRecipe(id, { onUnauthorized }) => Promise<{ ok, status?, error? }>` (DELETE)
- Consumes: `authFetch` from `docs/js/lib/auth.js` (prepends `API_BASE='/api'`, attaches the Bearer token, clears it on 401); `toSchema`, `fromSchema`, `uuid` from `docs/js/lib/schema.js`.

- [ ] **Step 1: Create `docs/js/lib/community.js`**

```js
// ════════════════════════════════════════════════════════
// community.js — Community feed client (pure helpers + thin authFetch wrappers)
// ════════════════════════════════════════════════════════
import { authFetch } from './auth.js';
import { toSchema, fromSchema, uuid } from './schema.js';

export const communityState = { recipes: [], nextCursor: null, loading: false, hasMore: true, error: null };

/** Internal recipe -> canonical JSON-LD for the wire (POST/PUT body). */
export function toShareable(recipe) {
  return toSchema(recipe);
}

/** Canonical JSON-LD -> a local library recipe with a fresh _id (Save to my library). */
export function toLocalCopy(canonicalRecipe) {
  const internal = fromSchema(canonicalRecipe);
  internal._id = uuid();
  return internal;
}

async function readError(res) {
  try { return (await res.json()).error; } catch { return undefined; }
}

/** GET /api/community — list one page. */
export async function fetchCommunity({ cursor, limit, onUnauthorized } = {}) {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', String(limit));
  const path = `/community${qs.toString() ? '?' + qs.toString() : ''}`;
  const res = await authFetch(path, {}, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  const data = await res.json();
  return { ok: true, recipes: data.recipes || [], nextCursor: data.nextCursor || null };
}

/** POST /api/community — share a local recipe. */
export async function shareRecipe(recipe, { onUnauthorized } = {}) {
  const res = await authFetch('/community', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: toShareable(recipe) }),
  }, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  return { ok: true, recipe: await res.json() };
}

/** GET /api/community/:id — fetch one (for Save to my library). */
export async function saveCommunityRecipe(id, { onUnauthorized } = {}) {
  const res = await authFetch(`/community/${encodeURIComponent(id)}`, {}, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  const data = await res.json();
  return { ok: true, recipe: data.recipe };
}

/** PUT /api/community/:id — author edit. */
export async function editCommunityRecipe(id, recipe, { onUnauthorized } = {}) {
  const res = await authFetch(`/community/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: toShareable(recipe) }),
  }, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  return { ok: true, recipe: await res.json() };
}

/** DELETE /api/community/:id — author delete. */
export async function deleteCommunityRecipe(id, { onUnauthorized } = {}) {
  const res = await authFetch(`/community/${encodeURIComponent(id)}`, { method: 'DELETE' }, { onUnauthorized });
  if (res.status === 204) return { ok: true, status: 204 };
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  return { ok: true, status: res.status };
}
```

- [ ] **Step 2: Create `test/community-client.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toShareable, toLocalCopy } from '../docs/js/lib/community.js';

test('toShareable produces canonical JSON-LD via toSchema', () => {
  const internal = { _id: 'x', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: ['Bake'] };
  const s = toShareable(internal);
  assert.equal(s['@type'], 'Recipe');
  assert.equal(s.name, 'Pie');
  assert.ok(!s._id, 'canonical output does not leak the internal _id');
});

test('toLocalCopy converts canonical JSON-LD to a local recipe with a fresh _id', () => {
  const canonical = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Bake' }] };
  const copy = toLocalCopy(canonical);
  assert.equal(copy.name, 'Pie');
  assert.deepEqual(copy.recipeInstructions, ['Bake']); // HowToStep flattened to text
  assert.ok(copy._id && typeof copy._id === 'string', 'fresh local _id assigned');
});
```

> The fetch wrappers (`fetchCommunity`, `shareRecipe`, …) are thin `authFetch` calls and are not unit-tested (matching `docs/js/lib/auth.js`, which is also untested) — they are exercised by the manual smoke test in Task 7.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the 2 new client tests + the full suite green. (Importing `community.js` pulls in `auth.js`, whose only top-level side effect is the `typeof window`-guarded `API_BASE` — safe under Node.)

- [ ] **Step 4: Commit**

```bash
git add docs/js/lib/community.js test/community-client.test.js
git commit -m "feat(community): frontend client — toShareable/toLocalCopy + authFetch wrappers"
```

---

### Task 6: Community panel + card + list controller (browsing)

**Files:**
- Create: `docs/js/components/communityCard.js`
- Create: `docs/js/controllers/community.js`
- Modify: `docs/index.html` (nav item + `#panel-community`)
- Modify: `docs/js/app.js` (instantiate the controller)
- Modify: `docs/css/styles.css` (author badge + community card)

**Interfaces:**
- Consumes: `communityCardHTML`, `communityEmptyHTML` from `components/communityCard.js`; `fetchCommunity`, `communityState` from `lib/community.js`; `getToken` from `lib/auth.js`; `panels.register('community', render)` from `controllers/panels.js`; `toast` from `lib/dom.js`; `esc` from `lib/format.js`; the detail controller's `openCommunity(item)` (added in Task 7 — until then, card click is a no-op stub that Task 7 wires).
- Produces: `initCommunity({ state, panels, onOpenCommunityDetail, onSignedOut }) => { render, loadFirst, loadMore, share, refresh }`.

- [ ] **Step 1: Create `docs/js/components/communityCard.js`**

```js
// ════════════════════════════════════════════════════════
// components/communityCard.js — community feed card (design-system v1)
// ════════════════════════════════════════════════════════
import { esc } from '../lib/format.js';
import { Icon } from '../lib/ui.js';

/**
 * Render a community recipe item as a card. `item.recipe` is canonical JSON-LD.
 * @param {object} item { id, recipe, author: { sub, name, picture }, createdAt, updatedAt }
 * @returns {string}
 */
export function communityCardHTML(item) {
  const r = (item && item.recipe) || {};
  const name = r.name || 'Untitled';
  const ings = Array.isArray(r.recipeIngredient) ? r.recipeIngredient : [];
  const author = (item && item.author) || {};
  const avatar = author.picture
    ? `<img class="author-avatar" src="${esc(author.picture)}" alt="" width="22" height="22" referrerpolicy="no-referrer" crossorigin="anonymous">`
    : `<span class="author-avatar author-initial">${esc((author.name || '?').slice(0, 1).toUpperCase())}</span>`;
  const ingTags = ings.slice(0, 6).map((i) => `<span class="ing-tag">${esc(i)}</span>`).join('')
    + (ings.length > 6 ? `<span class="ing-tag">+${ings.length - 6} more</span>` : '');
  return `<article class="recipe-card community-card" data-id="${esc(item.id)}">
      <div class="card-body">
        <span class="badge">Recipe</span>
        <h3 class="card-title">${esc(name)}</h3>
        <div class="card-ingredients">
          <p class="ingredients-label">Ingredients</p>
          <div class="ingredient-tags">${ingTags || '<span class="ing-tag">None listed</span>'}</div>
        </div>
      </div>
      <div class="card-footer">
        <span class="author-badge">${avatar}<span class="author-name">added by ${esc(author.name || 'someone')}</span></span>
      </div>
    </article>`;
}

export function communityEmptyHTML() {
  return `<div class="empty-state">${Icon({ name: 'list' })}<strong>No shared recipes yet</strong><p>Share one from your library to start the Community.</p></div>`;
}
```

- [ ] **Step 2: Create `docs/js/controllers/community.js`**

```js
// ════════════════════════════════════════════════════════
// controllers/community.js — Community feed panel
// ════════════════════════════════════════════════════════
import { toast } from '../lib/dom.js';
import { getToken } from '../lib/auth.js';
import { fetchCommunity, communityState } from '../lib/community.js';
import { communityCardHTML, communityEmptyHTML } from '../components/communityCard.js';

/**
 * Community panel controller. Owns #community-grid: lists shared recipes with
 * author badges, loads more on demand, and routes card clicks to the detail
 * controller's openCommunity(item). Requires sign-in.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {object} deps.panels - { register(id, fn) } from controllers/panels.js
 * @param {(item: object) => void} [deps.onOpenCommunityDetail]
 * @param {() => void} [deps.onSignedOut] - fired when the server returns 401
 * @param {Document} [deps.document]
 * @returns {{ render, loadFirst, loadMore, refresh }}
 */
export function initCommunity({ state, panels, onOpenCommunityDetail = null, onSignedOut = null, document = globalThis.document }) {
  state.community = state.community || communityState;

  function render() {
    const grid = document.getElementById('community-grid');
    if (!grid) return;
    if (!getToken()) {
      grid.innerHTML = `<div class="empty-state"><strong>Sign in to see the Community</strong><p>Shared recipes from everyone in your group appear here.</p></div>`;
      return;
    }
    if (state.community.error) {
      grid.innerHTML = `<div class="empty-state"><strong>Community needs a connection</strong><p>${state.community.error}</p></div>`;
      return;
    }
    if (!state.community.recipes.length && !state.community.loading) {
      grid.innerHTML = communityEmptyHTML();
      return;
    }
    grid.innerHTML = state.community.recipes.map(communityCardHTML).join('');
    const more = document.getElementById('community-load-more');
    if (more) more.style.display = state.community.hasMore ? '' : 'none';
  }

  async function loadFirst() {
    if (!getToken()) { render(); return; }
    state.community.loading = true; state.community.error = null;
    render();
    const res = await fetchCommunity({ onUnauthorized: () => { state.community.error = 'Please sign in again.'; if (onSignedOut) onSignedOut(); } });
    state.community.loading = false;
    if (!res.ok) { state.community.error = res.error || 'Could not load the Community.'; render(); return; }
    state.community.recipes = res.recipes;
    state.community.nextCursor = res.nextCursor;
    state.community.hasMore = !!res.nextCursor;
    render();
  }

  async function loadMore() {
    if (!state.community.hasMore || state.community.loading) return;
    state.community.loading = true; render();
    const res = await fetchCommunity({ cursor: state.community.nextCursor, onUnauthorized: () => onSignedOut && onSignedOut() });
    state.community.loading = false;
    if (!res.ok) { state.community.error = res.error || 'Could not load more.'; render(); return; }
    state.community.recipes = state.community.recipes.concat(res.recipes);
    state.community.nextCursor = res.nextCursor;
    state.community.hasMore = !!res.nextCursor;
    render();
  }

  function refresh() { return loadFirst(); }

  function wireGrid() {
    const grid = document.getElementById('community-grid');
    if (grid) grid.addEventListener('click', (e) => {
      const card = e.target.closest('.community-card');
      if (card && onOpenCommunityDetail) {
        const item = state.community.recipes.find((x) => x.id === card.dataset.id);
        if (item) onOpenCommunityDetail(item);
      }
    });
    const more = document.getElementById('community-load-more');
    if (more) more.addEventListener('click', loadMore);
  }

  panels.register('community', render);
  wireGrid();
  return { render, loadFirst, loadMore, refresh };
}
```

- [ ] **Step 3: Add the nav item + panel to `docs/index.html`**

In `.sidebar-nav` (around line 35-50, after the `data-panel="settings"` button), add a Community nav item:

```html
    <button class="nav-item" data-panel="community">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-3-3"/></svg>
      <span class="nav-tab-label">Community</span>
    </button>
```

After `#panel-settings` (around line 126), add the Community panel:

```html
  <section class="panel" id="panel-community">
    <div class="panel-header">
      <h2>Community</h2>
      <span id="community-count" class="panel-count"></span>
    </div>
    <p class="panel-hint">Recipes shared by everyone in your group, marked by who added them.</p>
    <div id="community-grid" class="recipe-grid"></div>
    <div class="load-more-wrap"><button class="btn btn-ghost" id="community-load-more" style="display:none">Load more</button></div>
  </section>
```

- [ ] **Step 4: Wire the controller in `docs/js/app.js`**

Add the import (after the `initSearch` import, line 16):

```js
import { initCommunity } from './controllers/community.js';
```

Instantiate + wire it (after `const detail = initDetail({ … });` on line 22, so the community controller can call `detail.openCommunity`):

```js
const community = initCommunity({
  state,
  panels,
  onOpenCommunityDetail: (item) => detail.openCommunity(item),
  onSignedOut: () => panels.showPanel('recipes'),
});
```

(Task 7 adds `detail.openCommunity`; until then `detail.openCommunity` is undefined and card clicks no-op — that is fine for this task's browse-only deliverable.)

- [ ] **Step 5: Add minimal styles to `docs/css/styles.css`**

Append:

```css
.author-badge { display: inline-flex; align-items: center; gap: .4rem; font-size: .8rem; color: var(--ink-light, #a8a29e); }
.author-avatar { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex: 0 0 auto; }
.author-avatar.author-initial { display: inline-flex; align-items: center; justify-content: center; background: var(--surface-2, #2f2a25); color: var(--ink, #e7e5e4); font-size: .7rem; font-weight: 600; }
.author-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.load-more-wrap { display: flex; justify-content: center; padding: 1rem; }
```

- [ ] **Step 6: Verify the suite still passes**

Run: `npm test`
Expected: PASS (the frontend is not unit-tested beyond the pure helpers).

- [ ] **Step 7: Commit**

```bash
git add docs/js/components/communityCard.js docs/js/controllers/community.js docs/index.html docs/js/app.js docs/css/styles.css
git commit -m "feat(community): Community panel + author-marked cards + list controller"
```

---

### Task 7: Community detail — view, Save to my library, author Edit/Delete

**Files:**
- Modify: `docs/js/controllers/detail.js` (refactor `open` → `openRecipe(r, ctx)`; add `openCommunity(item)`; wire new footer buttons)
- Modify: `docs/js/controllers/drawer.js` (add `openCommunityEdit(item)` + `onCommunitySave` dep)
- Modify: `docs/js/controllers/community.js` (provide `share`, plus the edit/delete callbacks)
- Modify: `docs/js/app.js` (wire `drawer.openCommunityEdit`, `community.share`, onSaved refresh)
- Modify: `docs/index.html` (new detail-footer buttons: `#dm-author-badge`, `#dm-save-local-btn`, `#dm-community-edit-btn`, `#dm-community-delete-btn`)
- Modify: `docs/css/styles.css` (detail footer button visibility helpers)

**Interfaces:**
- Consumes: `fromSchema` from `docs/js/lib/schema.js` (canonical → internal for rendering); `toLocalCopy`, `saveCommunityRecipe`, `editCommunityRecipe`, `deleteCommunityRecipe`, `shareRecipe` from `docs/js/lib/community.js`; the detail modal DOM (`#dm-*`); the drawer's `openCommunityEdit`.
- Produces: `detail.openCommunity(item)` (renders a community recipe read-only-with-author-badge; shows Save-to-library always; shows Edit/Delete only when `item.author.sub === state.auth.sub`); `drawer.openCommunityEdit(item)` + `drawer.save()` branches to PUT when `state.communityEdit` is set.

- [ ] **Step 1: Add the detail-footer buttons + author badge to `docs/index.html`**

Find the detail modal footer (the container holding `#dm-edit-btn` / `#dm-schema-btn` / `#dm-add-missing-btn` / `#dm-add-all-btn`). Add, inside the detail header (near `#dm-eyebrow`), an author badge span:

```html
    <span id="dm-author-badge" class="author-badge" style="display:none"></span>
```

And in the detail footer, add three buttons (hidden by default; `detail.js` toggles them):

```html
    <button class="btn btn-ghost btn-sm" id="dm-save-local-btn" style="display:none">Save to my library</button>
    <button class="btn btn-ghost btn-sm" id="dm-community-edit-btn" style="display:none">Edit</button>
    <button class="btn btn-danger btn-sm" id="dm-community-delete-btn" style="display:none">Delete</button>
```

- [ ] **Step 2: Refactor `docs/js/controllers/detail.js` to render an arbitrary recipe**

Replace the `open(id)` function with a general `openRecipe(r, ctx)` + a local `open(id)` wrapper + a new `openCommunity(item)`. The render paths that previously did `state.recipes.find((x) => x._id === state.detailId)` now use a module-closed `current` recipe object. Concretely, replace the existing `open(id) { … }` function with:

```js
  // The recipe currently shown in the detail modal (works for local + community).
  let current = null;
  // ctx = { source: 'local' | 'community', author?: {sub,name,picture}, isAuthor?: boolean, id?: string }

  function openRecipe(r, ctx = { source: 'local' }) {
    if (!r) return;
    current = { r, ctx };
    state.detailId = ctx.source === 'local' ? r._id : null;

    const eyebrow = document.getElementById('dm-eyebrow');
    if (eyebrow) eyebrow.textContent = [r.recipeCategory, r.recipeCuisine].filter(Boolean).join(' · ');
    const title = document.getElementById('dm-title');
    if (title) title.textContent = r.name;
    const meta = document.getElementById('dm-meta');
    if (meta) meta.innerHTML = metaRowHTML(r);

    // Author badge: shown only for community recipes.
    const badge = document.getElementById('dm-author-badge');
    if (badge) {
      if (ctx.source === 'community' && ctx.author) {
        const a = ctx.author;
        const avatar = a.picture
          ? `<img class="author-avatar" src="${a.picture}" alt="" width="22" height="22" referrerpolicy="no-referrer" crossorigin="anonymous">`
          : `<span class="author-avatar author-initial">${(a.name || '?').slice(0, 1).toUpperCase()}</span>`;
        badge.innerHTML = `${avatar}<span class="author-name">added by ${a.name || 'someone'}</span>`;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    // Footer button visibility by source/ownership.
    setDisplay('dm-edit-btn', ctx.source === 'local' ? '' : 'none');
    setDisplay('dm-save-local-btn', ctx.source === 'community' ? '' : 'none');
    setDisplay('dm-community-edit-btn', ctx.source === 'community' && ctx.isAuthor ? '' : 'none');
    setDisplay('dm-community-delete-btn', ctx.source === 'community' && ctx.isAuthor ? '' : 'none');

    renderIngredients();
    const stepsEl = document.getElementById('dm-steps');
    if (stepsEl) stepsEl.innerHTML = stepsHTML(r.recipeInstructions);
    const nut = nutritionHTML(r.nutrition);
    const nutWrap = document.getElementById('dm-nutrition');
    if (nut) {
      const grid = document.getElementById('dm-nutrition-grid');
      if (grid) grid.innerHTML = nut;
      if (nutWrap) nutWrap.style.display = '';
    } else if (nutWrap) nutWrap.style.display = 'none';

    openSheet();
  }

  function setDisplay(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  }

  function open(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return;
    openRecipe(r, { source: 'local' });
  }

  /** Open a community recipe item (read-only for non-authors; author sees Edit/Delete). */
  function openCommunity(item) {
    const internal = fromSchema(item.recipe); // canonical JSON-LD -> internal model for rendering
    internal._id = item.id; // detail render uses this as a key; not persisted
    const isAuthor = !!(state.auth && item.author && state.auth.sub === item.author.sub);
    openRecipe(internal, { source: 'community', author: item.author, isAuthor, id: item.id });
  }
```

Then update the two helpers that looked the recipe up by `state.detailId` to use `current.r` instead. Replace `renderIngredients`'s first line `const r = state.recipes.find((x) => x._id === state.detailId);` with `const r = current && current.r;`, and `addToCartHandler`'s first line `const r = state.recipes.find((x) => x._id === state.detailId);` with `const r = current && current.r;`.

Add the `fromSchema` import at the top of `detail.js`:

```js
import { fromSchema } from '../lib/schema.js';
```

Add `state.auth` reading: the frontend needs the signed-in user's `sub` to decide `isAuthor`. `state.auth` is set in Task 7 Step 4 (app.js) from `loadAuth()`-equivalent. For now, `openCommunity` reads `state.auth && state.auth.sub`.

Finally, update the returned API to include `openCommunity`:

```js
  return { open, openCommunity, close: closeSheet, _renderIngredients: renderIngredients };
```

- [ ] **Step 3: Wire the new detail-footer buttons in `detail.js`'s `wireDetail()`**

Inside `wireDetail()` (after the existing `dm-add-all-btn` wiring), add handlers for Save-to-library, community Edit, community Delete. The Save handler needs a callback dep `onSaveCommunityLocal(item)` and the Edit/Delete handlers need `onEditCommunity(item)` / `onDeleteCommunity(item)`. Add these to the `initDetail` destructured params:

```js
export function initDetail({
  state,
  document = globalThis.document,
  onEdit = null,
  onSchema = null,
  onChange = null,
  onSaveCommunityLocal = null,
  onEditCommunity = null,
  onDeleteCommunity = null,
}) {
```

And in `wireDetail()`:

```js
    const saveLocalBtn = document.getElementById('dm-save-local-btn');
    if (saveLocalBtn) saveLocalBtn.addEventListener('click', () => {
      if (current && current.ctx.source === 'community' && onSaveCommunityLocal) onSaveCommunityLocal(current.ctx);
    });
    const cEditBtn = document.getElementById('dm-community-edit-btn');
    if (cEditBtn) cEditBtn.addEventListener('click', () => {
      if (current && current.ctx.source === 'community' && onEditCommunity) {
        const ctx = current.ctx;
        closeSheet();
        onEditCommunity({ id: ctx.id, author: ctx.author, recipe: current.r });
      }
    });
    const cDelBtn = document.getElementById('dm-community-delete-btn');
    if (cDelBtn) cDelBtn.addEventListener('click', () => {
      if (!current || current.ctx.source !== 'community' || !onDeleteCommunity) return;
      if (!confirm('Delete this shared recipe?')) return;
      onDeleteCommunity(current.ctx);
    });
```

- [ ] **Step 4: Add community-edit mode to `docs/js/controllers/drawer.js`**

Add an `onCommunitySave` dep and an `openCommunityEdit(item)` method; branch `save()` on `state.communityEdit`. In the `initDrawer` params, add `onCommunitySave = null`:

```js
export function initDrawer({
  state,
  document = globalThis.document,
  onSaved = null,
  onOpenDetail = null,
  onSchema = null,
  onCommunitySave = null,
}) {
```

Add `openCommunityEdit` after `openPrefilled`:

```js
  /** Open the drawer to edit a community recipe (author). Save PUTs to /api/community/:id. */
  function openCommunityEdit(item) {
    const internal = fromSchema(item.recipe); // canonical -> internal for the form
    state.communityEdit = { id: item.id, author: item.author };
    fillFromRecipe(internal);
    document.getElementById('drawer-title').textContent = 'Edit Community Recipe';
    openSheet();
  }
```

Add the `fromSchema` import to `drawer.js`:

```js
import { fromSchema } from '../lib/schema.js';
```

Branch `save()`: at the top of `save()`, after `const r = collectForm(state);` and the `validateRecipe` check, before the local insert/update, add:

```js
    if (state.communityEdit) {
      const res = onCommunitySave ? await onCommunitySave(state.communityEdit.id, r) : { ok: false, error: 'no_handler' };
      if (!res.ok) { toast(res.error || 'Could not save community recipe'); return { ok: false, error: res.error }; }
      delete state.communityEdit;
      closeSheet();
      if (onSaved) onSaved();
      toast('Community recipe updated');
      return { ok: true, recipe: r, isCommunity: true };
    }
```

(Make `save` `async` if it isn't — it currently is not async; change `function save() {` to `async function save() {` since it now `await`s `onCommunitySave`. The existing `saveBtn` click handler `() => save()` already handles a returned promise.) Return `openCommunityEdit` from the controller API:

```js
  return { open, openPrefilled, openCommunityEdit, close: closeSheet, save };
```

- [ ] **Step 5: Provide `share` + edit/delete callbacks from `controllers/community.js`**

Implement the share/save/delete actions directly in the community controller using the lib functions. First, update the import at the top of `controllers/community.js` (replace the existing `fetchCommunity`/`communityState` import line from Task 6 with one that also pulls the action helpers):

```js
import { fetchCommunity, communityState, toLocalCopy, saveCommunityRecipe, deleteCommunityRecipe, shareRecipe as shareToCommunity } from '../lib/community.js';
```

Add an `onRefreshLibrary` dep to `initCommunity`'s destructured params:

```js
export function initCommunity({ state, panels, onOpenCommunityDetail = null, onSignedOut = null, onRefreshLibrary = null, document = globalThis.document }) {
```

Add these action functions inside `initCommunity` (before `wireGrid`):

```js
  async function saveToLocal(ctx) {
    // ctx = { id } — fetch the canonical recipe, copy into the local library.
    const res = await saveCommunityRecipe(ctx.id, { onUnauthorized: () => onSignedOut && onSignedOut() });
    if (!res.ok) { toast(res.error || 'Could not save'); return { ok: false, error: res.error }; }
    const copy = toLocalCopy(res.recipe);
    state.recipes.unshift(copy);
    if (onRefreshLibrary) onRefreshLibrary();
    toast('Saved to your library');
    return { ok: true };
  }

  async function deleteShared(ctx) {
    const res = await deleteCommunityRecipe(ctx.id, { onUnauthorized: () => onSignedOut && onSignedOut() });
    if (!res.ok) { toast(res.error || 'Could not delete'); return { ok: false, error: res.error }; }
    state.community.recipes = state.community.recipes.filter((x) => x.id !== ctx.id);
    render();
    toast('Shared recipe deleted');
    return { ok: true };
  }

  async function share(recipe) {
    const res = await shareToCommunity(recipe, { onUnauthorized: () => onSignedOut && onSignedOut() });
    if (!res.ok) { toast(res.error || 'Could not share'); return { ok: false, error: res.error }; }
    await loadFirst(); // refresh the feed so the new card appears
    toast('Shared to Community');
    return { ok: true };
  }
```

Return them:

```js
  return { render, loadFirst, loadMore, refresh, saveToLocal, deleteShared, share };
```

- [ ] **Step 6: Wire everything in `docs/js/app.js`**

The frontend needs the signed-in user's `sub` so the community detail can show author Edit/Delete. Add to `state` at startup. In `app.js`, after `init();` (line 19), read the persisted identity. The session token's payload `sub` is available by decoding the JWT (no verification needed client-side — the server verifies). Add a tiny helper inline:

```js
import { loadAuth } from './lib/auth.js';
```

(`loadAuth` is already imported on line 16 of the current app.js? Check: the current app.js imports are controllers + schema-modal only — `loadAuth` is NOT imported. Add it.) After `init();`:

```js
function readSubFromToken(token) {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return json.sub || null;
  } catch { return null; }
}
const auth0 = loadAuth();
state.auth = { sub: readSubFromToken(auth0.token), email: auth0.email };
```

Update the `initDetail` call (line 22) to pass the community callbacks:

```js
const detail = initDetail({
  state,
  onEdit: (id) => drawer.open(id),
  onSchema: showRecipeSchema,
  onSaveCommunityLocal: (ctx) => community.saveToLocal(ctx),
  onEditCommunity: (item) => drawer.openCommunityEdit(item),
  onDeleteCommunity: (ctx) => community.deleteShared(ctx),
});
```

But `community` is created after `detail` currently. Reorder: create `community` before `detail`, OR use a late-binding wrapper. Simplest: declare `let community;` before `detail`, then assign after. Replace lines 22-23 region with:

```js
let community;
const detail = initDetail({
  state,
  onEdit: (id) => drawer.open(id),
  onSchema: showRecipeSchema,
  onSaveCommunityLocal: (ctx) => community.saveToLocal(ctx),
  onEditCommunity: (item) => drawer.openCommunityEdit(item),
  onDeleteCommunity: (ctx) => community.deleteShared(ctx),
});
initRecipes({ state, onOpenDetail: (id) => detail.open(id), onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema });
initPantry({ state });
initCart({ state });
const extract = initExtract({ state, openPrefilled: (r) => drawer.openPrefilled(r) });
initSettings({ state, exportRecipes: () => exportRecipesToFile(state) });
initFab({ state, openDrawer: (id) => drawer.open(id), extract, showPanel: panels.showPanel });
initSearch({ state });
community = initCommunity({
  state,
  panels,
  onOpenCommunityDetail: (item) => detail.openCommunity(item),
  onSignedOut: () => { state.auth = { sub: null, email: '' }; panels.showPanel('recipes'); },
  onRefreshLibrary: () => panels.renderActive(),
});
```

Wire the drawer's `onCommunitySave` (it PUTs via `editCommunityRecipe` and then refreshes the community feed). Update the `initDrawer` call (line 21) — but `community` is defined after `drawer`. Use a late wrapper again: `onCommunitySave: (id, recipe) => communityEditSave(id, recipe)` with a function declared below, OR move the `editCommunityRecipe` call into a small helper that doesn't need `community`. Cleanest: the drawer's `onCommunitySave` calls `editCommunityRecipe` (from the lib) directly and returns `{ ok }`; the subsequent feed refresh is handled by `onSaved` → which we wire to `community.refresh()`. So:

```js
import { editCommunityRecipe } from './lib/community.js';
const drawer = initDrawer({
  state,
  onSchema: showRecipeSchema,
  onSaved: () => panels.renderActive(),
  onCommunitySave: async (id, recipe) => {
    const res = await editCommunityRecipe(id, recipe, { onUnauthorized: () => panels.showPanel('recipes') });
    if (!res.ok) return { ok: false, error: res.error };
    // refresh the community feed if it is the active panel
    if (panels._current() === 'community') await communityRefresh();
    return { ok: true };
  },
});
```

But `communityRefresh`/`community` aren't defined when `drawer` is created. Use a module-level `let communityRefresh = async () => {};` declared at the top of app.js, assigned after `community` is created: `communityRefresh = community.refresh;`. Add near the top (after the imports):

```js
let communityRefresh = async () => {};
```

And after creating `community`: `communityRefresh = community.refresh;`.

Also: the existing `initFab`/extract flows and the Esc handler in app.js are unaffected. The Esc handler already closes `detail-modal` via `detail.close()` — `closeSheet` resets `current` implicitly (it sets `state.detailId = null`; add `current = null;` in `closeSheet` for cleanliness).

- [ ] **Step 7: Add "Share to Community" on local recipes**

In `controllers/recipes.js`, the card footer currently has Edit/Delete IconButtons. Add a Share affordance. The simplest, lowest-risk integration: add a "Share" action to the recipe detail modal's local footer (since the detail modal is the review surface) rather than crowding the card. Add a button to the detail footer in `index.html` (shown only for local recipes):

```html
    <button class="btn btn-ghost btn-sm" id="dm-share-community-btn" style="display:none">Share to Community</button>
```

In `detail.js`, in `openRecipe`, set its visibility:

```js
    setDisplay('dm-share-community-btn', ctx.source === 'local' ? '' : 'none');
```

Add an `onShareCommunity` dep to `initDetail` and wire it in `wireDetail()`:

```js
    const shareBtn = document.getElementById('dm-share-community-btn');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      if (current && current.ctx.source === 'local' && onShareCommunity) onShareCommunity(current.r);
    });
```

In `app.js`, pass `onShareCommunity: (r) => community.share(r)` into `initDetail` (requires sign-in; if not signed in, `community.share` will get a 401 and `onSignedOut` fires — but `community.onSignedOut` isn't in scope there; simplest: guard `if (!state.auth?.sub) { toast('Sign in to share'); return; }` inside `community.share`). Add that guard at the top of `share` in `controllers/community.js`:

```js
  async function share(recipe) {
    if (!state.auth || !state.auth.sub) { toast('Sign in to share to Community'); return { ok: false, error: 'not_signed_in' }; }
    const res = await shareToCommunity(recipe, { onUnauthorized: () => onSignedOut && onSignedOut() });
    if (!res.ok) { toast(res.error || 'Could not share'); return { ok: false, error: res.error }; }
    await loadFirst();
    toast('Shared to Community');
    return { ok: true };
  }
```

- [ ] **Step 8: Verify the suite still passes**

Run: `npm test`
Expected: PASS (frontend wiring is not unit-tested beyond the pure helpers).

- [ ] **Step 9: Manual smoke test (controller, `wrangler pages dev`)**

1. Create the D1 database + apply config: `npx wrangler d1 create cookbook` → paste the printed `database_id` into `wrangler.toml`. (Local dev: `npx wrangler pages dev docs --d1 DB` picks up the binding; `ensureSchema` creates the table on first request. For remote: `npx wrangler d1 execute cookbook --remote --file=docs/superpowers/migrations/0001_community_recipes.sql` is optional since `ensureSchema` self-heals.)
2. `.dev.vars` already has `SESSION_SECRET`. Sign in (the id-token now carries `name` + `picture`; verify in the network response that `/api/auth` still returns 200 and the session is minted).
3. Open the **Community** panel → empty state ("No shared recipes yet"). Open a local recipe → **Share to Community** → it appears in the Community grid with your name + avatar.
4. Reload → the Community grid still lists it (persisted in D1). "Load more" appears only when > 20 exist.
5. Tap a community recipe → detail opens, read-only, with "added by {name}" + **Save to my library**. Click it → the recipe appears in your local Recipes panel (fresh `_id`, no author badge).
6. As the author, the community detail also shows **Edit** + **Delete**. Edit → drawer opens pre-filled → Save → the community card updates. Delete → confirm → card disappears.
7. Sign out → Community panel shows "Sign in to see the Community"; local recipes/pantry/cart/search/import/export still work.
8. curl: signed-in `GET /api/community` → `{ recipes, nextCursor }`; `POST` with a `{ recipe:{name:'X'} }` → 201; `PUT /api/community/<other-author-id>` → 403 `not_author`; no/invalid Bearer → 401; missing `env.DB` (deploy without the binding) → 500 `server_misconfigured db_binding`.

- [ ] **Step 10: Commit**

```bash
git add docs/js/controllers/detail.js docs/js/controllers/drawer.js docs/js/controllers/community.js docs/js/app.js docs/index.html docs/css/styles.css
git commit -m "feat(community): community detail (view + Save to library) + author Edit/Delete + Share"
```

---

## Self-review (run against PRD 4 / spec)

- **Separate Community feed + private local library:** Community panel + `state.community` are additive; `state.recipes`/`save()`/`load()` untouched (Tasks 5-7). ✓
- **Author-marked cards:** `communityCardHTML` renders an avatar + "added by {name}" from `item.author` (Task 6). ✓
- **Author identity via session, no users table:** `verifyIdToken` surfaces `name`+`picture`; `signSession`/`verifySession` carry them; `authorFrom` stamps `author_sub/name/picture` on each row (Tasks 1-3). ✓
- **schema.org canonical on the wire, author in DB columns:** `recipe_json` stores the client-produced JSON-LD verbatim; author in columns; server never imports `toSchema`/`fromSchema` (Tasks 3-5). ✓
- **Author-only edit/delete:** `editRecipe`/`deleteCommunity` check `author_sub` → 403 `not_author`; 404 `not_found` (Task 3, tested). ✓
- **Save to my library:** `toLocalCopy` → `fromSchema` + fresh `_id` into `state.recipes` (Tasks 5, 7). ✓
- **D1 backend, keyset pagination, list/get/share/edit/delete API:** Tasks 2-4. ✓
- **Local-first preserved / offline-degrades:** Community panel shows banners; local flows untouched (Task 6). ✓
- **Reuse controllers/components pattern:** `controllers/community.js` factory + `components/communityCard.js` + `panels.register` (Task 6); detail reuses `recipeDetail` (Task 7). ✓
- **Pure handlers unit-tested with stub D1:** `test/community.test.js` (Task 3); client pure helpers in `test/community-client.test.js` (Task 5); auth-session/auth-google updated (Task 1). ✓
- **No `Buffer`:** cursor uses `btoa`/`atob`; ids use `crypto.randomUUID` + fallback (Task 3). ✓
- **GIS scopes open item resolved:** GIS default already includes `profile`; no frontend scope change (Task 1 note). ✓
- **D1 migration open item resolved:** `ensureSchema` self-heals on first request + a committed SQL file for explicit `d1 execute` (Task 2). ✓
- **Cursor encoding open item resolved:** base64url of `{c,i}` via `btoa`/`atob` (Task 3). ✓

No placeholders in code steps (the single `database_id = "REPLACE_WITH_…"` in `wrangler.toml` is runtime-generated config, documented in Deploy notes — not a code placeholder). All referenced symbols exist: `json`/`misconfigured` (`functions/_lib/http.js`); `authFetch`/`getToken`/`loadAuth` (`docs/js/lib/auth.js`); `toSchema`/`fromSchema`/`uuid` (`docs/js/lib/schema.js`); `esc`/`Icon` (`docs/js/lib/format.js`/`ui.js`); `recipeDetail` component helpers; `panels.register`/`showPanel`/`renderActive`/`_current` (`controllers/panels.js`); the `#dm-*` detail DOM. Type consistency: `item` shape `{ id, recipe, author:{sub,name,picture}, createdAt, updatedAt }` is identical across `rowToRecipe`, the route responses, the client wrappers, and `communityCardHTML`/`openCommunity`.

## Deploy notes (post-merge)

- **Create the D1 database** once: `npx wrangler d1 create cookbook` → paste the printed `database_id` into `wrangler.toml`'s `[[d1_databases]]` block (replacing the `REPLACE_WITH_…` sentinel) and commit + deploy. Git-connected Pages applies the `DB` binding from `wrangler.toml` (same as `[ai]`). Until a real `database_id` is set, `/api/community*` returns `500 server_misconfigured db_binding`.
- **Schema:** `ensureSchema` runs on the first community request and creates the table/indexes idempotently (`CREATE … IF NOT EXISTS`), so a manual migration is optional. To apply explicitly: `npx wrangler d1 execute cookbook --remote --file=docs/superpowers/migrations/0001_community_recipes.sql`.
- **Session payload change:** the JWT now carries `name`+`picture`. Existing tokens (minted before this deploy) still verify (those fields are `undefined`); `authorFrom` falls back to the email local-part so `author_name` is never empty. Users get `name`+`picture` on their next sign-in.
- **`SESSION_SECRET`** remains a Pages secret (unchanged); the `[ai]` binding (PRD 2) is unaffected.
- **Verify after deploy:** signed-in `GET /api/community` → `{ recipes, nextCursor }`; `POST` a `{ recipe:{name:'X', recipeIngredient:[…], recipeInstructions:[…]} }` → 201 and the card appears in the Community panel with your name; `PUT` another author's id → 403 `not_author`; unsigned → 401.