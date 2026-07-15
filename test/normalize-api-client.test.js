import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecipeIngredients } from '../docs/js/lib/api.js';

const normalizedEgg = {
  raw: '1 egg', name: 'egg', displayName: 'Eggs', countLabel: '', category: 'dairy-eggs',
  quantity: 1, unit: 'count', kind: 'indivisible', confidence: 0.95,
};

test('normalization client forwards the background audit abort signal', async () => {
  const controller = new AbortController();
  let received;
  const recipes = [{ recipeId: 'r1', recipeName: 'Eggs', recipeYield: '1', ingredients: ['1 egg'] }];
  const result = await normalizeRecipeIngredients(recipes, {
    signal: controller.signal,
    request: async (path, init) => {
      received = { path, signal: init.signal };
      return new Response(JSON.stringify({ version: 2, recipes: [{ recipeId: 'r1', ingredients: [normalizedEgg] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(received.path, '/normalize');
  assert.equal(received.signal, controller.signal);
  assert.deepEqual(result, [{ recipeId: 'r1', ingredients: [normalizedEgg] }]);
});
