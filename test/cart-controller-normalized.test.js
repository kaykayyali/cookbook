import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (!globalThis.document) globalThis.document = { getElementById: () => null };
const { initCart } = await import('../docs/js/controllers/cart.js');

function dom() {
  const listeners = {};
  const grid = { innerHTML: '', addEventListener: (type, fn) => { listeners[type] = fn; } };
  const clear = { addEventListener() {} };
  return { grid, listeners, document: { getElementById: (id) => id === 'cart-grid' ? grid : id === 'cart-clear-btn' ? clear : null } };
}

const selection = { recipeId: 'r1', recipeName: 'Soup', sourceServings: 4, targetServings: 4, ingredients: [] };

test('delegated serving and item-removal controls dispatch through the grid', () => {
  const { document, listeners } = dom();
  const state = { cart: [{ ...selection, ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' }] }], pantry: [] };
  initCart({ state, document });
  listeners.click({ target: { closest: () => ({ dataset: { action: 'servings-up', recipeId: 'r1' } }) } });
  assert.equal(state.cart[0].targetServings, 5);
  listeners.click({ target: { closest: () => ({ dataset: { action: 'remove-item', name: 'egg' } }) } });
  assert.deepEqual(state.cart[0].ingredients, []);
});

test('cart controller adjusts target servings and persists through its public API', () => {
  const { document } = dom();
  const state = { cart: [selection], pantry: [] };
  const ctrl = initCart({ state, document });
  assert.equal(typeof ctrl.changeServings, 'function');
  ctrl.changeServings('r1', -1);
  assert.equal(state.cart[0].targetServings, 3);
  ctrl.changeServings('r1', 1);
  assert.equal(state.cart[0].targetServings, 4);
});

test('cart controller removes an individual aggregate shopping item', () => {
  const { document } = dom();
  const state = { cart: [{ ...selection, ingredients: [
    { raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' },
    { raw: '1 cup milk', name: 'milk', quantity: 8, unit: 'ounce', kind: 'divisible' },
  ] }], pantry: [] };
  const ctrl = initCart({ state, document });
  assert.equal(ctrl.removeItem('egg'), true);
  assert.deepEqual(state.cart[0].ingredients.map((item) => item.name), ['milk']);
});

test('cart controller removes a selected recipe rather than ingredient contributions', () => {
  const { document } = dom();
  const state = { cart: [selection], pantry: ['salt'] };
  const ctrl = initCart({ state, document });
  assert.equal(ctrl.removeRecipe('r1'), true);
  assert.deepEqual(state.cart, []);
  assert.deepEqual(state.pantry, ['salt'], 'pantry remains informational');
});
