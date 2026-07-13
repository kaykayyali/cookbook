// ════════════════════════════════════════════════════════
// controllers/detail.js — recipe detail sheet open/close + render
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { save as persist } from '../lib/store.js';
import { togglePantry } from '../lib/pantry.js';
import { addRecipeSelection, isNormalizedIngredient, normalizeIngredientsLocal } from '../lib/cart.js';
import { normalizeRecipeIngredients } from '../lib/api.js';
import { esc } from '../lib/format.js';

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
  normalizeIngredients = normalizeRecipeIngredients,
  notify = toast,
}) {
  let current = null;

  function openRecipe(r, ctx = { source: 'local' }) {
    if (!r) return;
    current = { r, ctx };
    state.detailId = ctx.source === 'local' ? r._id : null;

    const eyebrow = document.getElementById('dm-eyebrow');
    if (eyebrow) eyebrow.textContent = [r.recipeCategory, r.recipeCuisine].filter(Boolean).join(' · ');
    const title = document.getElementById('dm-title');
    if (title) title.textContent = r.name;
    const meta = document.getElementById('dm-meta');
    if (meta) meta.innerHTML = metaRowHTML(r);

    // Author badge: shown only for community recipes.
    const badge = document.getElementById('dm-author-badge');
    if (badge) {
      if (ctx.author) {
        const a = ctx.author;
        const avatar = a.picture
          ? `<img class="author-avatar" src="${esc(a.picture)}" alt="" width="22" height="22" referrerpolicy="no-referrer" crossorigin="anonymous">`
          : `<span class="author-avatar author-initial">${esc((a.name || '?').slice(0, 1).toUpperCase())}</span>`;
        badge.innerHTML = `${avatar}<span class="author-name">added by ${esc(a.name || 'someone')}</span>`;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    // Footer button visibility by source/ownership.
    setDisplay('dm-edit-btn', ctx.source === 'local' && ctx.isAuthor !== false ? '' : 'none');
    setDisplay('dm-schema-btn', ctx.source === 'local' ? '' : 'none');


    renderIngredients();
    const stepsEl = document.getElementById('dm-steps');
    if (stepsEl) stepsEl.innerHTML = stepsHTML(r.recipeInstructions);
    const nut = nutritionHTML(r.nutrition);
    const nutWrap = document.getElementById('dm-nutrition');
    if (nut) {
      const grid = document.getElementById('dm-nutrition-grid');
      if (grid) grid.innerHTML = nut;
      if (nutWrap) nutWrap.style.display = '';
    } else if (nutWrap) nutWrap.style.display = 'none';

    openSheet();
  }

  function setDisplay(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  }

  function open(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return;
    const isAuthor = !r._author || !!(state.auth?.sub && r._author.sub === state.auth.sub);
    openRecipe(r, { source: 'local', author: r._author, isAuthor });
  }


  function renderIngredients() {
    const r = current && current.r;
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
    current = null;
  }

  async function addToCartHandler() {
    const r = current && current.r;
    if (!r) return;
    const ings = (r.recipeIngredient || []).filter((line) => typeof line === 'string');
    if (!ings.length) { notify('This recipe has no ingredients'); return; }
    let normalized;
    state.normalizations ||= {};
    const persisted = state.normalizations[r._id];
    const persistedMatches = persisted?.version === 1
      && Array.isArray(persisted.raw)
      && persisted.raw.length === ings.length
      && persisted.raw.every((line, index) => line === ings[index])
      && Array.isArray(persisted.ingredients)
      && persisted.ingredients.length === ings.length
      && persisted.ingredients.every(isNormalizedIngredient);
    const active = (state.cart || []).find((selection) => selection.recipeId === r._id
      && selection.normalizationVersion === 1
      && Array.isArray(selection.ingredients)
      && selection.ingredients.length === ings.length
      && selection.ingredients.every(isNormalizedIngredient)
      && selection.ingredients.every((ingredient, index) => ingredient.raw === ings[index]));
    if (persistedMatches) normalized = persisted.ingredients;
    else if (active) normalized = active.ingredients;
    else {
      try { normalized = await normalizeIngredients(ings, r); }
      catch { normalized = normalizeIngredientsLocal(ings); }
    }
    delete state.normalizations[r._id];
    state.normalizations[r._id] = { version: 1, raw: [...ings], ingredients: normalized.map((item) => ({ ...item })) };
    while (Object.keys(state.normalizations).length > 100) delete state.normalizations[Object.keys(state.normalizations)[0]];
    state.cart = addRecipeSelection(state.cart || [], r, normalized);
    persist();
    notify(`Added “${r.name}” to shopping list`);
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
    const allBtn = document.getElementById('dm-add-all-btn');
    if (allBtn) allBtn.addEventListener('click', () => { void addToCartHandler(); });
    // Pantry note "Add to cart" button (shown only when missing > 0) —
    // replaces the old section-label "Add missing to cart" button.
    const note = document.getElementById('dm-pantry-note');
    if (note) note.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="add-missing"]')) void addToCartHandler();
    });
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
        notify(added ? `Added "${name}" to pantry` : `Removed "${name}" from pantry`);
      });
    }


  }

  wireDetail();
  return { open, close: closeSheet, _renderIngredients: renderIngredients, _addToCart: addToCartHandler };
}

function isAnyOpen(document) {
  return !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
