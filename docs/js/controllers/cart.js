// ════════════════════════════════════════════════════════
// controllers/cart.js — shopping cart: mark-bought + clear + render
// ════════════════════════════════════════════════════════

import { markBought, clearCart } from '../lib/cart.js';
import { save as persist } from '../lib/store.js';
import { toast } from '../lib/dom.js';
import { cartGroupsHTML, emptyCartHTML } from '../components/cart.js';

/**
 * Cart controller. Owns the cart grid, mark-bought + clear handlers. Pure
 * cart logic (grouping, qty summing, item-removal) lives in lib/cart.js.
 *
 * @param {object} deps
 * @param {object} deps.state - { cart, pantry }
 * @param {Document} [deps.document]
 * @param {(name: string) => void} [deps.onPantryChange]
 * @param {() => void} [deps.onChange] - re-render callback (e.g. recipes)
 * @returns {{ render: () => void, markBought: ({recipeId, line}) => void, clear: () => number }}
 */
export function initCart({ state, document = globalThis.document, onPantryChange = null, onChange = null }) {
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
    persist();
    render();
    if (onPantryChange) onPantryChange(res.name);
    if (onChange) onChange();
    toast(`Bought “${res.name}” — added to pantry`);
  }

  function clear() {
    if (!state.cart.length) return 0;
    const before = state.cart.length;
    state.cart = clearCart();
    persist();
    render();
    toast('Cart cleared');
    return before;
  }

  function wireGrid() {
    const grid = document.getElementById('cart-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const bought = e.target.closest('[data-action="bought"]');
        if (bought) {
          const { recipeId, line } = bought.dataset;
          markBoughtFn({ recipeId, line });
        }
      });
    }
    const clearBtn = document.getElementById('cart-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', clear);
  }

  wireGrid();
  return { render, markBought: markBoughtFn, clear };
}
