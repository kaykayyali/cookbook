// Regression test for the context.data auth contract (Fix 1).
// Locks that /api/community routes read the author from context.data.auth
// (set by functions/api/_middleware.js) — not request.auth (a Request expando
// that does not survive next() in the Workers runtime). Re-applying the
// context.data fix fixes both the community 401s and the /api/extract break.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/community.js';

// Queue-based stub D1, mirroring test/community.test.js. shareRecipe only
// calls .run() (INSERT); ensureOnce calls db.batch (idempotent no-op here).
function stubDb() {
  function mkStmt(sql) {
    const s = {
      bind(...vals) { s._vals = vals; return s; },
      all: async () => ({ results: [], meta: {} }),
      first: async () => null,
      run: async () => ({ meta: { changes: 1 } }),
    };
    return s;
  }
  return { prepare: (sql) => mkStmt(sql), batch: async (a) => a.map(() => ({ meta: {} })) };
}

function makeContext({ data }) {
  return {
    data,
    env: { DB: stubDb() },
    request: { json: async () => ({ recipe: { name: 'Pie' } }) },
  };
}

test('community POST shares (201) when context.data.auth is present', async () => {
  const ctx = makeContext({ data: {
    auth: { sub: 's1', email: 'you@example.com', name: 'You', picture: null },
    household: { household: { id: 'our-home', name: 'Our Home' }, member: { id: 's1' } },
  } });
  const res = await onRequestPost(ctx);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.author.name, 'You');
  assert.ok(body.id, 'server-generated id');
});

test('community POST 401 invalid_token when context.data.auth is absent', async () => {
  const ctx = makeContext({ data: {} });
  const res = await onRequestPost(ctx);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'invalid_token');
});

test('community POST fails closed when auth exists without resolved household membership', async () => {
  const ctx = makeContext({ data: {
    auth: { sub: 's1', email: 'you@example.com', name: 'You', picture: null },
    household: null,
  } });
  const res = await onRequestPost(ctx);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'household_required' });
});