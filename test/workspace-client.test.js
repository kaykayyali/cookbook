import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceOperation, createWorkspaceSync, isWorkspace } from '../docs/js/lib/workspace-sync.js';
import { PANTRY_RAW_EVIDENCE_LIMITS, pantryRecordFingerprint } from '../docs/js/lib/pantry.js';

const workspace = (overrides = {}) => ({
  householdId: 'our-home', revision: 0, plan: [], cart: [], pantry: [],
  shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 0,
  ...overrides,
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

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

test('optimistic reviewed-name replacement atomically migrates checked and transfer keys', () => {
  const onion = { raw: '1 onion', name: 'onion', quantity: 1, unit: 'count', kind: 'indivisible' };
  const shallot = { ...onion, name: 'shallot' };
  const current = applyWorkspaceOperation(workspace({
    cart: [{ recipeId: 'r1', ingredients: [onion] }],
    shoppingChecked: { onion: true, 'pantry-transfer:onion': true },
    pantry: [{ name: 'onion', quantity: 1, unit: 'count', kind: 'indivisible' }],
  }), {
    op: 'cart.upsertSelection',
    payload: { selection: { recipeId: 'r1', ingredients: [shallot] }, checkedKeys: ['shallot', 'pantry-transfer:shallot'] },
  });
  assert.equal(current.shoppingChecked.shallot, true);
  assert.equal(current.shoppingChecked['pantry-transfer:shallot'], true);
  assert.equal(current.shoppingChecked['pantry-transfer:onion'], undefined);
  const replay = applyWorkspaceOperation(current, {
    op: 'pantry.add', payload: { sourceKey: 'shallot', item: shallot },
  });
  assert.deepEqual(replay.pantry, current.pantry, 'authoritative replay cannot transfer the renamed row twice');
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

test('non-durable client sends only bounded Pantry evidence', async () => {
  let sent;
  const sync = createWorkspaceSync({
    initial: workspace(), makeId: () => 'bounded-client',
    send: async (request) => {
      sent = request;
      return { ok: true, workspace: workspace({ revision: 1, pantry: [request.payload.item] }) };
    },
  });
  const oversized = '🥚'.repeat(60_000);
  const rawEvidence = [
    'eggs', ...Array.from({ length: 220 }, (_, index) => `client-${index}-eggs`), oversized, '3 eggs',
  ];
  assert.equal(await sync.mutate('pantry.add', { item: {
    raw: '3 eggs', rawEvidence, name: 'egg', displayName: 'Egg',
    quantity: 3, unit: 'count', kind: 'indivisible',
  } }), true);
  assert.equal(sent.payload.item.raw, '3 eggs');
  assert.ok(sent.payload.item.rawEvidence.length <= PANTRY_RAW_EVIDENCE_LIMITS.maxEntries);
  assert.ok(new TextEncoder().encode(JSON.stringify(sent)).length < 10_000);
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

test('revision conflict rebases a guarded Pantry remove only when the target is unchanged', async () => {
  const sent = [];
  const initial = workspace({ pantry: ['flour'] });
  const target = applyWorkspaceOperation(initial, { op: 'unknown.noop', payload: {} }).pantry[0];
  const sync = createWorkspaceSync({
    initial, makeId: () => 'm1',
    send: async (request) => {
      sent.push(request);
      if (sent.length === 1) return {
        ok: false, status: 409, workspace: workspace({ revision: 4, pantry: [target, 'salt'] }),
      };
      return { ok: true, workspace: workspace({ revision: 5, pantry: ['salt'] }) };
    },
  });
  assert.equal(await sync.mutate('pantry.remove', {
    id: target.id, expectedFingerprint: pantryRecordFingerprint(target),
  }), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].baseRevision, 0);
  assert.equal(sent[1].baseRevision, 4);
  assert.equal(sent[1].mutationId, 'm1');
  assert.deepEqual(sync.current().pantry.map((item) => item.name), ['salt']);
});

test('stale Pantry remove never rebases over a remote update to the same stable record', async () => {
  const initial = workspace({ pantry: [{
    id: 'oil', raw: '2 cups Olive Oil', name: 'olive oil', displayName: 'Olive Oil',
    quantity: 16, unit: 'ounce', kind: 'divisible', confidence: 1, updatedAt: 10,
  }] });
  const target = applyWorkspaceOperation(initial, { op: 'unknown.noop', payload: {} }).pantry[0];
  const remote = workspace({ revision: 1, pantry: [{ ...target, raw: '3 cups Olive Oil', quantity: 24, updatedAt: 20 }] });
  const sent = [];
  const errors = [];
  const sync = createWorkspaceSync({
    initial, makeId: () => 'remove-stale', onError: (error) => errors.push(error),
    send: async (request) => { sent.push(request); return { ok: false, status: 409, workspace: remote }; },
  });
  assert.equal(await sync.mutate('pantry.remove', {
    id: target.id, expectedFingerprint: pantryRecordFingerprint(target),
  }), false);
  assert.equal(sent.length, 1);
  assert.deepEqual(sync.current().pantry.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'oil', quantity: 24 }]);
  assert.equal(errors[0].code, 'pantry_record_conflict');
});

test('non-durable Undo queued behind a sending remove is cancelled on remote record conflict', async () => {
  const initial = workspace({ revision: 1, pantry: [{
    id: 'oil', raw: '2 cups Olive Oil', name: 'olive oil', displayName: 'Olive Oil',
    quantity: 16, unit: 'ounce', kind: 'divisible', confidence: 1, updatedAt: 10,
  }] });
  const target = applyWorkspaceOperation(initial, { op: 'unknown.noop', payload: {} }).pantry[0];
  const remote = workspace({ revision: 2, pantry: [{ ...target, raw: '3 cups Olive Oil', quantity: 24, updatedAt: 20 }] });
  const started = deferred();
  const response = deferred();
  const sent = [];
  const errors = [];
  const ids = ['remove-oil', 'undo-oil'];
  const unhandled = [];
  const onUnhandled = (error) => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const sync = createWorkspaceSync({
      initial, makeId: () => ids.shift(), onError: (error) => errors.push(error),
      send: async (request) => {
        sent.push(request.op);
        if (request.op !== 'pantry.remove') throw new Error('invalid dependent restore must not send');
        started.resolve();
        return response.promise;
      },
    });
    const remove = sync.mutate('pantry.remove', {
      id: target.id, expectedFingerprint: pantryRecordFingerprint(target),
    });
    await started.promise;
    const undo = sync.mutate('pantry.restore', { item: target, expectedAbsent: true });
    response.resolve({ ok: false, status: 409, error: 'pantry_record_conflict', workspace: remote });

    assert.deepEqual(await Promise.all([remove, undo]), [false, false]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent, ['pantry.remove']);
    assert.deepEqual(errors.map(({ code }) => code), ['pantry_record_conflict', 'pantry_restore_conflict']);
    assert.deepEqual(sync.current().pantry.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'oil', quantity: 24 }]);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
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

test('optimistic pantry.update targets one stable record ID', () => {
  const initial = workspace({ pantry: ['to 4 basil leaves', 'salt'] });
  const normalized = applyWorkspaceOperation(initial, { op: 'unknown.noop', payload: {} });
  const target = normalized.pantry.find((item) => item.raw === 'to 4 basil leaves');
  const next = applyWorkspaceOperation(normalized, {
    op: 'pantry.update', createdAt: 300, payload: {
      id: target.id,
      item: {
        raw: '4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
        quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.95,
      },
    },
  });
  assert.equal(next.pantry.find((item) => item.id === target.id).amountState, 'known');
  assert.equal(next.pantry.find((item) => item.id === target.id).updatedAt, 300);
  assert.ok(next.pantry.some((item) => item.name === 'salt'));
});

test('optimistic pantry.update rejects identity loss before publishing two coalescing IDs', () => {
  const initial = workspace({ pantry: [
    {
      id: 'oil-bottles', raw: '2 bottles Oil', name: 'oil', displayName: 'Oil',
      quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', confidence: 1,
    },
    {
      id: 'oil-ounce', raw: '1 ounce Oil', name: 'oil', displayName: 'Oil',
      quantity: 1, unit: 'ounce', kind: 'divisible', countLabel: '', confidence: 1,
    },
  ] });
  const authority = applyWorkspaceOperation(initial, { op: 'unknown.noop', payload: {} });

  assert.throws(() => applyWorkspaceOperation(authority, {
    op: 'pantry.update', createdAt: 300, payload: {
      id: 'oil-bottles',
      item: {
        ...authority.pantry.find(({ id }) => id === 'oil-bottles'),
        quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', amountState: 'unknown',
      },
    },
  }), /pantry_record_conflict/);
  assert.deepEqual(authority.pantry.map(({ id }) => id).sort(), ['oil-bottles', 'oil-ounce']);
});

test('remote coalescence reports pantry_record_conflict without retrying a non-durable update', async () => {
  const bottles = {
    id: 'oil-bottles', raw: '2 bottles Oil', name: 'oil', displayName: 'Oil',
    quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', confidence: 1,
  };
  const ounce = {
    id: 'oil-ounce', raw: '1 ounce Oil', name: 'oil', displayName: 'Oil',
    quantity: 1, unit: 'ounce', kind: 'divisible', countLabel: '', confidence: 1,
  };
  const remote = workspace({ revision: 1, pantry: [bottles, ounce] });
  const sent = [];
  const errors = [];
  const sync = createWorkspaceSync({
    initial: workspace({ pantry: [bottles] }), makeId: () => 'coalescing-update',
    send: async (request) => {
      sent.push(request);
      return { ok: false, status: 409, error: 'pantry_record_conflict', workspace: remote };
    },
    onError: (error) => errors.push(error),
  });
  const target = sync.current().pantry[0];

  assert.equal(await sync.mutate('pantry.update', { id: target.id, item: {
    ...target, quantity: null, unit: 'qualitative', kind: 'qualitative',
    countLabel: '', amountState: 'unknown',
  } }), false);
  assert.equal(sent.length, 1);
  assert.equal(errors.at(-1).code, 'pantry_record_conflict');
  assert.deepEqual(sync.current().pantry.map(({ id }) => id).sort(), ['oil-bottles', 'oil-ounce']);
});

test('non-rebasable pantry.update rolls back cleanly when another member removed the record', async () => {
  const initial = workspace({ revision: 1, pantry: ['to 4 basil leaves'] });
  const target = applyWorkspaceOperation(initial, { op: 'unknown.noop', payload: {} }).pantry[0];
  const errors = [];
  const sync = createWorkspaceSync({
    initial,
    makeId: () => 'edit-removed-record',
    send: async () => ({ ok: false, status: 409, workspace: workspace({ revision: 2, pantry: [] }) }),
    onError: (error) => errors.push(error),
  });
  assert.equal(await sync.mutate('pantry.update', {
    id: target.id,
    item: { ...target, raw: '4 basil leaves', quantity: 4, unit: 'count', confidence: 0.95 },
  }), false);
  assert.deepEqual(sync.current().pantry, []);
  assert.equal(errors[0].code, 'revision_conflict');
});
