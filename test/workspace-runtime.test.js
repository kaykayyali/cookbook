import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initWorkspaceRuntime } from '../docs/js/lib/workspace-runtime.js';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';
import { pantryRecordFingerprint } from '../docs/js/lib/pantry.js';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const workspace = (revision, pantry = []) => ({
  householdId: 'our-home', revision, plan: [], cart: [], pantry,
  shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: revision,
});

function stateFrom(value) {
  return {
    household: { household: { id: value.householdId } }, workspaceRevision: value.revision,
    plan: value.plan, cart: value.cart, pantry: value.pantry,
    shoppingChecked: value.shoppingChecked, manualItems: value.manualItems,
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function seededRepo(row, initial = workspace(0)) {
  let rows = (Array.isArray(row) ? row : [row]).filter(Boolean).map((value) => structuredClone(value));
  let cached = structuredClone(initial);
  let sequence = rows.reduce((max, value) => Math.max(max, value.sequence || 0), 0);
  return {
    getWorkspace: async () => structuredClone(cached),
    putWorkspace: async (_sub, _home, value) => { cached = structuredClone(value); },
    enqueue: async (value) => {
      const saved = { ...structuredClone(value), sequence: ++sequence };
      rows.push(saved);
      return structuredClone(saved);
    },
    listOutbox: async () => structuredClone(rows),
    updateOutbox: async (value) => { rows = rows.map((item) => item.sequence === value.sequence ? structuredClone(value) : item); },
    deleteOutbox: async (sequence) => { rows = rows.filter((item) => item.sequence !== sequence); },
    acknowledge: async (_sub, _home, mutationId, value) => {
      cached = structuredClone(value);
      rows = rows.filter((item) => item.mutationId !== mutationId);
    },
  };
}

test('online durable runtime immediately replays a pre-existing workspace row', async () => {
  const state = stateFrom(workspace(0));
  const row = {
    sequence: 1, mutationId: 'startup-replay', authSub: 'cook-1', householdId: 'our-home',
    scope: 'workspace', op: 'pantry.add', payload: { name: 'flour' }, status: 'pending',
    attempts: 0, nextAttemptAt: 0, lastError: null,
  };
  const repo = seededRepo(row);
  const sendObserved = deferred();
  const runtime = await initWorkspaceRuntime({
    state, repo, authSub: 'cook-1', document: { getElementById: () => null, addEventListener() {} },
    window: { navigator: { onLine: true }, addEventListener() {} }, schedule: () => 1,
    send: async (request) => {
      sendObserved.resolve(request.mutationId);
      return { ok: true, workspace: workspace(1, ['flour']) };
    },
  });

  assert.equal(await Promise.race([
    sendObserved.promise,
    new Promise((resolve) => setImmediate(() => resolve('startup-drain-not-started'))),
  ]), 'startup-replay');
  assert.equal(await runtime.drain(), true);
  assert.deepEqual(await repo.listOutbox(), []);
  assert.equal(state.workspaceRevision, 1);
  assert.deepEqual(state.pantry.map((item) => item.name), ['flour']);
});

test('durable runtime contains sending-remove Undo conflict and publishes remote record without unhandled rejection', async () => {
  const initial = workspace(1, [{
    id: 'oil', raw: '2 cups Olive Oil', name: 'olive oil', displayName: 'Olive Oil',
    quantity: 16, unit: 'ounce', kind: 'divisible', confidence: 1, updatedAt: 10,
  }]);
  const target = applyWorkspaceOperation(initial, { op: 'unknown.noop', payload: {} }).pantry[0];
  const remote = workspace(2, [{ ...target, raw: '3 cups Olive Oil', quantity: 24, updatedAt: 20 }]);
  const state = stateFrom(initial);
  const repo = seededRepo([], initial);
  const started = deferred();
  const response = deferred();
  const unhandled = [];
  const onUnhandled = (error) => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const runtime = await initWorkspaceRuntime({
      state, repo, authSub: 'cook-1', document: { getElementById: () => null, addEventListener() {} },
      window: { navigator: { onLine: true }, addEventListener() {} }, schedule: () => 1,
      send: async (request) => {
        if (request.op !== 'pantry.remove') throw new Error('dependent restore must not send');
        started.resolve();
        return response.promise;
      },
    });
    assert.equal(await runtime.mutate('pantry.remove', {
      id: target.id, expectedFingerprint: pantryRecordFingerprint(target),
    }), true);
    await started.promise;
    assert.equal(await runtime.mutate('pantry.restore', { item: target, expectedAbsent: true }), true);
    response.resolve({ ok: false, status: 409, error: 'pantry_record_conflict', workspace: remote });
    assert.equal(await runtime.drain(), false);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(state.pantry.map(({ id, quantity }) => ({ id, quantity })), [{ id: 'oil', quantity: 24 }]);
    const durable = await repo.listOutbox();
    assert.deepEqual(durable.map(({ op, status, lastError }) => ({ op, status, lastError })), [
      { op: 'pantry.remove', status: 'failed', lastError: 'pantry_record_conflict' },
      { op: 'pantry.restore', status: 'failed', lastError: 'pantry_restore_conflict' },
    ]);
    assert.equal(durable[1].undoOf, durable[0].mutationId);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('workspace runtime refreshes newer D1 authority for the other signed-in household member', async () => {
  const state = stateFrom(workspace(1, ['salt']));
  let interval;
  const listeners = {};
  const document = {
    hidden: false,
    getElementById: () => null,
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const runtime = initWorkspaceRuntime({
    state, document,
    send: async () => ({ ok: false, status: 500 }),
    fetch: async () => ({ ok: true, workspace: workspace(2, ['flour', 'salt']) }),
    schedule: (fn, ms) => { interval = { fn, ms }; return 1; },
  });
  assert.equal(interval.ms, 15_000);
  assert.equal(await runtime.refresh(), true);
  assert.deepEqual(state.pantry.map((item) => item.name), ['flour', 'salt']);
  assert.equal(state.workspaceRevision, 2);
  assert.equal(typeof listeners.visibilitychange, 'function');
});

test('workspace refresh cannot replace newer optimistic or confirmed state with stale data', async () => {
  const state = stateFrom(workspace(4, ['salt']));
  const runtime = initWorkspaceRuntime({
    state, document: { getElementById: () => null, addEventListener() {} },
    send: async () => ({ ok: false, status: 500 }),
    fetch: async () => ({ ok: true, workspace: workspace(3, []) }),
    schedule: () => 1,
  });
  assert.equal(await runtime.refresh(), false);
  assert.equal(state.workspaceRevision, 4);
  assert.deepEqual(state.pantry, ['salt']);
});
