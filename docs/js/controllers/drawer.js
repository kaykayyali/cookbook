// ════════════════════════════════════════════════════════
// controllers/drawer.js — recipe create/edit drawer
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { save as persist } from '../lib/store.js';
import {
  FIELD_MAP,
  NUTRI_MAP,
  formBuffers,
  rebuildIngEditor,
  rebuildStepsList,
  collectForm,
  validateRecipe,
} from '../components/recipeForm.js';
import { pluralize } from '../lib/format.js';

/**
 * Drawer (create/edit) controller. Owns the recipe-drawer DOM, form state,
 * and save/close flow. Pure form logic + ingredient/step buffers live in
 * components/recipeForm.js.
 *
 * @param {object} deps
 * @param {object} deps.state - { recipes, editingId, pendingOpenAfterSave, detailId? }
 * @param {Document} [deps.document]
 * @param {() => void} [deps.onSaved] - fires after a successful save (so recipes panel can re-render)
 * @param {(id: string) => void} [deps.onOpenDetail] - fires when saveRecipe opens the detail modal (extract flow)
 * @returns {{ open: (id: string|null) => void, openPrefilled: (recipe: object) => void, close: () => void, save: () => object }}
 */
export function initDrawer({ state, document = globalThis.document, onSaved = null, onOpenDetail = null }) {
  function openSheet() {
    const drawer = document.getElementById('recipe-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer) drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('f-name')?.focus(), 80);
  }

  function closeSheet() {
    const drawer = document.getElementById('recipe-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (!isAnyOpen(document)) document.body.style.overflow = '';
  }

  function fillFromRecipe(r) {
    state.editingId = (r && r._id) || null;
    const title = document.getElementById('drawer-title');
    if (title) title.textContent = state.editingId ? 'Edit Recipe' : 'New Recipe';
    const idEl = document.getElementById('f-id');
    if (idEl) idEl.value = state.editingId || '';
    for (const [elId, key] of Object.entries(FIELD_MAP)) {
      const el = document.getElementById(elId);
      if (el) el.value = r ? r[key] || '' : '';
    }
    const n = (r && r.nutrition) || {};
    for (const [elId, key] of Object.entries(NUTRI_MAP)) {
      const el = document.getElementById(elId);
      if (el) el.value = n[key] || '';
    }
    formBuffers.ingredients = r ? [...(r.recipeIngredient || [])] : [];
    formBuffers.steps = r ? [...(r.recipeInstructions || [''])] : [''];
    rebuildIngEditor();
    rebuildStepsList();
  }

  function open(id) {
    const r = id ? state.recipes.find((x) => x._id === id) : null;
    fillFromRecipe(r);
    openSheet();
  }

  function openPrefilled(recipe) {
    if (recipe) delete recipe._id;
    fillFromRecipe(recipe);
    openSheet();
  }

  function save() {
    const r = collectForm(state);
    const err = validateRecipe(r);
    if (err) {
      toast(err);
      if (err.includes('name')) document.getElementById('f-name')?.focus();
      return { ok: false, error: err };
    }
    const idx = state.editingId ? state.recipes.findIndex((x) => x._id === state.editingId) : -1;
    const isNew = idx === -1;
    if (isNew) state.recipes.unshift(r);
    else state.recipes[idx] = r;
    persist();
    closeSheet();
    if (onSaved) onSaved();
    toast(isNew ? 'Recipe saved' : 'Recipe updated');
    if (isNew && state.pendingOpenAfterSave) {
      state.pendingOpenAfterSave = false;
      if (onOpenDetail) onOpenDetail(r._id);
    }
    return { ok: true, recipe: r, isNew };
  }

  return { open, openPrefilled, close: closeSheet, save };
}

function isAnyOpen(document) {
  return !!document.getElementById('detail-modal')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
