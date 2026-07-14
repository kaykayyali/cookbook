import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regeneratePlanRangeCart } from '../docs/js/lib/plan-range.js';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';

const workspace = {
  householdId: 'our-home', revision: 2,
  plan: [{ id: 'p1', date: '2026-07-14', type: 'recipe', recipeId: 'r1', targetServings: 4, status: 'active' }],
  cart: [{ recipeId: 'direct', ingredients: [] }, {
    recipeId: 'plan:2026-07-14:2026-07-20:r1', sourceRecipeId: 'r1', ingredients: [],
    removedIngredientNames: ['salt'], origin: { kind: 'plan', rangeStart: '2026-07-14', rangeEnd: '2026-07-20' },
  }],
  pantry: [], shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 0,
};
const recipes = [{ id: 'r1', name: 'Soup', recipeYield: '2 servings', recipeIngredient: ['1 tsp salt', '2 tomatoes'] }];

test('plan-range preview deterministically matches authority inputs and preserves tombstones', () => {
  const cart = regeneratePlanRangeCart(workspace, { rangeStart: '2026-07-14', rangeEnd: '2026-07-20' }, recipes);
  assert.equal(cart.length, 2);
  assert.equal(cart[1].targetServings, 4);
  assert.deepEqual(cart[1].removedIngredientNames, ['salt']);
});

test('offline replay applies the persisted plan-range preview before acknowledgement', () => {
  const optimisticCart = regeneratePlanRangeCart(workspace, { rangeStart: '2026-07-14', rangeEnd: '2026-07-20' }, recipes);
  const next = applyWorkspaceOperation(workspace, {
    op: 'shopping.regeneratePlanRange',
    payload: { rangeStart: '2026-07-14', rangeEnd: '2026-07-20', optimisticCart },
  });
  assert.deepEqual(next.cart, optimisticCart);
});
