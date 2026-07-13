import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartGroupsHTML } from '../docs/js/components/cart.js';

const cart = [{
  recipeId: 'r1', recipeName: 'Omelet', sourceServings: 4, targetServings: 2,
  ingredients: [{ raw: '4 eggs', name: 'egg', quantity: 4, unit: 'count', kind: 'indivisible' }],
}];

test('cart component renders concise recipe serving controls and one aggregated list', () => {
  const html = cartGroupsHTML(cart, ['egg']);
  assert.match(html, /Omelet/);
  assert.match(html, /data-action="servings-down"/);
  assert.match(html, /data-action="servings-up"/);
  assert.match(html, />2 servings</);
  assert.equal((html.match(/shopping-list/g) || []).length, 1);
  assert.match(html, /egg/);
  assert.match(html, /in pantry/i);
  assert.match(html, /data-action="remove-item"/);
});

test('pantry matching uses canonical equality instead of substring matches', () => {
  const eggplantPantry = cartGroupsHTML(cart, ['eggplant']);
  assert.doesNotMatch(eggplantPantry, /in pantry/i);
});

test('low-confidence quantities remain visibly uncertain', () => {
  const uncertainCart = [{ ...cart[0], ingredients: [{ ...cart[0].ingredients[0], confidence: 0.4 }] }];
  assert.match(cartGroupsHTML(uncertainCart, []), /check amount/i);
});

test('pantry only adds an informational indicator and never removes the item', () => {
  const without = cartGroupsHTML(cart, []);
  const withPantry = cartGroupsHTML(cart, ['egg']);
  assert.match(without, /egg/);
  assert.match(withPantry, /egg/);
  assert.doesNotMatch(without, /in pantry/i);
  assert.match(withPantry, /in pantry/i);
});
