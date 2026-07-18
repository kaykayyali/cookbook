import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIngredient,
  formatCanonicalAmount,
  normalizeCart,
  recipeSetSignature,
} from '../docs/js/lib/cart.js';

test('v2 fallback cleans leaked prefixes and broken purpose notes into display metadata', () => {
  const serving = normalizeIngredient('As desired, 2 servings fresh parsley (to serve');
  assert.equal(serving.name, 'parsley');
  assert.equal(serving.displayName, 'Parsley');
  assert.equal(serving.category, 'produce');
  assert.equal(serving.unit, 'qualitative');
  const garlic = normalizeIngredient('3 cloves garlic');
  assert.equal(garlic.countLabel, 'clove');
  assert.equal(garlic.displayName, 'Garlic');
});

test('count amounts preserve useful labels and never render generic items', () => {
  assert.equal(formatCanonicalAmount(3, 'count', { countLabel: 'clove' }), '3 cloves');
  assert.equal(formatCanonicalAmount(2, 'count', { countLabel: 'sheet' }), '2 sheets');
  assert.equal(formatCanonicalAmount(3, 'count', { countLabel: 'portion' }), '3 portions');
  assert.equal(formatCanonicalAmount(3, 'count'), '3');
});

test('practical ounce fractions stay between exact required and buffered purchase amounts', () => {
  assert.equal(formatCanonicalAmount(1.21, 'ounce', { requiredQuantity: 1.1 }), '1 1/8 oz');
  assert.equal(formatCanonicalAmount(1.122, 'ounce', { requiredQuantity: 1.02 }), '1.12 oz');
  assert.equal(formatCanonicalAmount(22, 'ounce', { requiredQuantity: 20, category: 'meat-seafood' }), '22 oz');
});

test('small cooking quantities render as safe practical cups, tablespoons, and teaspoons', () => {
  assert.equal(formatCanonicalAmount(0.045833, 'ounce', { requiredQuantity: 1 / 24, category: 'pantry' }), '¼ tsp');
  assert.equal(formatCanonicalAmount(0.091667, 'ounce', { requiredQuantity: 1 / 12, category: 'pantry' }), '½ tsp');
  assert.equal(formatCanonicalAmount(0.55, 'ounce', { requiredQuantity: .5, category: 'pantry' }), '1 tbsp');
  assert.equal(formatCanonicalAmount(2.2, 'ounce', { requiredQuantity: 2, category: 'pantry' }), '¼ cup');
  assert.equal(formatCanonicalAmount(9.9, 'ounce', { requiredQuantity: 9, category: 'pantry' }), '1⅛ cups');
});

test('fallback strips leaked count prefixes from malformed ingredient names without erasing intrinsic compounds', () => {
  assert.equal(normalizeIngredient('slices narutomaki )').name, 'narutomaki');
  assert.equal(normalizeIngredient('sheet nori seaweed )').name, 'nori seaweed');
  assert.equal(normalizeIngredient('bottle of olive oil').name, 'olive oil');
  assert.deepEqual(
    (({ name, quantity, unit, countLabel }) => ({ name, quantity, unit, countLabel }))(normalizeIngredient('2 bottles olive oil')),
    { name: 'olive oil', quantity: 2, unit: 'count', countLabel: 'bottle' },
  );
  assert.equal(normalizeIngredient('bottle gourd').name, 'bottle gourd');
});

test('recipe-set signatures ignore servings but change with membership and raw lines', () => {
  const a = [{ recipeId: 'a', recipeName: 'A', sourceServings: 2, targetServings: 2, ingredients: [{ raw: '2 eggs' }] }];
  assert.equal(recipeSetSignature(a), recipeSetSignature([{ ...a[0], targetServings: 8 }]));
  assert.notEqual(recipeSetSignature(a), recipeSetSignature([...a, { recipeId: 'b', ingredients: [{ raw: 'salt' }] }]));
  assert.notEqual(recipeSetSignature(a), recipeSetSignature([{ ...a[0], ingredients: [{ raw: '3 eggs' }] }]));
});

test('v1 selections migrate safely but remain marked stale for v2 reprocessing', () => {
  const [selection] = normalizeCart([{ recipeId: 'old', recipeName: 'Old', normalizationVersion: 1, ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' }] }]);
  assert.equal(selection.normalizationVersion, 1);
  assert.equal(selection.ingredients[0].displayName, 'Egg');
});
