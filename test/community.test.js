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