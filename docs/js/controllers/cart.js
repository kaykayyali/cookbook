// controllers/cart.js — recipe selections, serving controls, and aggregate render.
import {
  setTargetServings,
  removeRecipeSelection,
  removeShoppingItem,
  clearCart,
} from '../lib/cart.js';
import { save as persist } from '../lib/store.js';
import { toast } from '../lib/dom.js';
import { cartGroupsHTML, emptyCartHTML } from '../components/cart.js';

export function initCart({ state, document = globalThis.document, onChange = null }) {
  function render() {
    const grid = document.getElementById('cart-grid');
    if (!grid) return;
    grid.innerHTML = state.cart.length ? cartGroupsHTML(state.cart, state.pantry) : emptyCartHTML();
  }

  function changeServings(recipeId, delta) {
    const selection = state.cart.find((item) => item.recipeId === recipeId);
    if (!selection || !Array.isArray(selection.ingredients)) return false;
    state.cart = setTargetServings(state.cart, recipeId, selection.targetServings + delta);
    persist();
    render();
    if (onChange) onChange();
    return true;
  }

  function removeRecipe(recipeId) {
    const next = removeRecipeSelection(state.cart, recipeId);
    if (next.length === state.cart.length) return false;
    state.cart = next;
    persist();
    render();
    if (onChange) onChange();
    return true;
  }

  function removeItem(name) {
    if (!name || !state.cart.some((selection) => selection.ingredients?.some((item) => item.name === name))) return false;
    state.cart = removeShoppingItem(state.cart, name);
    persist();
    render();
    if (onChange) onChange();
    return true;
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


  const grid = document.getElementById('cart-grid');
  if (grid) grid.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const { recipeId } = action.dataset;
    if (action.dataset.action === 'servings-down') changeServings(recipeId, -1);
    if (action.dataset.action === 'servings-up') changeServings(recipeId, 1);
    if (action.dataset.action === 'remove-recipe') removeRecipe(recipeId);
    if (action.dataset.action === 'remove-item') removeItem(action.dataset.name);
  });
  const clearBtn = document.getElementById('cart-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clear);

  return { render, changeServings, removeRecipe, removeItem, clear };
}
