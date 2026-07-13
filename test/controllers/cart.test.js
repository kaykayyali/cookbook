import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (!globalThis.document) globalThis.document = { getElementById: () => null };
const { initCart } = await import('../../docs/js/controllers/cart.js');

function makeDom() {
  const grid = { innerHTML: '', addEventListener() {} };
  const clear = { addEventListener() {} };
  return { grid, document: { getElementById: (id) => id === 'cart-grid' ? grid : id === 'cart-clear-btn' ? clear : null } };
}

const selection = { recipeId: 'r1', recipeName: 'Soup', sourceServings: 4, targetServings: 4, ingredients: [{ raw: '4 eggs', name: 'egg', quantity: 4, unit: 'count', kind: 'indivisible' }] };

test('initCart exposes normalized selection controls', () => {
  const { document } = makeDom();
  const controller = initCart({ state: { cart: [], pantry: [] }, document });
  assert.equal(typeof controller.render, 'function');
  assert.equal(typeof controller.changeServings, 'function');
  assert.equal(typeof controller.removeRecipe, 'function');
  assert.equal(typeof controller.clear, 'function');
});

test('serving controls and recipe removal never mutate pantry', () => {
  const { document } = makeDom();
  const state = { cart: [selection], pantry: ['egg'] };
  const controller = initCart({ state, document });
  controller.changeServings('r1', -1);
  assert.equal(state.cart[0].targetServings, 3);
  controller.removeRecipe('r1');
  assert.deepEqual(state.cart, []);
  assert.deepEqual(state.pantry, ['egg']);
});

test('render produces selected recipes and one aggregate shopping list', () => {
  const { document, grid } = makeDom();
  const state = { cart: [selection], pantry: [] };
  initCart({ state, document }).render();
  assert.match(grid.innerHTML, /Soup/);
  assert.match(grid.innerHTML, /shopping-list/);
});
