// ════════════════════════════════════════════════════════
// controllers/cart.js — shopping cart: mark-bought + clear + render
// ════════════════════════════════════════════════════════

import { markBought, clearCart } from '../lib/cart.js';
import { cartGroupsHTML, emptyCartHTML } from '../components/cart.js';

/**
 * Cart controller. Owns the cart grid, mark-bought + clear handlers. Pure
 * cart logic (grouping, qty summing, item-removal) lives in lib/cart.js.
 *
 * @param {object} deps
 * @param {object} deps.state - { cart: object[], pantry: string[] }
 * @param {Document} [deps.document]
 * @param {(name: string) => void} [deps.onPantryChange] - fires when an item is bought
 * @returns {{ render: () => void, markBought: ({recipeId, line}) => void, clear: () => number }}
 */
export function initCart({ state, document = globalThis.document, onPantryChange = null }) {
  function render() {
    const grid = document.getElementById('cart-grid');
    if (!grid) return;
    grid.innerHTML = state.cart.length ? cartGroupsHTML(state.cart) : emptyCartHTML();
  }

  function markBoughtFn({ recipeId, line }) {
    const res = markBought(state.cart, recipeId, line, state.pantry);
    if (!res.removed) return;
    state.cart = res.cart;
    state.pantry = res.pantry;
    if (onPantryChange) onPantryChange(res.name);
  }

  function clear() {
    const before = state.cart.length;
    state.cart = clearCart();
    return before;
  }

  return { render, markBought: markBoughtFn, clear };
}
