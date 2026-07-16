import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceOperation, createWorkspaceSync, isWorkspace } from '../docs/js/lib/workspace-sync.js';

const workspace = (overrides = {}) => ({
  householdId: 'our-home', revision: 0, plan: [], cart: [], pantry: [],
  shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 0,
  ...overrides,
});

test('workspace response validation rejects partial or malformed authority state', () => {
  assert.equal(isWorkspace(workspace()), true);
  assert.equal(isWorkspace({ revision: 0 }), false);
  assert.equal(isWorkspace(workspace({ plan: {} })), false);
  assert.equal(isWorkspace(workspace({ revision: -1 })), false);
});

test('optimistic replacement and regeneration prune transfer markers and reject invalid transfers', () => {
  const egg = { name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' };
  let current = workspace({
    cart: [{ recipeId: 'r1', ingredients: [egg] }],
    shoppingChecked: { 'pantry-transfer:egg': true },
  });
  current = applyWorkspaceOperation(current, {
    op: 'cart.upsertSelection', payload: { selection: { recipeId: 'r1', ingredients: [] } },
  });
  assert.equal(current.shoppingChecked['pantry-transfer:egg'], undefined);

  current = workspace({
    cart: [{ recipeId: 'plan:r1', ingredients: [egg], origin: { kind: 'plan' } }],
    shoppingChecked: { 'pantry-transfer:egg': true },
  });
  current = applyWorkspaceOperation(current, {
    op: 'shopping.regeneratePlanRange', payload: { optimisticCart: [] },
  });
  assert.equal(current.shoppingChecked['pantry-transfer:egg'], undefined);
  assert.throws(() => applyWorkspaceOperation(workspace(), {
    op: 'pantry.add', payload: { sourceKey: 'egg', item: {} },
  }), /invalid_pantry_item/);
});

test('invalid optimistic mutation does not poison the queue for a later valid mutation', async () => {
  const sent = [];
  let sequence = 0;
  const sync = createWorkspaceSync({
    initial: workspace(),
    makeId: () => `m${++sequence}`,
    send: async (request) => {
      sent.push(request);
      return { ok: true, workspace: workspace({ revision: 1, pantry: ['flour'] }) };
    },
  });
  assert.throws(() => sync.mutate('pantry.add', { sourceKey: 'egg', item: {} }), /invalid_pantry_item/);
  assert.equal(await sync.mutate('pantry.add', { name: 'flour' }), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sync.current().pantry.map((item) => item.name), ['flour']);
});

test('mutation applies optimistically and confirms the authoritative response', async () => {
  let resolveRequest;
  const changes = [];
  const sync = createWorkspaceSync({
    initial: workspace(),
    makeId: () => 'm1',
    send: () => new Promise((resolve) => { resolveRequest = resolve; }),
    onChange: (value, meta) => changes.push({ value, meta }),
  });
  const pending = sync.mutate('pantry.add', { name: 'flour' });
  assert.deepEqual(sync.current().pantry.map((item) => item.name), ['flour']);
  assert.equal(changes.at(-1).meta.optimistic, true);
  await Promise.resolve();
  resolveRequest({ ok: true, workspace: workspace({ revision: 1, pantry: ['flour'] }) });
  assert.equal(await pending, true);
  assert.equal(sync.current().revision, 1);
  assert.equal(changes.at(-1).meta.optimistic, false);
});

test('revision conflict rebases the absolute operation and retries once', async () => {
  const sent = [];
  const sync = createWorkspaceSync({
    initial: workspace({ pantry: ['flour'] }), makeId: () => 'm1',
    send: async (request) => {
      sent.push(request);
      if (sent.length === 1) return {
        ok: false, status: 409, workspace: workspace({ revision: 4, pantry: ['flour', 'salt'] }),
      };
      return { ok: true, workspace: workspace({ revision: 5, pantry: ['salt'] }) };
    },
  });
  assert.equal(await sync.mutate('pantry.remove', { name: 'flour' }), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].baseRevision, 0);
  assert.equal(sent[1].baseRevision, 4);
  assert.equal(sent[1].mutationId, 'm1');
  assert.deepEqual(sync.current().pantry.map((item) => item.name), ['salt']);
});

test('older response cannot overwrite a newer confirmed revision', async () => {
  const errors = [];
  const sync = createWorkspaceSync({
    initial: workspace({ revision: 3, pantry: ['salt'] }),
    makeId: () => 'm1',
    send: async () => ({ ok: true, workspace: workspace({ revision: 2, pantry: [] }) }),
    onError: (error) => errors.push(error),
  });
  assert.equal(await sync.mutate('pantry.add', { name: 'flour' }), false);
  assert.equal(sync.current().revision, 3);
  assert.deepEqual(sync.current().pantry.map((item) => item.name), ['salt']);
  assert.equal(errors[0].code, 'stale_workspace_response');
});

test('constructive stale mutation never auto-retries after a destructive remote change', async () => {
  const selection = { recipeId: 'r1', sourceServings: 2, targetServings: 2, ingredients: [] };
  const errors = [];
  let sends = 0;
  const sync = createWorkspaceSync({
    initial: workspace({ cart: [selection] }), makeId: () => 'stale-upsert',
    send: async () => {
      sends += 1;
      return { ok: false, status: 409, workspace: workspace({ revision: 1, cart: [] }) };
    },
    onError: (error) => errors.push(error),
  });
  assert.equal(await sync.mutate('cart.upsertSelection', { selection }), false);
  assert.equal(sends, 1);
  assert.deepEqual(sync.current().cart, []);
  assert.equal(errors[0].code, 'revision_conflict');
  assert.equal(typeof errors[0].retry, 'function');
});

test('terminal failure rolls back and exposes a retry action', async () => {
  const errors = [];
  let attempts = 0;
  const sync = createWorkspaceSync({
    initial: workspace({ pantry: ['salt'] }), makeId: () => 'm1',
    send: async () => { attempts += 1; return attempts === 1 ? { ok: false, status: 500 } : {
      ok: true, workspace: workspace({ revision: 1, pantry: ['flour', 'salt'] }),
    }; },
    onError: (error) => errors.push(error),
  });
  assert.equal(await sync.mutate('pantry.add', { name: 'flour' }), false);
  assert.deepEqual(sync.current().pantry.map((item) => item.name), ['salt']);
  assert.equal(typeof errors[0].retry, 'function');
  assert.equal(await errors[0].retry(), true);
  assert.deepEqual(sync.current().pantry.map((item) => item.name), ['flour', 'salt']);
});
