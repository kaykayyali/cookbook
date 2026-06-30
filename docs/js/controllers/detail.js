// ════════════════════════════════════════════════════════
// controllers/detail.js — recipe detail sheet open/close + render
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { save as persist } from '../lib/store.js';
import { togglePantry } from '../lib/pantry.js';
import { addToCart } from '../lib/cart.js';
import { pluralize } from '../lib/format.js';
import {
  ingredientListHTML,
  pantryNoteHTML,
  metaRowHTML,
  stepsHTML,
  nutritionHTML,
} from '../components/recipeDetail.js';

/**
 * Detail modal controller.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {(id: string) => void} [deps.onEdit] - fires when user clicks "Edit"
 * @param {(id: string) => void} [deps.onSchema] - fires when user clicks "Schema"
 * @param {() => void} [deps.onChange] - fires when pantry changes via ingredient tap (re-render recipes)
 * @returns {{ open: (id) => void, close: () => void, _renderIngredients: () => void }}
 */
export function initDetail({
  state,
  document = globalThis.document,
  onEdit = null,
  onSchema = null,
  onChange = null,
}) {
  function open(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return;
    state.detailId = id;

    const eyebrow = document.getElementById('dm-eyebrow');
    if (eyebrow) eyebrow.textContent = [r.recipeCategory, r.recipeCuisine].filter(Boolean).join(' · ');
    const title = document.getElementById('dm-title');
    if (title) title.textContent = r.name;
    const meta = document.getElementById('dm-meta');
    if (meta) meta.innerHTML = metaRowHTML(r);

    renderIngredients();
    const stepsEl = document.getElementById('dm-steps');
    if (stepsEl) stepsEl.innerHTML = stepsHTML(r.recipeInstructions);

    const nut = nutritionHTML(r.nutrition);
    const nutWrap = document.getElementById('dm-nutrition');
    if (nut) {
      const grid = document.getElementById('dm-nutrition-grid');
      if (grid) grid.innerHTML = nut;
      if (nutWrap) nutWrap.style.display = '';
    } else {
      if (nutWrap) nutWrap.style.display = 'none';
    }

    openSheet();
  }

  function renderIngredients() {
    const r = state.recipes.find((x) => x._id === state.detailId);
    if (!r) return;
    const ings = r.recipeIngredient || [];
    const list = document.getElementById('dm-ingredients');
    if (list) list.innerHTML = ingredientListHTML(ings, state.pantry);
    const note = document.getElementById('dm-pantry-note');
    if (note) {
      const html = pantryNoteHTML(ings, state.pantry);
      note.style.display = html ? '' : 'none';
      if (html) note.innerHTML = html;
    }
  }

  function openSheet() {
    const modal = document.getElementById('detail-modal');
    const overlay = document.getElementById('detail-overlay');
    if (modal) modal.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    const modal = document.getElementById('detail-modal');
    const overlay = document.getElementById('detail-overlay');
    if (modal) modal.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (!isAnyOpen(document)) document.body.style.overflow = '';
    state.detailId = null;
  }

  function addToCartHandler(mode) {
    const r = state.recipes.find((x) => x._id === state.detailId);
    if (!r) return;
    const ings = r.recipeIngredient || [];
    if (!ings.length) { toast('This recipe has no ingredients'); return; }
    const { cart, addedCount } = addToCart(state.cart, r, state.pantry, mode);
    state.cart = cart;
    persist();
    if (mode === 'missing' && addedCount === 0) toast('Nothing missing — you have everything');
    else toast(`Added ${pluralize(addedCount, 'item')} to cart`);
  }

  function wireDetail() {
    const closeBtn = document.getElementById('detail-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    const overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.addEventListener('click', closeSheet);
    const editBtn = document.getElementById('dm-edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => {
      const id = state.detailId;
      closeSheet();
      if (onEdit) onEdit(id);
    });
    const schemaBtn = document.getElementById('dm-schema-btn');
    if (schemaBtn) schemaBtn.addEventListener('click', () => { if (state.detailId && onSchema) onSchema(state.detailId); });
    const missingBtn = document.getElementById('dm-add-missing-btn');
    if (missingBtn) missingBtn.addEventListener('click', () => addToCartHandler('missing'));
    const allBtn = document.getElementById('dm-add-all-btn');
    if (allBtn) allBtn.addEventListener('click', () => addToCartHandler('all'));
    const ings = document.getElementById('dm-ingredients');
    if (ings) {
      ings.addEventListener('click', (e) => {
        const item = e.target.closest('.detail-ing-item');
        if (!item || !item.dataset.ing) return;
        const { pantry, added, name } = togglePantry(state.pantry, item.dataset.ing.toLowerCase());
        state.pantry = pantry;
        persist();
        renderIngredients();
        if (onChange) onChange();
        toast(added ? `Added "${name}" to pantry` : `Removed "${name}" from pantry`);
      });
    }
  }

  wireDetail();
  return { open, close: closeSheet, _renderIngredients: renderIngredients };
}

function isAnyOpen(document) {
  return !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
