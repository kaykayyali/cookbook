// ════════════════════════════════════════════════════════
// controllers/recipes.js — recipe grid + card actions
// ════════════════════════════════════════════════════════

import { esc, pluralize } from '../lib/format.js';
import { filterRecipes } from '../lib/filters.js';
import { allRecipeIngredients } from '../lib/pantry.js';
import { recipeCardHTML, emptyStateHTML } from '../components/recipeCard.js';

/**
 * Recipe grid controller. Renders the filtered, sorted list of recipes as
 * cards, owns the recipe-count label, populates the pantry autocomplete
 * datalist, and dispatches detail-modal open requests.
 *
 * @param {object} deps
 * @param {object} deps.state - shared app state (must have recipes, pantry, searchTerm, categoryFilter, eligibleOnly)
 * @param {Document} [deps.document]
 * @param {(id: string) => void} [deps.onOpenDetail] - called when a card is opened
 * @returns {{ render: () => void, openDetail: (id: string) => void }}
 */
export function initRecipes({ state, document = globalThis.document, onOpenDetail = null }) {
  function populatePantryAutocomplete() {
    const dl = document.getElementById('pantry-suggestions');
    if (!dl) return;
    const current = new Set(state.pantry);
    dl.innerHTML = allRecipeIngredients(state.recipes)
      .filter((name) => !current.has(name))
      .map((name) => `<option value="${esc(name)}">`)
      .join('');
  }

  function render() {
    populatePantryAutocomplete();
    const list = filterRecipes(state.recipes, {
      searchTerm: state.searchTerm,
      categoryFilter: state.categoryFilter,
      eligibleOnly: state.eligibleOnly,
      pantry: state.pantry,
    });
    const total = state.recipes.length;
    const countEl = document.getElementById('recipe-count');
    if (countEl) {
      countEl.textContent =
        list.length === total
          ? pluralize(total, 'recipe')
          : `${list.length} of ${pluralize(total, 'recipe')}`;
    }
    const grid = document.getElementById('recipe-grid');
    if (grid) {
      grid.innerHTML = list.length
        ? list.map((r) => recipeCardHTML(r, state.pantry)).join('')
        : emptyStateHTML(total > 0);
    }
  }

  function openDetail(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return;
    if (onOpenDetail) onOpenDetail(id);
  }

  return { render, openDetail };
}
