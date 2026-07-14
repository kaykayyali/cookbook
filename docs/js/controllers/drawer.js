// ════════════════════════════════════════════════════════
// controllers/drawer.js — recipe create/edit drawer
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { createRecipe, updateRecipe } from '../lib/api.js';
import { mapCommunityItem } from '../lib/community.js';
import {
  FIELD_MAP,
  NUTRI_MAP,
  formBuffers,
  rebuildIngEditor,
  rebuildStepsList,
  collectForm,
  validateRecipe,
} from '../components/recipeForm.js';

/**
 * Drawer (create/edit) controller. Owns the recipe-drawer DOM, form state,
 * and save/close flow. Pure form logic + ingredient/step buffers live in
 * components/recipeForm.js.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {() => void} [deps.onSaved]
 * @param {(id: string) => void} [deps.onOpenDetail]
 * @param {() => void} [deps.onSchema] - fires when user clicks "View schema" in the drawer
 * @returns {{ open, openPrefilled, close, save }}
 */
export function initDrawer({
  state,
  document = globalThis.document,
  onSaved = null,
  onOpenDetail = null,
  onSchema = null,
  create = createRecipe,
  update = updateRecipe,
  mutateRecipe = null,
}) {
  let customSave = null;
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
    const saveBtn = document.getElementById('save-recipe-btn');
    if (saveBtn) saveBtn.disabled = state.offlineCache === true && !mutateRecipe;
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
    customSave = null;
    const r = id ? state.recipes.find((x) => x._id === id) : null;
    fillFromRecipe(r);
    openSheet();
  }

  function openPrefilled(recipe, { onSave = null, uncertainFields = [] } = {}) {
    customSave = onSave;
    if (recipe) delete recipe._id;
    fillFromRecipe(recipe);
    const uncertainTargets = { name: 'f-name', recipeIngredient: 'ing-editor', recipeInstructions: 'steps-list' };
    Object.values(uncertainTargets).forEach((id) => document.getElementById(id)?.classList.remove('field-uncertain'));
    uncertainFields.forEach((field) => document.getElementById(uncertainTargets[field])?.classList.add('field-uncertain'));
    openSheet();
  }


  async function save() {
    if (state.offlineCache && !mutateRecipe) {
      const error = 'Recipe changes are unavailable while offline';
      toast(error);
      return { ok: false, error };
    }
    const r = collectForm(state);
    const err = validateRecipe(r);
    if (err) {
      toast(err);
      if (err.includes('name')) document.getElementById('f-name')?.focus();
      return { ok: false, error: err };
    }

    if (customSave) {
      const result = await customSave(r);
      if (!result?.ok) { toast(result?.error || 'Could not publish reviewed draft'); return { ok: false, error: result?.error }; }
      customSave = null;
      closeSheet();
      if (onSaved) onSaved();
      toast('Reviewed recipe published');
      return { ok: true, recipe: r, isNew: true, ...result };
    }

    const idx = state.editingId ? state.recipes.findIndex((x) => x._id === state.editingId) : -1;
    const isNew = idx === -1;
    if (mutateRecipe) {
      const id = isNew
        ? (globalThis.crypto?.randomUUID?.() || `recipe-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        : state.recipes[idx]._id;
      const item = { ...(isNew ? {} : state.recipes[idx]), ...r, id, _id: id };
      const ok = await mutateRecipe(isNew ? 'recipe.create' : 'recipe.update', { id, recipe: r, item });
      if (!ok) { toast('Could not queue recipe change'); return { ok: false, error: 'recipe_queue_failed' }; }
      Object.assign(r, state.recipes.find((entry) => entry._id === id) || item);
    } else if (isNew) {
      const res = await create(r);
      if (!res.ok) { toast(res.error || 'Could not save recipe'); return { ok: false, error: res.error }; }
      const saved = mapCommunityItem(res.item);
      state.recipes.unshift(saved);
      Object.assign(r, saved);
    } else {
      const existing = state.recipes[idx];
      const serverId = existing._id;
      const res = await update(serverId, r);
      if (!res.ok) { toast(res.error || 'Could not save recipe'); return { ok: false, error: res.error }; }
      const saved = mapCommunityItem(res.item);
      state.recipes[idx] = saved;
      Object.assign(r, saved);
    }

    closeSheet();
    if (onSaved) onSaved();
    toast(isNew ? 'Recipe saved' : 'Recipe updated');
    if (isNew && state.pendingOpenAfterSave) {
      state.pendingOpenAfterSave = false;
      if (onOpenDetail) onOpenDetail(r._id);
    }
    return { ok: true, recipe: r, isNew };
  }

  function wireDrawer() {
    const closeBtn = document.getElementById('drawer-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    const cancelBtn = document.getElementById('drawer-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeSheet);
    const overlay = document.getElementById('drawer-overlay');
    if (overlay) overlay.addEventListener('click', closeSheet);
    const saveBtn = document.getElementById('save-recipe-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => save());
    const schemaBtn = document.getElementById('view-schema-btn');
    if (schemaBtn) schemaBtn.addEventListener('click', () => onSchema && onSchema(null));

    const ingEditor = document.getElementById('ing-editor');
    if (ingEditor) {
      ingEditor.addEventListener('input', (e) => {
        if (e.target.matches('input')) formBuffers.ingredients[+e.target.dataset.index] = e.target.value;
      });
      ingEditor.addEventListener('click', (e) => {
        const btn = e.target.closest('.row-remove');
        if (!btn) return;
        formBuffers.ingredients.splice(+btn.dataset.index, 1);
        rebuildIngEditor();
      });
    }
    const ingAdd = document.getElementById('ing-add-btn');
    if (ingAdd) {
      ingAdd.addEventListener('click', () => {
        const inp = document.getElementById('ing-new-input');
        if (!inp.value.trim()) return;
        formBuffers.ingredients.push(inp.value.trim());
        inp.value = '';
        rebuildIngEditor();
        inp.focus();
      });
    }
    const ingNew = document.getElementById('ing-new-input');
    if (ingNew) {
      ingNew.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('ing-add-btn')?.click(); }
      });
    }
    const stepsList = document.getElementById('steps-list');
    if (stepsList) {
      stepsList.addEventListener('input', (e) => {
        if (e.target.matches('textarea')) formBuffers.steps[+e.target.dataset.index] = e.target.value;
      });
      stepsList.addEventListener('click', (e) => {
        const btn = e.target.closest('.row-remove');
        if (!btn) return;
        formBuffers.steps.splice(+btn.dataset.index, 1);
        rebuildStepsList();
      });
    }
    const stepAdd = document.getElementById('step-add-btn');
    if (stepAdd) {
      stepAdd.addEventListener('click', () => {
        formBuffers.steps.push('');
        rebuildStepsList();
        const tas = document.getElementById('steps-list').querySelectorAll('textarea');
        tas[tas.length - 1]?.focus();
      });
    }
  }

  wireDrawer();
  return { open, openPrefilled, close: closeSheet, save };
}

function isAnyOpen(document) {
  return !!document.getElementById('detail-modal')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
