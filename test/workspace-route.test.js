import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPatch } from '../functions/api/workspace.js';

function rowFor(householdId = 'our-home') {
  return {
    household_id: householdId,
    revision: 0,
    plan_json: '[]',
    cart_json: '[]',
    pantry_json: '[]',
    shopping_checked_json: '{}',
    manual_items_json: '[]',
    recent_mutations_json: '[]',
    updated_at: 0,
  };
}

function workspaceDb() {
  let row = rowFor();
  const calls = [];
  const batches = [];
  function prepare(sql) {
    const stmt = {
      sql,
      bind(...values) { stmt.values = values; return stmt; },
      async first() {
        calls.push({ op: 'first', sql, values: stmt.values || [] });
        if (/FROM household_workspace WHERE/.test(sql)) return { ...row };
        return null;
      },
      async all() {
        calls.push({ op: 'all', sql, values: stmt.values || [] });
        return { results: [] };
      },
      async run() {
        const values = stmt.values || [];
        calls.push({ op: 'run', sql, values });
        if (/UPDATE household_workspace/.test(sql)) {
          const expectedRevision = values.at(-1);
          if (expectedRevision !== row.revision) return { meta: { changes: 0 } };
          row = {
            household_id: values[7], revision: row.revision + 1,
            plan_json: values[0], cart_json: values[1], pantry_json: values[2],
            shopping_checked_json: values[3], manual_items_json: values[4],
            recent_mutations_json: values[5], updated_at: values[6],
          };
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  }
  return {
    db: {
      prepare,
      batch: async (statements) => {
        batches.push(statements.map((stmt) => stmt.sql));
        return Promise.all(statements.map((stmt) => stmt.run()));
      },
    },
    calls,
    batches,
    current: () => ({ ...row }),
  };
}

function context(db, { household = true, body = null } = {}) {
  return {
    env: { DB: db },
    data: household ? {
      auth: { sub: 'cook-1' },
      household: { household: { id: 'our-home' }, member: { id: 'cook-1' } },
    } : { auth: { sub: 'cook-1' }, household: null },
    request: new Request('https://cookbook.test/api/workspace', body ? {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : undefined),
  };
}

test('workspace route fails closed without resolved household membership', async () => {
  const { db, calls } = workspaceDb();
  const response = await onRequestGet(context(db, { household: false }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'household_required' });
  assert.equal(calls.length, 0);
});

test('workspace PATCH applies an absolute operation with revision CAS', async () => {
  const store = workspaceDb();
  const response = await onRequestPatch(context(store.db, { body: {
    mutationId: 'mutation-1', baseRevision: 0, op: 'pantry.add', payload: { name: 'flour' },
  } }));
  assert.equal(response.status, 200);
  const workspace = await response.json();
  assert.equal(workspace.revision, 1);
  assert.deepEqual(workspace.pantry, ['flour']);
  assert.equal(store.current().revision, 1);
});

test('successful CAS atomically batches the workspace update with a conditional mutation receipt', async () => {
  const store = workspaceDb();
  const response = await onRequestPatch(context(store.db, { body: {
    mutationId: 'atomic-1', baseRevision: 0, op: 'pantry.add', payload: { name: 'flour' },
  } }));
  assert.equal(response.status, 200);
  const commit = store.batches.find((batch) => batch.some((sql) => /UPDATE household_workspace/.test(sql)));
  assert.equal(commit.length, 2);
  assert.match(commit[1], /INSERT INTO household_workspace_mutations/);
  assert.match(commit[1], /WHERE changes\(\) = 1/);
});

test('retrying a committed mutation is idempotent even with a stale base revision', async () => {
  const store = workspaceDb();
  const body = { mutationId: 'same', baseRevision: 0, op: 'pantry.add', payload: { name: 'flour' } };
  assert.equal((await onRequestPatch(context(store.db, { body }))).status, 200);
  const duplicate = await onRequestPatch(context(store.db, { body }));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).revision, 1);
});

test('stale revision returns 409 with the current authoritative workspace', async () => {
  const store = workspaceDb();
  await onRequestPatch(context(store.db, { body: {
    mutationId: 'first', baseRevision: 0, op: 'pantry.add', payload: { name: 'flour' },
  } }));
  const stale = await onRequestPatch(context(store.db, { body: {
    mutationId: 'second', baseRevision: 0, op: 'pantry.add', payload: { name: 'salt' },
  } }));
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.equal(body.error, 'revision_conflict');
  assert.equal(body.workspace.revision, 1);
  assert.deepEqual(body.workspace.pantry, ['flour']);
});

test('planner attribution comes from authenticated membership, not client payload', async () => {
  const store = workspaceDb();
  const response = await onRequestPatch(context(store.db, { body: {
    mutationId: 'plan-actor', baseRevision: 0, op: 'plan.upsert', payload: {
      id: 'meal-1', date: '2026-07-14', type: 'recipe', recipeId: 'r1',
      targetServings: 2, plannedBySub: 'spoofed-member', status: 'active',
    },
  } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).plan[0].plannedBySub, 'cook-1');
});
