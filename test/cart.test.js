import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIngredient,
  addRecipeSelection,
  setTargetServings,
  removeRecipeSelection,
  clearCart,
  aggregateCart,
} from '../docs/js/lib/cart.js';

const RECIPE = { _id: 'r1', name: 'Soup', recipeYield: '4 servings', recipeIngredient: ['2 cups stock'] };

test('cart stores normalized recipe selections rather than pantry-filtered lines', () => {
  const ingredient = normalizeIngredient('2 cups stock');
  const cart = addRecipeSelection([], RECIPE, [ingredient]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].ingredients[0].quantity, 16);
  assert.equal(cart[0].sourceServings, 4);
});

test('cart selection serving and removal operations are immutable', () => {
  const original = addRecipeSelection([], RECIPE, [normalizeIngredient('2 cups stock')]);
  const scaled = setTargetServings(original, 'r1', 2);
  assert.equal(original[0].targetServings, 4);
  assert.equal(scaled[0].targetServings, 2);
  assert.deepEqual(removeRecipeSelection(scaled, 'r1'), []);
  assert.deepEqual(clearCart(), []);
});

test('aggregateCart applies the safety buffer without consulting pantry state', () => {
  const cart = addRecipeSelection([], RECIPE, [normalizeIngredient('2 cups stock')]);
  const [stock] = aggregateCart(cart);
  assert.equal(stock.quantity, 16);
  assert.equal(stock.purchaseQuantity, 17.6);
});
