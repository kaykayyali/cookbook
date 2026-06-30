// test/controllers/cart.test.js — shopping cart: mark-bought + clear + render.

import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod;
try { mod = await import('../../docs/js/controllers/cart.js'); } catch (e) { mod = {}; }

function makeDom() {
  const grid = { innerHTML: '' };
  const document = { getElementById: (sel) => (sel === 'cart-grid' ? grid : null) };
  return { grid, document };
}

const SAMPLE_CART = [
  { recipeId: 'r1', recipeName: 'Carbonara', name: 'spaghetti', line: 'spaghetti', qty: '400g', bought: false },
  { recipeId: 'r1', recipeName: 'Carbonara', name: 'eggs', line: 'eggs', qty: '4', bought: false },
  { recipeId: 'r2', recipeName: 'Shakshuka', name: 'olive oil', line: 'olive oil', qty: '2 tbsp', bought: false },
];

test('cart.js exports initCart', () => {
  assert.equal(typeof mod.initCart, 'function');
});

test('initCart returns { render, markBought, clear }', () => {
  if (!mod.initCart) return;
  const { document } = makeDom();
  const state = { cart: [], pantry: [] };
  const ctrl = mod.initCart({ state, document });
  assert.equal(typeof ctrl.render, 'function');
  assert.equal(typeof ctrl.markBought, 'function');
  assert.equal(typeof ctrl.clear, 'function');
});

test('markBought removes the item and pushes it to state.pantry', () => {
  if (!mod.initCart) return;
  const { document } = makeDom();
  const state = { cart: [...SAMPLE_CART], pantry: [] };
  let calledWith = null;
  const ctrl = mod.initCart({
    state, document,
    onPantryChange: (name) => { calledWith = name; },
  });
  ctrl.markBought({ recipeId: 'r1', line: 'spaghetti' });
  assert.equal(state.cart.length, 2, 'spaghetti should be removed');
  assert.ok(state.pantry.includes('spaghetti'), 'spaghetti should be in pantry');
  assert.equal(calledWith, 'spaghetti', 'onPantryChange should fire with the bought item');
});

test('markBought with unknown line is a no-op', () => {
  if (!mod.initCart) return;
  const { document } = makeDom();
  const state = { cart: [...SAMPLE_CART], pantry: [] };
  const ctrl = mod.initCart({ state, document });
  ctrl.markBought({ recipeId: 'r1', line: 'nonexistent' });
  assert.equal(state.cart.length, 3, 'cart should be unchanged');
  assert.equal(state.pantry.length, 0);
});

test('clear empties the cart and returns the previous length', () => {
  if (!mod.initCart) return;
  const { document } = makeDom();
  const state = { cart: [...SAMPLE_CART], pantry: [] };
  const ctrl = mod.initCart({ state, document });
  const removed = ctrl.clear();
  assert.equal(state.cart.length, 0);
  assert.equal(removed, 3);
});

test('clear on empty cart returns 0', () => {
  if (!mod.initCart) return;
  const { document } = makeDom();
  const state = { cart: [], pantry: [] };
  const ctrl = mod.initCart({ state, document });
  assert.equal(ctrl.clear(), 0);
});

test('render with cart items calls the cart HTML component', () => {
  if (!mod.initCart) return;
  const { document, grid } = makeDom();
  const state = { cart: [...SAMPLE_CART], pantry: [] };
  const ctrl = mod.initCart({ state, document });
  ctrl.render();
  assert.ok(grid.innerHTML.length > 0, 'grid should have rendered content');
});

test('render with empty cart shows the empty state', () => {
  if (!mod.initCart) return;
  const { document, grid } = makeDom();
  const state = { cart: [], pantry: [] };
  const ctrl = mod.initCart({ state, document });
  ctrl.render();
  assert.match(grid.innerHTML, /empty|no items|cart/i);
});
