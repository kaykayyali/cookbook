// Tests for lib/cart.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCartItem,
  addToCart,
  markBought,
  removeFromCart,
  clearRecipeFromCart,
  clearCart,
} from '../docs/js/lib/cart.js';

const RECIPES = {
  shakshuka: { _id: 'r1', name: 'Shakshuka', recipeIngredient: ['2 tablespoons olive oil', '6 large eggs', 'salt to taste'] },
  alfredo: { _id: 'r2', name: 'Alfredo Sauce', recipeIngredient: ['3 eggs', '1 cup parmesan'] },
};

test('makeCartItem parses qty and base name and tags the recipe', () => {
  assert.deepEqual(makeCartItem('2 tablespoons olive oil', RECIPES.shakshuka), {
    name: 'olive oil', line: '2 tablespoons olive oil', qtyText: '2 tablespoons',
    recipeId: 'r1', recipeName: 'Shakshuka',
  });
  assert.deepEqual(makeCartItem('salt to taste', RECIPES.shakshuka), {
    name: 'salt to taste', line: 'salt to taste', qtyText: '',
    recipeId: 'r1', recipeName: 'Shakshuka',
  });
});

test('addToCart(missing) adds only not-in-pantry lines', () => {
  const pantry = ['olive oil'];
  const { cart, addedCount } = addToCart([], RECIPES.shakshuka, pantry, 'missing');
  // olive oil is in pantry -> excluded; eggs + salt added
  assert.equal(addedCount, 2);
  assert.deepEqual(cart.map((c) => c.name).sort(), ['eggs', 'salt to taste']);
});

test('addToCart(all) adds every line regardless of pantry', () => {
  const pantry = ['olive oil'];
  const { cart, addedCount } = addToCart([], RECIPES.shakshuka, pantry, 'all');
  assert.equal(addedCount, 3);
  assert.equal(cart.length, 3);
});

test('addToCart is idempotent: re-adding a recipe replaces its contributions', () => {
  const first = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const again = addToCart(first, RECIPES.shakshuka, [], 'all').cart;
  // not duplicated
  const shak = again.filter((c) => c.recipeId === 'r1');
  assert.equal(shak.length, 3);
});

test('addToCart does not mutate its inputs', () => {
  const cart = [];
  const before = [...cart];
  addToCart(cart, RECIPES.shakshuka, [], 'all');
  assert.deepEqual(cart, before, 'input cart array unchanged');
});

test('removeFromCart removes one contribution by (recipeId, line) and is pure', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const next = removeFromCart(cart, 'r1', '6 large eggs');
  assert.equal(next.length, cart.length - 1);
  assert.deepEqual(cart.length, 3, 'input unchanged');
});

test('clearRecipeFromCart drops a recipe and clearCart empties everything', () => {
  const cart = [
    ...addToCart([], RECIPES.shakshuka, [], 'all').cart,
    ...addToCart([], RECIPES.alfredo, [], 'all').cart,
  ];
  const oneGone = clearRecipeFromCart(cart, 'r1');
  assert.equal(oneGone.filter((c) => c.recipeId === 'r1').length, 0);
  assert.equal(oneGone.length, 2);
  assert.deepEqual(clearCart(), []);
});

test('markBought removes the contribution and adds its name to the pantry', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const pantry = ['olive oil'];
  const res = markBought(cart, 'r1', '6 large eggs', pantry);
  // contribution gone
  assert.equal(res.cart.length, cart.length - 1);
  assert.equal(res.cart.find((c) => c.line === '6 large eggs'), undefined);
  // name added to pantry
  assert.ok(res.pantry.includes('eggs'));
  assert.equal(res.removed, true);
  assert.equal(res.name, 'eggs');
});

test('markBought leaves other contributions untouched', () => {
  const cart = [
    ...addToCart([], RECIPES.shakshuka, [], 'all').cart,
    ...addToCart([], RECIPES.alfredo, [], 'all').cart,
  ];
  const res = markBought(cart, 'r1', '6 large eggs', []);
  // the other "eggs" contribution (from Alfredo) remains
  assert.ok(res.cart.find((c) => c.recipeId === 'r2' && c.line === '3 eggs'));
  assert.equal(res.pantry.includes('eggs'), true);
});

test('markBought is idempotent on the pantry when name already present', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const res = markBought(cart, 'r1', '6 large eggs', ['eggs']);
  // still removed from cart; pantry unchanged (no duplicate)
  assert.equal(res.cart.length, cart.length - 1);
  assert.deepEqual(res.pantry, ['eggs']);
});

test('markBought with no match returns inputs unchanged', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const pantry = ['olive oil'];
  const res = markBought(cart, 'r1', 'nope', pantry);
  assert.equal(res.removed, false);
  assert.deepEqual(res.cart, cart);
  assert.deepEqual(res.pantry, pantry);
});

test('markBought does not mutate its inputs', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const pantry = ['olive oil'];
  const cartBefore = [...cart];
  const pantryBefore = [...pantry];
  markBought(cart, 'r1', '6 large eggs', pantry);
  assert.deepEqual(cart, cartBefore);
  assert.deepEqual(pantry, pantryBefore);
});