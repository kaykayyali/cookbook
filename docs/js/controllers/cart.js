// controllers/cart.js — recipe selections, check-off state, and aggregate render.
import {
  NORMALIZATION_VERSION,
  addRecipeSelection,
  aggregateCart,
  isNormalizedIngredient,
  normalizeIngredient,
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
import { regeneratePlanRangeCart } from '../lib/plan-range.js';
import { addToPantry } from '../lib/pantry.js';

const uid = () => globalThis.crypto?.randomUUID?.() || `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function initCart({
  state,
  document = globalThis.document,
  onChange = null,
  mutate = null,
  normalizeIngredients = normalizeRecipeIngredients,
  schedule = globalThis.setTimeout,
  prefersReducedMotion = () => document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
}) {
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
    grid.innerHTML = state.cart.length || state.manualItems?.length
      ? cartGroupsHTML(state.cart, state.pantry, state.shoppingChecked, state.manualItems, state.shoppingFilter)
      : emptyCartHTML();
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
      if (mutate) void mutate('cart.upsertSelection', {
        selection: state.cart.find((item) => item.recipeId === entry.recipeId),
      });
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
    if (mutate) void mutate('cart.setTargetServings', {
      recipeId,
      targetServings: state.cart.find((item) => item.recipeId === recipeId).targetServings,
    });
    changed();
    return true;
  }

  function removeRecipe(recipeId) {
    const next = removeRecipeSelection(state.cart, recipeId);
    if (next.length === state.cart.length) return false;
    state.cart = next;
    if (mutate) void mutate('cart.removeSelection', { recipeId });
    markCartMutated();
    state.normalizationAudit = {};
    changed();
    return true;
  }

  function removeItem(name) {
    if (!name || !state.cart.some((selection) => selection.ingredients?.some((item) => item.name === name))) return false;
    state.cart = removeShoppingItem(state.cart, name);
    if (mutate) void mutate('shopping.removeIngredient', { name });
    markCartMutated();
    if (state.shoppingChecked) delete state.shoppingChecked[name];
    changed();
    return true;
  }

  function setItemCompleted(name, completed) {
    if (!name || !state.cart.some((selection) => selection.ingredients?.some((item) => item.name === name))) return false;
    state.shoppingChecked ||= {};
    if (completed) state.shoppingChecked[name] = true;
    else delete state.shoppingChecked[name];
    if (mutate) void mutate('shopping.setChecked', { key: name, checked: completed });
    if (completed) {
      const purchased = aggregateCart(state.cart).find((item) => item.name === name);
      const transfer = purchased ? {
        name: purchased.name,
        displayName: purchased.displayName,
        quantity: purchased.purchaseQuantity,
        unit: purchased.unit,
        kind: purchased.kind,
        countLabel: purchased.countLabel,
        category: purchased.category,
      } : normalizeIngredient(name);
      const result = addToPantry(state.pantry, transfer);
      if (result.added) {
        state.pantry = result.pantry;
        if (mutate) void mutate('pantry.add', { item: transfer });
      }
    }
    changed();
    return true;
  }

  function toggleItem(name) {
    return setItemCompleted(name, state.shoppingChecked?.[name] !== true);
  }

  function animateToggleItem(action, name) {
    const completed = state.shoppingChecked?.[name] === true;
    const row = typeof action?.closest === 'function' ? action.closest('.cart-row') : null;
    if (!row || prefersReducedMotion()) return setItemCompleted(name, !completed);
    if (row.dataset.cartTransition === 'true') return false;
    row.dataset.cartTransition = 'true';
    row.classList.add(completed ? 'is-restoring' : 'is-completing');
    const check = row.querySelector('.cart-check');
    if (check) {
      check.textContent = completed ? '' : '✓';
      check.setAttribute('aria-pressed', String(!completed));
    }
    schedule(() => setItemCompleted(name, !completed), 280);
    return true;
  }

  function addManual(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const normalized = normalizeIngredient(text);
    const item = {
      id: uid(),
      name: normalized.name,
      displayName: normalized.displayName,
      quantity: normalized.quantity,
      unit: normalized.unit,
      kind: normalized.kind,
      countLabel: normalized.countLabel,
      category: normalized.category,
    };
    state.manualItems ||= [];
    state.manualItems.push(item);
    if (mutate) void mutate('shopping.addManual', item);
    changed();
    return item;
  }

  function removeManual(id) {
    if (!state.manualItems?.some((item) => item.id === id)) return false;
    state.manualItems = state.manualItems.filter((item) => item.id !== id);
    delete state.shoppingChecked?.[`manual:${id}`];
    if (mutate) void mutate('shopping.removeManual', { id });
    changed();
    return true;
  }

  function toggleManual(id) {
    if (!state.manualItems?.some((item) => item.id === id)) return false;
    const key = `manual:${id}`;
    const checked = state.shoppingChecked?.[key] !== true;
    state.shoppingChecked ||= {};
    if (checked) state.shoppingChecked[key] = true;
    else delete state.shoppingChecked[key];
    if (mutate) void mutate('shopping.setChecked', { key, checked });
    if (checked) {
      const item = state.manualItems.find((entry) => entry.id === id);
      const result = addToPantry(state.pantry, item);
      if (result.added) {
        state.pantry = result.pantry;
        if (mutate) void mutate('pantry.add', { item });
      }
    }
    changed();
    return true;
  }

  function generatePlanRange(startDate, endDate) {
    if (!startDate || !endDate || !mutate) return false;
    const optimisticCart = regeneratePlanRangeCart(state, { rangeStart: startDate, rangeEnd: endDate }, state.recipes);
    void mutate('shopping.regeneratePlanRange', { rangeStart: startDate, rangeEnd: endDate, optimisticCart });
    return true;
  }

  function clear() {
    const before = state.cart.length + (state.manualItems?.length || 0);
    markCartMutated();
    if (!before) {
      state.normalizationAudit = {};
      persist();
      render();
      return 0;
    }
    state.cart = clearCart();
    state.manualItems = [];
    state.shoppingChecked = {};
    state.normalizationAudit = {};
    persist();
    render();
    toast('Cart cleared');
    if (mutate) void mutate('shopping.clear', {});
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
    if (action.dataset.action === 'toggle-item') animateToggleItem(action, action.dataset.name);
    if (action.dataset.action === 'remove-manual') removeManual(action.dataset.id);
    if (action.dataset.action === 'toggle-manual') toggleManual(action.dataset.id);
  });
  const clearBtn = document.getElementById('cart-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clear);

  const input = document.getElementById('shopping-manual-input');
  const filter = document.getElementById('shopping-filter');
  filter?.addEventListener('input', () => { state.shoppingFilter = filter.value; render({ skipAudit: true }); });
  const addBtn = document.getElementById('shopping-manual-add');
  const addFromInput = () => {
    if (!input) return;
    if (addManual(input.value)) { input.value = ''; input.focus(); }
  };
  addBtn?.addEventListener('click', addFromInput);
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addFromInput(); }
  });
  const start = document.getElementById('plan-shop-start');
  const end = document.getElementById('plan-shop-end');
  if (start && end) {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    start.value ||= new Date(now.getTime() - offset).toISOString().slice(0, 10);
    end.value ||= new Date(now.getTime() - offset + 6 * 86_400_000).toISOString().slice(0, 10);
  }
  document.getElementById('plan-shop-generate')?.addEventListener('click', () => {
    if (generatePlanRange(start.value, end.value)) toast('Shopping list updated from the plan');
  });

  return { render, changeServings, removeRecipe, removeItem, toggleItem, addManual, removeManual, toggleManual, generatePlanRange, clear, _refreshNormalization: refreshNormalization };
}
