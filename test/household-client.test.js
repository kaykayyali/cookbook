import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureHouseholdMembership } from '../docs/js/lib/api.js';
import { state, loadHousehold, loadWorkspace } from '../docs/js/lib/store.js';

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test('eligible signed-in client accepts household invitation during boot', async () => {
  const calls = [];
  const request = async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET' });
    if ((init.method || 'GET') === 'GET') {
      return response(200, { household: null, member: null, eligible: true });
    }
    return response(201, {
      household: { id: 'our-home', name: 'Our Home' },
      member: { id: 'g', displayName: 'Gloria', picture: null, role: 'member' },
    });
  };

  const result = await ensureHouseholdMembership({ request });
  assert.equal(result.ok, true);
  assert.equal(result.membership.member.displayName, 'Gloria');
  assert.deepEqual(calls, [
    { path: '/household', method: 'GET' },
    { path: '/household', method: 'POST' },
  ]);
});

test('uninvited signed-in client fails closed without a join attempt', async () => {
  const calls = [];
  const request = async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET' });
    return response(200, { household: null, member: null, eligible: false });
  };

  const result = await ensureHouseholdMembership({ request });
  assert.deepEqual(result, { ok: false, error: 'household_not_invited' });
  assert.deepEqual(calls, [{ path: '/household', method: 'GET' }]);
});

test('household resolution fails closed for malformed, failed, and unavailable responses', async () => {
  const malformed = await ensureHouseholdMembership({
    request: async () => response(200, {}),
  });
  assert.deepEqual(malformed, { ok: false, error: 'invalid_household' });

  const failedStatus = await ensureHouseholdMembership({
    request: async () => response(503, { error: 'unavailable' }),
  });
  assert.deepEqual(failedStatus, { ok: false, error: 'household_unavailable' });

  const failedJoin = await ensureHouseholdMembership({
    request: async (_path, init = {}) => (init.method === 'POST'
      ? response(503, { error: 'unavailable' })
      : response(200, { household: null, member: null, eligible: true })),
  });
  assert.deepEqual(failedJoin, { ok: false, error: 'household_join_failed' });

  const networkFailure = await ensureHouseholdMembership({
    request: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(networkFailure, { ok: false, error: 'household_unavailable' });
});

test('store records resolved household display data without persisting it locally', async () => {
  const membership = {
    household: { id: 'our-home', name: 'Our Home' },
    member: { id: 'k', displayName: 'Kaysser', picture: null, role: 'owner' },
  };
  const loaded = await loadHousehold({ resolve: async () => ({ ok: true, membership, eligible: true }) });

  assert.equal(loaded, true);
  assert.deepEqual(state.household, membership);
  assert.equal(state.householdEligible, true);
});

test('store rejects a nominally successful response without membership', async () => {
  const loaded = await loadHousehold({
    resolve: async () => ({ ok: true, membership: null, eligible: true }),
  });
  assert.equal(loaded, false);
  assert.equal(state.household, null);
});

test('store loads authoritative household workspace into existing cart and pantry shapes', async () => {
  const workspace = {
    householdId: 'our-home', revision: 7,
    plan: [{ id: 'meal-1' }], cart: [{ recipeId: 'r1', ingredients: [] }], pantry: ['flour'],
    shoppingChecked: { 'ingredient:flour': true }, manualItems: [{ id: 'm1', name: 'flowers' }],
    recentMutations: [], updatedAt: 10,
  };
  const loaded = await loadWorkspace({ fetch: async () => ({ ok: true, workspace }) });
  assert.equal(loaded, true);
  assert.equal(state.workspaceRevision, 7);
  assert.deepEqual(state.plan, workspace.plan);
  assert.deepEqual(state.cart, workspace.cart);
  assert.deepEqual(state.pantry.map((item) => item.name), ['flour']);
  assert.deepEqual(state.shoppingChecked, workspace.shoppingChecked);
  assert.deepEqual(state.manualItems.map(({ id, name, quantity, unit }) => ({ id, name, quantity, unit })), [
    { id: 'm1', name: 'flower', quantity: null, unit: 'qualitative' },
  ]);
  assert.equal(state.workspaceLoaded, true);
});

test('authenticated app renders valid saved household state before network and revalidates before refresh', () => {
  const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{ state, init, loadHousehold, loadRecipes, loadWorkspace \}/);
  assert.match(app, /const householdOk = await loadHousehold\(/);
  assert.match(app, /if \(!householdOk \|\| !state\.household\)/);
  assert.ok(app.indexOf('await hydrateOfflineState(') < app.indexOf('await loadHousehold('));
  assert.ok(app.indexOf('if (cached.cached) await wire()') < app.indexOf('await loadHousehold('));
  assert.ok(app.indexOf('if (!householdOk || !state.household)') < app.indexOf('await loadRecipes('));
  assert.ok(app.indexOf('await loadRecipes(') < app.indexOf('await loadWorkspace('));
  assert.match(app, /ui = wireAuthenticatedUi/);
});
