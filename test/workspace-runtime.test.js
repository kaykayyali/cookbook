import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initWorkspaceRuntime } from '../docs/js/lib/workspace-runtime.js';

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

function seededRepo(row) {
  let rows = [structuredClone(row)];
  let cached = workspace(0);
  return {
    getWorkspace: async () => structuredClone(cached),
    putWorkspace: async (_sub, _home, value) => { cached = structuredClone(value); },
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
