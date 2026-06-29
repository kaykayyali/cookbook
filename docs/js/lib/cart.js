// ════════════════════════════════════════════════════════
// cart.js — shopping cart logic (no DOM)
//
// Cart item: { name, line, qtyText, recipeId, recipeName }
//   name      = baseName(raw) — lowercase noun, the GROUP KEY
//   line      = original raw ingredient text
//   qtyText   = captured leading qty+unit snippet, or "" when unquantified
//   recipeId  = _id of the contributing recipe
//   recipeName = recipe.name, denormalised for display
//
// The cart is decoupled from the pantry: pantry changes never prune it.
// The only cart→pantry link is markBought (Task 3).
// ════════════════════════════════════════════════════════

import { parseIngredient, haveIngredient, addToPantry } from './pantry.js';

/**
 * Build a cart item from a raw ingredient line and its recipe.
 * @param {string} raw ingredient line
 * @param {object} recipe internal recipe with _id and name
 * @returns {{name:string,line:string,qtyText:string,recipeId:string,recipeName:string}}
 */
export function makeCartItem(raw, recipe) {
  const { qtyText, name } = parseIngredient(raw);
  return { name, line: raw, qtyText, recipeId: recipe._id, recipeName: recipe.name };
}

/**
 * Add a recipe's ingredients to the cart. Idempotent per recipe: existing
 * contributions for this recipe are removed first, then the selected lines are
 * appended. 'missing' adds only lines not satisfied by the pantry; 'all' adds
 * every line. Pure — does not mutate inputs.
 * @param {object[]} cart
 * @param {object} recipe
 * @param {string[]} pantry
 * @param {'missing'|'all'} mode
 * @returns {{cart:object[], addedCount:number}}
 */
export function addToCart(cart, recipe, pantry, mode) {
  const withoutRecipe = cart.filter((c) => c.recipeId !== recipe._id);
  const lines = (recipe.recipeIngredient || []).filter((l) => typeof l === 'string');
  const selected = lines.filter((l) => mode === 'all' || !haveIngredient(l, pantry));
  const items = selected.map((l) => makeCartItem(l, recipe));
  return { cart: [...withoutRecipe, ...items], addedCount: items.length };
}

/**
 * Remove one contribution matched by (recipeId, line). Cart-only — pantry is
 * not touched. Pure.
 * @param {object[]} cart
 * @param {string} recipeId
 * @param {string} line
 * @returns {object[]}
 */
export function removeFromCart(cart, recipeId, line) {
  return cart.filter((c) => !(c.recipeId === recipeId && c.line === line));
}

/**
 * Remove all of a recipe's contributions. Pure.
 * @param {object[]} cart
 * @param {string} recipeId
 * @returns {object[]}
 */
export function clearRecipeFromCart(cart, recipeId) {
  return cart.filter((c) => c.recipeId !== recipeId);
}

/** Empty cart. */
export function clearCart() {
  return [];
}

/**
 * Mark one contribution bought: remove it from the cart and add its base name
 * to the pantry, in one step. Only that contribution is removed — others stay.
 * The cart is otherwise decoupled from the pantry; this is the only link.
 * Pure — does not mutate inputs.
 * @param {object[]} cart
 * @param {string} recipeId
 * @param {string} line
 * @param {string[]} pantry
 * @returns {{cart:object[], pantry:string[], name:string, removed:boolean}}
 */
export function markBought(cart, recipeId, line, pantry) {
  const item = cart.find((c) => c.recipeId === recipeId && c.line === line);
  if (!item) return { cart, pantry, name: '', removed: false };
  const nextCart = cart.filter((c) => c !== item);
  const { pantry: nextPantry } = addToPantry(pantry, item.name);
  return { cart: nextCart, pantry: nextPantry, name: item.name, removed: true };
}