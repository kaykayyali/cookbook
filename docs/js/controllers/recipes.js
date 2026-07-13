// ════════════════════════════════════════════════════════
// controllers/recipes.js — recipe grid + card actions
// ════════════════════════════════════════════════════════

import { esc, pluralize } from '../lib/format.js';
import { filterRecipes } from '../lib/filters.js';
import { allRecipeIngredients } from '../lib/pantry.js';

import { toast } from '../lib/dom.js';
import { deleteRecipeById } from '../lib/api.js';
import { recipeCardHTML, emptyStateHTML } from '../components/recipeCard.js';

/**
 * Recipe grid controller. Renders the filtered, sorted list of recipes as
 * cards, owns the recipe-count label, populates the pantry autocomplete
 * datalist, and wires card click → detail/edit/schema/delete.
 *
 * @param {object} deps
 * @param {object} deps.state - shared app state
 * @param {Document} [deps.document]
 * @param {(id: string) => void} [deps.onOpenDetail]
 * @param {(id: string) => void} [deps.onEdit]
 * @param {(id: string) => void} [deps.onSchema]
 * @param {(id: string) => void} [deps.onDelete]
 * @returns {{ render: () => void, openDetail: (id: string) => void }}
 */
export function initRecipes({
  state,
  document = globalThis.document,
  onOpenDetail = null,
  onEdit = null,
  onSchema = null,
  onDelete = null,
}) {
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
        ? list.map((r) => recipeCardHTML(r, state.pantry, { currentUserSub: state.auth?.sub })).join('')
        : emptyStateHTML(total > 0);
    }
  }

  function openDetail(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return;
    if (onOpenDetail) onOpenDetail(id);
  }

  function wireGrid() {
    const grid = document.getElementById('recipe-grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (action) {
        e.stopPropagation();
        const { action: a, id } = action.dataset;
        if (a === 'edit' && onEdit) onEdit(id);
        else if (a === 'schema' && onSchema) onSchema(id);
        else if (a === 'delete') deleteById(id);
        return;
      }
      const card = e.target.closest('.recipe-card');
      if (card && onOpenDetail) onOpenDetail(card.dataset.id);
    });
  }

  async function deleteById(id) {
    if (!confirm('Delete this recipe?')) return;
    const res = await deleteRecipeById(id);
    if (!res.ok) { toast(res.error || 'Could not delete recipe'); return; }
    state.recipes = state.recipes.filter((r) => r._id !== id);

    render();
    toast('Recipe deleted');
  }

  wireGrid();
  return { render, openDetail, _delete: deleteById };
}
