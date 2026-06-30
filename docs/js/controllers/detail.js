// ════════════════════════════════════════════════════════
// controllers/detail.js — recipe detail sheet open/close + render
// ════════════════════════════════════════════════════════

import {
  ingredientListHTML,
  pantryNoteHTML,
  metaRowHTML,
  stepsHTML,
  nutritionHTML,
} from '../components/recipeDetail.js';

/**
 * Detail modal controller. Opens the recipe detail sheet, renders the
 * recipe's ingredients / steps / nutrition / meta. Pure rendering is in
 * components/recipeDetail.js; this file is DOM + state wiring.
 *
 * @param {object} deps
 * @param {object} deps.state - { recipes, pantry, detailId }
 * @param {Document} [deps.document]
 * @returns {{ open: (id: string) => void, close: () => void }}
 */
export function initDetail({ state, document = globalThis.document }) {
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

  return { open, close: closeSheet, _renderIngredients: renderIngredients };
}

function isAnyOpen(document) {
  return !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
