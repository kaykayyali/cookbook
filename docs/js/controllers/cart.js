// controllers/cart.js — recipe selections, check-off state, and aggregate render.
import {
  NORMALIZATION_VERSION,
  addRecipeSelection,
  isNormalizedIngredient,
  normalizeIngredientsLocal,
  recipeSetSignature,
  setTargetServings,
  removeRecipeSelection,
  removeShoppingItem,
  clearCart,
} from '../lib/cart.js';
import { normalizeRecipeIngredients } from '../lib/api.js';
import { save as persist } from '../lib/store.js';
import { toast } from '../lib/dom.js';
import { cartGroupsHTML, emptyCartHTML } from '../components/cart.js';

export function initCart({ state, document = globalThis.document, onChange = null, normalizeIngredients = normalizeRecipeIngredients }) {
  let refreshPromise = null;

  function mutationGeneration() { return Number(state.cartMutationGeneration) || 0; }
  function cancellationGeneration() { return Number(state.cartCancellationGeneration) || 0; }
  function markCartMutated() {
    state.cartMutationGeneration = mutationGeneration() + 1;
    state.cartCancellationGeneration = cancellationGeneration() + 1;
  }

  function render({ skipAudit = false } = {}) {
    const grid = document.getElementById('cart-grid');
    if (!grid) return;
    grid.innerHTML = state.cart.length ? cartGroupsHTML(state.cart, state.pantry, state.shoppingChecked) : emptyCartHTML();
    if (!skipAudit && state.recipesLoaded === true) void refreshNormalization();
  }

  function activeRecipeSet() {
    return (state.cart || []).map((selection) => {
      const source = (state.recipes || []).find((recipe) => String(recipe._id || recipe.id) === selection.recipeId);
      return {
        recipeId: selection.recipeId,
        recipeName: source?.name || selection.recipeName,
        recipeYield: source?.recipeYield || selection.sourceServings,
        ingredients: source
          ? (source.recipeIngredient || []).filter((line) => typeof line === 'string' && line.trim())
          : (selection.ingredients || []).map((ingredient) => ingredient.raw).filter(Boolean),
        recipe: source || { recipeId: selection.recipeId, recipeName: selection.recipeName, recipeYield: selection.sourceServings },
      };
    }).filter((entry) => entry.ingredients.length);
  }

  async function doRefreshNormalization() {
    const set = activeRecipeSet();
    if (!set.length) return false;
    state.normalizations ||= {};
    state.normalizationAudit ||= {};
    const signature = recipeSetSignature(set);
    const generation = mutationGeneration();
    const current = state.cart.every((selection) => selection.normalizationVersion === NORMALIZATION_VERSION);
    if (current && state.normalizationAudit.signature === signature) return false;
    const request = set.map(({ recipeId, recipeName, recipeYield, ingredients }) => ({ recipeId, recipeName, recipeYield, ingredients }));
    let normalizedSet;
    try {
      normalizedSet = await normalizeIngredients(request);
      const valid = Array.isArray(normalizedSet) && normalizedSet.length === set.length
        && normalizedSet.every((result, index) => result?.recipeId === set[index].recipeId
          && Array.isArray(result.ingredients) && result.ingredients.length === set[index].ingredients.length
          && result.ingredients.every((item, itemIndex) => isNormalizedIngredient(item)
            && item.raw === set[index].ingredients[itemIndex]
            && typeof item.displayName === 'string' && typeof item.countLabel === 'string' && typeof item.category === 'string'));
      if (!valid) throw new Error('invalid_normalization');
    } catch {
      normalizedSet = set.map((entry) => ({ recipeId: entry.recipeId, ingredients: normalizeIngredientsLocal(entry.ingredients) }));
    }
    if (generation !== mutationGeneration()) return false;
    normalizedSet.forEach((result, index) => {
      const entry = set[index];
      state.normalizations[entry.recipeId] = {
        version: NORMALIZATION_VERSION,
        raw: [...entry.ingredients],
        ingredients: result.ingredients.map((item) => ({ ...item })),
      };
      state.cart = addRecipeSelection(state.cart, entry.recipe, result.ingredients);
    });
    state.normalizationAudit = { signature };
    persist();
    render({ skipAudit: true });
    if (onChange) onChange();
    return true;
  }

  function refreshNormalization() {
    if (!refreshPromise) refreshPromise = doRefreshNormalization().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function changed() {
    persist();
    render();
    if (onChange) onChange();
  }

  function changeServings(recipeId, delta) {
    const selection = state.cart.find((item) => item.recipeId === recipeId);
    if (!selection || !Array.isArray(selection.ingredients)) return false;
    state.cart = setTargetServings(state.cart, recipeId, selection.targetServings + delta);
    changed();
    return true;
  }

  function removeRecipe(recipeId) {
    const next = removeRecipeSelection(state.cart, recipeId);
    if (next.length === state.cart.length) return false;
    state.cart = next;
    markCartMutated();
    state.normalizationAudit = {};
    changed();
    return true;
  }

  function removeItem(name) {
    if (!name || !state.cart.some((selection) => selection.ingredients?.some((item) => item.name === name))) return false;
    state.cart = removeShoppingItem(state.cart, name);
    markCartMutated();
    if (state.shoppingChecked) delete state.shoppingChecked[name];
    changed();
    return true;
  }

  function toggleItem(name) {
    if (!name || !state.cart.some((selection) => selection.ingredients?.some((item) => item.name === name))) return false;
    state.shoppingChecked ||= {};
    if (state.shoppingChecked[name]) delete state.shoppingChecked[name];
    else state.shoppingChecked[name] = true;
    changed();
    return true;
  }

  function clear() {
    const before = state.cart.length;
    markCartMutated();
    if (!before) {
      state.normalizationAudit = {};
      persist();
      render();
      return 0;
    }
    state.cart = clearCart();
    state.shoppingChecked = {};
    state.normalizationAudit = {};
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
    if (action.dataset.action === 'toggle-item') toggleItem(action.dataset.name);
  });
  const clearBtn = document.getElementById('cart-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clear);

  return { render, changeServings, removeRecipe, removeItem, toggleItem, clear, _refreshNormalization: refreshNormalization };
}
