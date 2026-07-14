import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateOfflineState } from '../docs/js/lib/offline-bootstrap.js';

const workspace = {
  householdId: 'our-home', revision: 4, plan: [], cart: [], pantry: ['salt'],
  shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 4,
};

test('valid subject-partitioned cache hydrates household recipes and workspace before network', async () => {
  const state = { workspaceRevision: 0 };
  const repo = {
    getMembership: async () => ({ household: { id: 'our-home', name: 'Our Home' }, member: { id: 'm1', displayName: 'Cook', role: 'member' } }),
    getRecipes: async () => [{ id: 'r1', name: 'Saved soup' }],
    getWorkspace: async () => workspace,
  };
  const result = await hydrateOfflineState({ repo, authSub: 'cook-1', state });
  assert.equal(result.cached, true);
  assert.equal(state.household.household.id, 'our-home');
  assert.equal(state.recipes[0].name, 'Saved soup');
  assert.deepEqual(state.pantry, ['salt']);
  assert.equal(state.workspaceRevision, 4);
  assert.equal(state.offlineCache, true);
});

test('partial or invalid cache never presents an empty authoritative household', async () => {
  const state = { recipes: [{ id: 'existing' }], workspaceRevision: 0 };
  const repo = {
    getMembership: async () => ({ household: { id: 'our-home' }, member: { id: 'm1' } }),
    getRecipes: async () => null,
    getWorkspace: async () => workspace,
  };
  const result = await hydrateOfflineState({ repo, authSub: 'cook-1', state });
  assert.equal(result.cached, false);
  assert.deepEqual(state.recipes, [{ id: 'existing' }]);
});
