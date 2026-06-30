import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, ensureSchema, authorFrom } from '../functions/_lib/community.js';

function schemaStubDb() {
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
  const { db, calls } = schemaStubDb();
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

test('editRecipe 200 for the author and updates author_name/author_picture', async () => {
  const ok = stubDb({ first: [{ author_sub: 's1', created_at: 1000 }] });
  const r1 = await editRecipe(ok.db, { id: 'r1', recipe: { name: 'Pie2' }, author: { sub: 's1', name: 'You', picture: null } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.recipe.name, 'Pie2');
  assert.equal(r1.body.createdAt, 1000);
  const upd = ok.sqls.find((s) => s.op === 'run' && s.sql.includes('UPDATE'));
  assert.ok(upd, 'UPDATE ran');
  assert.ok(upd.sql.includes('author_name = ?'), 'UPDATE sets author_name');
  assert.ok(upd.sql.includes('author_picture = ?'), 'UPDATE sets author_picture');
  // bind order: recipe_json, author_name, author_picture, updated_at, id
  assert.equal(upd.vals[1], 'You', 'UPDATE binds author_name');
  assert.equal(upd.vals[2], null, 'UPDATE binds author_picture (null when absent)');
  assert.equal(upd.vals[4], 'r1', 'UPDATE binds id');
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