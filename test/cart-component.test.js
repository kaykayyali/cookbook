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

test('serving controls use singular grammar for one serving', () => {
  const html = cartGroupsHTML([{ recipeId: 'one', recipeName: 'Solo', sourceServings: 1, targetServings: 1, ingredients: [] }]);
  assert.match(html, />1 serving<\/span>/);
  assert.doesNotMatch(html, />1 servings<\/span>/);
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

test('shopping rows use accessible check and overflow controls without a permanent remove column', () => {
  const html = cartGroupsHTML(cart, [], {});
  assert.match(html, /class="cart-check"/);
  assert.match(html, /class="cart-item-menu"/);
  assert.match(html, /data-action="toggle-item"/);
  assert.doesNotMatch(html, /class="btn btn-ghost btn-sm cart-item-remove"/);
});

test('checked rows move to a collapsed completed section with restore controls', () => {
  const html = cartGroupsHTML(cart, [], { egg: true });
  assert.match(html, /<details class="cart-completed">/);
  assert.match(html, /Completed \(1\)/);
  assert.doesNotMatch(html, /<details class="cart-completed" open/);
  assert.match(html, /aria-label="Mark Egg as not completed"/);
});

test('manual household items render independently from recipe normalization', () => {
  const html = cartGroupsHTML([], [], { 'manual:m1': true }, [{ id: 'm1', name: 'Flowers' }]);
  assert.match(html, /Flowers/);
  assert.match(html, /data-action="toggle-manual"/);
  assert.match(html, /data-action="remove-manual"/);
  assert.match(html, /Completed \(1\)/);
});

test('shopping filter narrows recipe and manual rows without mutating the cart', () => {
  const manual = [{ id: 'm1', name: 'Flowers' }];
  const html = cartGroupsHTML(cart, [], {}, manual, 'flow');
  assert.match(html, /Flowers/);
  assert.doesNotMatch(html, />Egg</);
  assert.equal(cart.length, 1);
});
