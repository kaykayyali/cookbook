import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA,
  listCommunity,
  getCommunity,
  shareRecipe,
  editRecipe,
  deleteCommunity,
} from '../functions/_lib/community.js';

function stubDb({ all = [], first = [] } = {}) {
  const calls = [];
  const allQueue = [...all];
  const firstQueue = [...first];
  function statement(sql) {
    const stmt = {
      bind(...values) { stmt.values = values; return stmt; },
      async all() {
        calls.push({ op: 'all', sql, values: stmt.values || [] });
        return allQueue.shift() ?? { results: [] };
      },
      async first() {
        calls.push({ op: 'first', sql, values: stmt.values || [] });
        return firstQueue.shift() ?? null;
      },
      async run() {
        calls.push({ op: 'run', sql, values: stmt.values || [] });
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  }
  return {
    db: {
      prepare: (sql) => statement(sql),
      batch: async (statements) => Promise.all(statements.map((stmt) => stmt.run())),
    },
    calls,
  };
}

const householdRow = (overrides = {}) => ({
  id: 'r1',
  household_id: 'our-home',
  added_by_sub: 'cook-1',
  added_by_name: 'Kaysser',
  added_by_picture: null,
  recipe_json: JSON.stringify({ '@type': 'Recipe', name: 'Soup' }),
  created_at: 1000,
  updated_at: 1000,
  ...overrides,
});

test('household recipe schema and migration preserve legacy recipes with explicit attribution', () => {
  const migration = readFileSync(
    new URL('../docs/superpowers/migrations/0005_household_recipes.sql', import.meta.url),
    'utf8',
  );

  for (const source of [SCHEMA, migration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS household_recipes/);
    assert.match(source, /household_id\s+TEXT\s+NOT NULL/);
    assert.match(source, /added_by_sub\s+TEXT\s+NOT NULL/);
    assert.match(source, /idx_household_recipes_created/);
  }
  assert.match(migration, /INSERT OR IGNORE INTO household_recipes/);
  assert.match(migration, /SELECT[\s\S]*author_sub[\s\S]*FROM community_recipes/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM community_recipes/);
});

test('list and get queries are scoped to the resolved household', async () => {
  const listedDb = stubDb({ all: [{ results: [householdRow()] }] });
  const listed = await listCommunity(listedDb.db, { householdId: 'our-home', limit: 20 });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.recipes[0].householdId, 'our-home');
  assert.equal(listed.body.recipes[0].author.sub, 'cook-1');
  const listQuery = listedDb.calls.find((call) => call.op === 'all');
  assert.match(listQuery.sql, /FROM household_recipes/);
  assert.match(listQuery.sql, /household_id = \?/);
  assert.equal(listQuery.values[0], 'our-home');

  const foundDb = stubDb({ first: [householdRow()] });
  const found = await getCommunity(foundDb.db, { id: 'r1', householdId: 'our-home' });
  assert.equal(found.status, 200);
  const getQuery = foundDb.calls.find((call) => call.op === 'first');
  assert.match(getQuery.sql, /WHERE (?:r\.)?id = \? AND (?:r\.)?household_id = \?/);
  assert.deepEqual(getQuery.values, ['r1', 'our-home']);
});

test('create stamps household and added-by identity from server context', async () => {
  const { db, calls } = stubDb();
  const result = await shareRecipe(db, {
    householdId: 'our-home',
    recipe: { '@type': 'Recipe', name: 'Soup' },
    author: { sub: 'cook-1', name: 'Kaysser', picture: null },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.householdId, 'our-home');
  assert.equal(result.body.author.sub, 'cook-1');
  const insert = calls.find((call) => call.op === 'run');
  assert.match(insert.sql, /INSERT(?: OR IGNORE)? INTO household_recipes/);
  assert.deepEqual(insert.values.slice(1, 3), ['our-home', 'cook-1']);
});

test('edit and delete enforce household scope before author ownership', async () => {
  const editDb = stubDb({ first: [{ added_by_sub: 'cook-1', created_at: 1000 }] });
  const edited = await editRecipe(editDb.db, {
    id: 'r1',
    householdId: 'our-home',
    recipe: { name: 'Better Soup' },
    author: { sub: 'cook-1', name: 'Kaysser', picture: null },
  });
  assert.equal(edited.status, 200);
  assert.match(editDb.calls[0].sql, /WHERE (?:r\.)?id = \? AND (?:r\.)?household_id = \?/);
  assert.deepEqual(editDb.calls[0].values, ['r1', 'our-home']);
  const update = editDb.calls.find((call) => call.op === 'run');
  assert.match(update.sql, /WHERE id = \? AND household_id = \? AND added_by_sub = \?/);

  const deleteDb = stubDb({ first: [{ added_by_sub: 'cook-1' }] });
  const deleted = await deleteCommunity(deleteDb.db, {
    id: 'r1',
    householdId: 'our-home',
    author: { sub: 'cook-1' },
  });
  assert.equal(deleted.status, 204);
  const removals = deleteDb.calls.filter((call) => call.op === 'run');
  assert.equal(removals.length, 2, 'deletion clears the live row and its legacy migration source');
  assert.match(removals[0].sql, /DELETE FROM household_recipes/);
  assert.match(removals[0].sql, /WHERE id = \? AND household_id = \? AND added_by_sub = \?/);
  assert.match(removals[1].sql, /DELETE FROM community_recipes WHERE id = \?/);
});

test('recipe operations fail closed without a resolved household', async () => {
  const { db, calls } = stubDb();
  const listed = await listCommunity(db, {});
  const created = await shareRecipe(db, {
    recipe: { name: 'Soup' },
    author: { sub: 'cook-1', name: 'Kaysser', picture: null },
  });
  assert.deepEqual(listed, { status: 403, body: { error: 'household_required' } });
  assert.deepEqual(created, { status: 403, body: { error: 'household_required' } });
  assert.equal(calls.length, 0, 'no recipe query runs without household membership');
});
