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
