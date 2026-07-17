// ════════════════════════════════════════════════════════
// controllers/pantry.js — pantry list + accessible item editor
// ════════════════════════════════════════════════════════

import { esc } from '../lib/format.js';
import {
  addToPantry,
  convertPantryEditorAmount,
  removeFromPantry,
  normalizePantry,
  normalizePantryEntry,
  formatPantryAmount,
  pantryEditorState,
  pantryRecordFingerprint,
  pantryRecordFromEditor,
  pantryUnitsForFamily,
  restorePantryRecord,
  updatePantryRecord,
} from '../lib/pantry.js';
import { save as persist } from '../lib/store.js';
import { toast } from '../lib/dom.js';
import { interactionFeedback as defaultFeedback } from '../lib/interaction-feedback.js';
import { discoverPantryRecipes } from '../lib/pantry-recipe-discovery.js';

const PANTRY_CATEGORIES = [
  ['produce', 'Produce'],
  ['fridge', 'Fridge'],
  ['proteins', 'Proteins'],
  ['staples', 'Staples'],
  ['other', 'Other'],
];
const CATEGORY_IDS = new Set(PANTRY_CATEGORIES.map(([id]) => id));
const EDITOR_FAMILIES = new Set(['count', 'solid', 'fluid', 'unknown']);

const PRODUCE = /\b(apples?|apricots?|avocados?|bananas?|basil|bell peppers?|berries|berry|broccoli|cabbage|carrots?|cauliflower|celery|cilantro|coriander|cucumbers?|eggplants?|fruits?|garlic|ginger|grapes?|herbs?|kale|lemons?|limes?|mango|mangos|mangoes|mint|mushrooms?|onions?|oranges?|parsley|peaches?|pears?|potatoes?|scallions?|spinach|squash|tomatoes?|vegetables?|zucchini)\b/;
const FRIDGE = /\b(butter|cheese|cream|egg|eggs|half and half|milk|tofu|yogurt|yoghurt)\b/;
const PROTEINS = /\b(bacon|beef|chicken|fish|ham|lamb|meat|pancetta|pork|salmon|sausage|shrimp|steak|tuna|turkey)\b/;
const STAPLES = /\b(beans?|black pepper|bread|broth|cereal|chickpeas?|cornstarch|flour|grains?|lentils?|noodles?|oats?|oil|paprika|pasta|peppercorns?|rice|salt|spices?|stock|sugar|vinegar|white pepper)\b/;

/** Display-only grouping over normalized Pantry entries. */
export function pantryCategory(item) {
  const name = String(item?.name || item || '').toLowerCase();
  if (STAPLES.test(name)) return 'staples';
  if (PRODUCE.test(name)) return 'produce';
  if (FRIDGE.test(name)) return 'fridge';
  if (PROTEINS.test(name)) return 'proteins';
  if (item && typeof item === 'object') {
    if (item.category === 'produce') return 'produce';
    if (['dairy-eggs', 'frozen'].includes(item.category)) return 'fridge';
    if (item.category === 'meat-seafood') return 'proteins';
    if (['pantry', 'bakery'].includes(item.category)) return 'staples';
  }
  return 'other';
}

/**
 * Pantry controller. The workspace runtime remains the only shared-state source;
 * this controller publishes optimistic edits through its existing mutation path.
 */
export function initPantry({
  state,
  document = globalThis.document,
  onChange = null,
  mutate = null,
  onOpenRecipe = null,
  feedback = defaultFeedback,
}) {
  state.pantry = normalizePantry(state.pantry);
  let query = '';
  let category = 'all';
  let editorId = null;
  let editorOriginal = null;
  let editorBaseFingerprint = '';
  let editorReturnFocus = null;
  let editorReturnId = null;
  let lastEditorUnit = '';
  let editorPending = false;
  let recipeExpanded = false;
  let editorSuspended = false;
  let suspendedRecipeId = '';
  let editorBodyOverflow = '';

  const byId = (id) => state.pantry.find((entry) => entry.id === id);
  const editorChanged = (record) => Boolean(editorId && record
    && JSON.stringify(record) !== editorBaseFingerprint);
  const get = (id) => document.getElementById(id);
  const modalOpen = () => {
    const modal = get('pantry-item-modal');
    return Boolean(modal && !modal.hidden);
  };
  const setText = (id, value) => { const node = get(id); if (node) node.textContent = value || ''; };
  const setError = (message) => {
    setText('pantry-item-error', message);
    const error = get('pantry-item-error');
    if (error) error.hidden = !message;
  };
  const setStatus = (message) => setText('pantry-item-status', message);

  function renderRecipeDiscovery({ focusToggle = false } = {}) {
    const section = get('pantry-recipe-discovery');
    const resultsNode = get('pantry-recipe-results');
    const toggle = get('pantry-recipe-toggle');
    if (!section || !resultsNode || !toggle) return;
    const record = editorId ? byId(editorId) : null;
    if (!record) {
      section.hidden = true;
      resultsNode.innerHTML = '';
      toggle.hidden = true;
      return;
    }
    const body = section.closest?.('.pantry-item-body');
    const scrollTop = body?.scrollTop || 0;
    const focusedRecipeId = document.activeElement?.dataset?.pantryRecipeId || '';
    const ingredientLabel = record.displayName || record.name;
    setText('pantry-recipe-title', `Recipes using ${ingredientLabel}`);
    const discovered = discoverPantryRecipes({
      recipes: state.recipes,
      pantry: state.pantry,
      ingredientName: record.name,
    });
    const visible = recipeExpanded ? discovered : discovered.slice(0, 3);
    if (!visible.length) {
      resultsNode.innerHTML = '<div class="pantry-recipe-empty" role="status"><strong>No recipes use this item yet.</strong><p>Correct recipe ingredients or try another Pantry item. Saving this item still works normally.</p></div>';
    } else {
      resultsNode.innerHTML = visible.map((result) => {
        const availability = `${result.availability.label} · ${result.availability.have} of ${result.availability.total} Pantry names`;
        const image = result.imageUrl
          ? `<img src="${esc(result.imageUrl)}" alt="" width="48" height="48" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
          : '<span class="pantry-recipe-image-fallback" aria-hidden="true">🍲</span>';
        return `<button type="button" class="pantry-recipe-row" data-pantry-recipe-id="${esc(result.recipeId)}" data-feedback="select"${result.canOpen ? '' : ' disabled'} aria-label="Open ${esc(result.recipeName)} recipe. ${esc(availability)}. Matching ingredient: ${esc(result.matchingLine)}">
          ${image}
          <span class="pantry-recipe-copy"><strong>${esc(result.recipeName)}</strong><span class="pantry-recipe-match">${esc(result.matchingLine)}</span></span>
          <span class="pantry-recipe-availability is-${result.availability.label.toLowerCase()}">${esc(availability)}</span>
        </button>`;
      }).join('');
    }
    section.hidden = false;
    toggle.hidden = discovered.length <= 3;
    toggle.textContent = recipeExpanded ? 'View fewer recipes' : 'View all recipes';
    toggle.setAttribute?.('aria-expanded', String(recipeExpanded));
    toggle.dataset.feedback = recipeExpanded ? 'toggle-off' : 'toggle-on';
    if (body) body.scrollTop = scrollTop;
    if (focusToggle) toggle.focus?.();
    else if (focusedRecipeId) {
      const escaped = globalThis.CSS?.escape?.(focusedRecipeId) || focusedRecipeId;
      section.querySelector?.(`[data-pantry-recipe-id="${escaped}"]`)?.focus?.();
    }
  }

  function render() {
    const grid = get('pantry-grid');
    if (!grid) return;
    const focusedPantryId = document.activeElement?.dataset?.pantryId || '';
    const total = state.pantry.length;
    const normalizedQuery = query.trim().toLowerCase();
    const visible = [...state.pantry]
      .filter((item) => !normalizedQuery
        || item.name.includes(normalizedQuery)
        || item.displayName.toLowerCase().includes(normalizedQuery))
      .filter((item) => category === 'all' || pantryCategory(item) === category)
      .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));

    renderFilters();
    const summary = get('pantry-summary');
    if (summary) summary.textContent = visible.length === total
      ? `${total} ${total === 1 ? 'item' : 'items'}`
      : `${visible.length} of ${total} items`;

    if (!state.pantry.length) {
      grid.innerHTML = '<div class="pantry-empty"><span aria-hidden="true">🫙</span><strong>Your pantry is ready.</strong><p>Add a few things you usually cook with.</p></div>';
    } else if (!visible.length) {
      grid.innerHTML = '<div class="pantry-empty"><span aria-hidden="true">✨</span><strong>Nothing here yet.</strong><p>Try another search or category.</p><button class="btn btn-ghost btn-sm" data-action="clear-pantry-filters" data-feedback="select">Show everything</button></div>';
    } else {
      grid.innerHTML = PANTRY_CATEGORIES.map(([id, label]) => {
        const items = visible.filter((item) => pantryCategory(item) === id);
        if (!items.length) return '';
        return `<section class="pantry-group" data-category="${id}">
          <div class="pantry-group-heading"><span class="pantry-category-dot" aria-hidden="true"></span><h3>${label}</h3><span>${items.length}</span></div>
          <div class="pantry-items">${items.map((item) => pantryTagHTML(item, id)).join('')}</div>
        </section>`;
      }).join('');
    }

    if (focusedPantryId && !modalOpen()) {
      document.querySelector?.(`[data-pantry-id="${globalThis.CSS?.escape?.(focusedPantryId) || focusedPantryId}"]`)?.focus?.();
    }
    if (editorId && modalOpen()) {
      const current = byId(editorId);
      if (!current) setError('This item was removed by another household member. Your edits are still here.');
      else if (!editorPending && editorChanged(current)) {
        setError('This item changed in the shared Pantry. Close and reopen it to review the latest version.');
      }
      renderRecipeDiscovery();
    }
  }

  function renderFilters() {
    const zone = get('pantry-filters');
    if (!zone) return;
    const options = [['all', 'All'], ...PANTRY_CATEGORIES];
    zone.innerHTML = options.map(([id, label]) => {
      const count = id === 'all'
        ? state.pantry.length
        : state.pantry.filter((item) => pantryCategory(item) === id).length;
      const active = category === id;
      return `<button type="button" class="pantry-filter${active ? ' is-active' : ''}" data-category="${id}" data-feedback="select" aria-pressed="${active}">${label}<span>${count}</span></button>`;
    }).join('');
  }

  function setQuery(value) {
    query = String(value || '');
    render();
  }

  function setCategory(value) {
    category = value === 'all' || CATEGORY_IDS.has(value) ? value : 'all';
    render();
  }

  function clearFilters() {
    query = '';
    category = 'all';
    const search = get('pantry-search');
    if (search) search.value = '';
    render();
  }

  function publish() {
    persist();
    render();
    if (onChange) onChange();
  }

  function add(raw) {
    const updatedAt = Date.now();
    const delta = normalizePantryEntry(raw, { updatedAt });
    const { pantry, added, name, item } = addToPantry(state.pantry, delta);
    if (!name || !added) return null;
    state.pantry = pantry;
    if (mutate) void mutate('pantry.add', { item: delta });
    publish();
    toast(`Added "${name}"`);
    return item;
  }

  function update(recordId, value) {
    const updatedAt = Date.now();
    state.pantry = updatePantryRecord(state.pantry, recordId, value, { updatedAt });
    const item = byId(recordId);
    if (mutate) void mutate('pantry.update', { id: recordId, item });
    publish();
    return item;
  }

  function remove(item) {
    state.pantry = removeFromPantry(state.pantry, item);
    const id = typeof item === 'object' ? item?.id : undefined;
    const name = typeof item === 'string' ? item : item?.name;
    const unit = typeof item === 'object' ? item?.unit : undefined;
    const countLabel = typeof item === 'object' ? item?.countLabel : undefined;
    if (mutate) void mutate('pantry.remove', {
      ...(id ? { id, expectedFingerprint: pantryRecordFingerprint(item) } : {}),
      ...(!id ? {
        name,
        ...(unit ? { unit } : {}),
        ...(unit === 'count' ? { countLabel: countLabel || '' } : {}),
      } : {}),
    });
    publish();
    toast(`Removed "${name}"`);
  }

  function renderEditorUnits(family, selected = '') {
    const select = get('pantry-item-unit');
    const quantity = get('pantry-item-quantity');
    const unitGroup = get('pantry-item-unit-group');
    const quantityGroup = get('pantry-item-quantity-group');
    const unknown = family === 'unknown';
    if (quantity) {
      quantity.disabled = unknown;
      quantity.required = !unknown;
      if (unknown) quantity.value = '';
    }
    if (quantityGroup) quantityGroup.hidden = unknown;
    if (unitGroup) unitGroup.hidden = unknown;
    if (!select) return;
    const units = pantryUnitsForFamily(family);
    select.innerHTML = units.map(({ value, label }) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    const fallback = units[0]?.value || '';
    select.value = units.some(({ value }) => value === selected) ? selected : fallback;
    select.disabled = unknown;
    select.required = !unknown;
    lastEditorUnit = select.value;
  }

  function fillEditor(values, record = null) {
    const name = get('pantry-item-name');
    const quantity = get('pantry-item-quantity');
    const family = get('pantry-item-family');
    const raw = get('pantry-item-raw');
    const evidenceList = get('pantry-item-raw-evidence');
    if (name) name.value = values.name || '';
    if (quantity) quantity.value = values.quantity === '' ? '' : String(values.quantity);
    if (family) family.value = EDITOR_FAMILIES.has(values.family) ? values.family : 'unknown';
    renderEditorUnits(family?.value || 'unknown', values.unit);
    if (raw) raw.textContent = values.raw || 'No original text — this item is new.';
    if (evidenceList) {
      const earlier = [...new Set(Array.isArray(record?.rawEvidence) ? record.rawEvidence : [])]
        .filter((value) => value && value !== values.raw);
      evidenceList.replaceChildren(...earlier.map((value) => {
        const item = document.createElement('li');
        item.textContent = value;
        return item;
      }));
      evidenceList.hidden = earlier.length === 0;
    }
  }

  function openEditor(recordId = null, raw = '', { sourceEvent = null, target = null } = {}) {
    const modal = get('pantry-item-modal');
    const overlay = get('pantry-item-overlay');
    if (!modal) return false;
    const record = recordId ? byId(recordId) : normalizePantryEntry(raw, { updatedAt: Date.now() });
    if (recordId && !record) {
      toast('That Pantry item is no longer available.');
      feedback.emit('blocked', { target, interaction: deferredInteraction(sourceEvent, target) });
      return false;
    }
    editorId = recordId;
    editorOriginal = record ? JSON.parse(JSON.stringify(record)) : null;
    editorBaseFingerprint = record ? JSON.stringify(record) : '';
    editorReturnFocus = document.activeElement || null;
    editorReturnId = recordId;
    editorPending = false;
    recipeExpanded = false;
    editorSuspended = false;
    suspendedRecipeId = '';
    editorBodyOverflow = document.body?.style?.overflow || '';
    setEditorPending(false);
    setText('pantry-item-title', recordId ? 'Edit Pantry item' : 'Add Pantry item');
    setText('pantry-item-description', recordId
      ? 'Correct the shared amount without losing the original text.'
      : 'Add a shared item with as much measurement detail as you know.');
    const removeButton = get('pantry-item-remove');
    if (removeButton) removeButton.hidden = !recordId;
    const confirmation = get('pantry-remove-confirm');
    if (confirmation) confirmation.hidden = true;
    setError('');
    setStatus('');
    fillEditor(record ? pantryEditorState(record) : {
      name: '', quantity: '', family: 'unknown', unit: '', raw: raw.trim(),
    }, record);
    modal.hidden = false;
    modal.removeAttribute?.('aria-hidden');
    modal.removeAttribute?.('inert');
    modal.setAttribute?.('aria-modal', 'true');
    modal.classList?.add('open');
    if (overlay) {
      overlay.hidden = false;
      overlay.classList?.add('open');
    }
    renderRecipeDiscovery();
    if (sourceEvent) feedback.emit('select', { target, sourceEvent });
    globalThis.setTimeout?.(() => get('pantry-item-name')?.focus?.(), 0);
    return true;
  }

  function closeEditor({ force = false } = {}) {
    if (editorPending && !force) return false;
    const modal = get('pantry-item-modal');
    const overlay = get('pantry-item-overlay');
    if (modal) {
      modal.hidden = true;
      modal.setAttribute?.('aria-hidden', 'true');
      modal.setAttribute?.('inert', '');
      modal.removeAttribute?.('aria-modal');
      modal.classList?.remove('open');
    }
    if (overlay) { overlay.hidden = true; overlay.classList?.remove('open'); }
    if (document.body?.style) document.body.style.overflow = editorBodyOverflow;
    const focusTarget = editorReturnId
      ? (document.querySelector?.(`[data-pantry-id="${globalThis.CSS?.escape?.(editorReturnId) || editorReturnId}"]`)
        || document.querySelector?.('.pantry-tag')
        || get('pantry-add-btn'))
      : editorReturnFocus;
    editorId = null;
    editorOriginal = null;
    editorBaseFingerprint = '';
    editorReturnId = null;
    editorPending = false;
    recipeExpanded = false;
    editorSuspended = false;
    suspendedRecipeId = '';
    editorBodyOverflow = '';
    const discovery = get('pantry-recipe-discovery');
    if (discovery) discovery.hidden = true;
    focusTarget?.focus?.();
    return true;
  }

  function suspendEditor(recipeId = '') {
    if (editorPending || !editorId || !modalOpen()) return false;
    const modal = get('pantry-item-modal');
    const overlay = get('pantry-item-overlay');
    editorSuspended = true;
    suspendedRecipeId = recipeId;
    if (modal) {
      modal.hidden = true;
      modal.setAttribute?.('aria-hidden', 'true');
      modal.setAttribute?.('inert', '');
      modal.removeAttribute?.('aria-modal');
      modal.classList?.remove('open');
    }
    if (overlay) { overlay.hidden = true; overlay.classList?.remove('open'); }
    return true;
  }

  function resumeEditor() {
    if (!editorSuspended || !editorId) return false;
    const modal = get('pantry-item-modal');
    const overlay = get('pantry-item-overlay');
    editorSuspended = false;
    if (modal) {
      modal.hidden = false;
      modal.removeAttribute?.('aria-hidden');
      modal.removeAttribute?.('inert');
      modal.setAttribute?.('aria-modal', 'true');
      modal.classList?.add('open');
    }
    if (overlay) { overlay.hidden = false; overlay.classList?.add('open'); }
    render();
    const returnId = suspendedRecipeId;
    suspendedRecipeId = '';
    if (returnId) {
      const escaped = globalThis.CSS?.escape?.(returnId) || returnId;
      get('pantry-recipe-discovery')?.querySelector?.(`[data-pantry-recipe-id="${escaped}"]`)?.focus?.();
    }
    return true;
  }

  function openDiscoveredRecipe(event) {
    const row = event.target.closest?.('[data-pantry-recipe-id]');
    if (!row || row.disabled) return false;
    if (editorPending) {
      setError('Wait for the Pantry change to finish before opening a recipe.');
      feedback.emit('blocked', { target: row, sourceEvent: event });
      return false;
    }
    if (typeof onOpenRecipe !== 'function') return false;
    const recipeId = row.dataset.pantryRecipeId;
    if (!suspendEditor(recipeId)) return false;
    let opened = false;
    try { opened = onOpenRecipe(recipeId, { opener: row }); } catch { /* Navigation stays fail-safe. */ }
    if (opened === false) {
      resumeEditor();
      setError('That recipe is no longer available.');
      feedback.emit('blocked', { target: row, sourceEvent: event });
      return false;
    }
    return true;
  }

  function fallbackRecipeImage(event) {
    const image = event.target?.closest?.('.pantry-recipe-row img');
    if (!image) return;
    const fallback = document.createElement('span');
    fallback.className = 'pantry-recipe-image-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = '🍲';
    image.replaceWith(fallback);
  }

  function editorValues() {
    return {
      name: get('pantry-item-name')?.value || '',
      quantity: get('pantry-item-quantity')?.value || '',
      family: get('pantry-item-family')?.value || '',
      unit: get('pantry-item-unit')?.value || '',
    };
  }

  function setEditorPending(pending, message = '') {
    editorPending = pending;
    const save = get('pantry-item-save');
    const close = get('pantry-item-close');
    const removeButton = get('pantry-item-remove');
    if (save) save.disabled = pending;
    if (close) close.disabled = pending;
    if (removeButton) removeButton.disabled = pending;
    setStatus(message);
  }

  function deferredInteraction(sourceEvent, target) {
    const interaction = feedback.contextFromEvent?.(sourceEvent, target) || null;
    return interaction ? { ...interaction, deferred: true } : null;
  }

  function emitBlocked(target, interaction) {
    feedback.emit('blocked', { target, interaction });
  }

  async function saveEditor(event) {
    event?.preventDefault?.();
    if (editorPending) return false;
    const target = event?.submitter || get('pantry-item-save');
    const outcome = deferredInteraction(event, target);
    const current = editorId ? byId(editorId) : editorOriginal;
    if (editorId && !current) {
      setError('This item was removed by another household member. Your edits are still here.');
      emitBlocked(target, outcome);
      return false;
    }
    if (editorId && editorChanged(current)) {
      setError('This item changed in the shared Pantry. Close and reopen it to review the latest version.');
      emitBlocked(target, outcome);
      return false;
    }
    let candidate;
    try {
      candidate = pantryRecordFromEditor(editorValues(), current, { updatedAt: Date.now() });
    } catch (error) {
      setError(error?.message || 'Check the item details and try again.');
      emitBlocked(target, outcome);
      return false;
    }
    setError('');
    setEditorPending(true, 'Saving on this device…');
    const before = state.pantry;
    let next;
    let item;
    let op;
    let payload;
    try {
      if (editorId) {
        next = updatePantryRecord(before, editorId, candidate, { updatedAt: candidate.updatedAt });
        item = next.find((entry) => entry.id === editorId);
        op = 'pantry.update';
        payload = { id: editorId, item };
      } else {
        const result = addToPantry(before, candidate, { updatedAt: candidate.updatedAt });
        if (!result.item || !result.added) throw new Error('This Pantry item is already up to date.');
        next = result.pantry;
        item = result.item;
        op = 'pantry.add';
        payload = { item: candidate };
      }
    } catch (error) {
      setEditorPending(false);
      setError(error?.message === 'pantry_record_conflict'
        ? 'Cannot save this change because it would combine this item with another Pantry item. Keep both items separate by changing the name or amount type.'
        : error?.message || 'Check the item details and try again.');
      emitBlocked(target, outcome);
      return false;
    }
    state.pantry = next;
    publish();
    let accepted = true;
    try {
      if (mutate) accepted = await mutate(op, payload);
    } catch {
      accepted = false;
    }
    if (accepted === false) {
      if (state.pantry === next) state.pantry = before;
      publish();
      setEditorPending(false);
      setError('This change could not be saved. Your edits are still here; try again when sync recovers.');
      emitBlocked(target, outcome);
      return false;
    }
    const wasEdit = Boolean(editorId);
    if (!wasEdit) {
      const sourceInput = get('pantry-input');
      if (sourceInput) sourceInput.value = '';
    }
    feedback.emit('success', { target, interaction: outcome });
    closeEditor({ force: true });
    toast(wasEdit ? `Updated "${item.displayName}"` : `Added "${item.displayName}"`);
    return true;
  }

  function changeFamily(event = null) {
    const family = get('pantry-item-family')?.value || 'unknown';
    const quantity = get('pantry-item-quantity');
    const previousUnit = lastEditorUnit;
    const nextUnit = pantryUnitsForFamily(family)[0]?.value || '';
    const previousAmount = Number(quantity?.value);
    renderEditorUnits(family, nextUnit);
    if (family !== 'unknown' && quantity && Number.isFinite(previousAmount) && previousAmount > 0 && previousUnit && nextUnit) {
      try { quantity.value = String(convertPantryEditorAmount(previousAmount, previousUnit, nextUnit)); } catch { /* validation owns invalid text */ }
    }
    if (family === 'unknown') setStatus('Not sure keeps the original text but clears the trusted amount.');
    else setStatus(family === 'fluid' || family === 'solid'
      ? 'Solid and Fluid use the Pantry water-equivalent conversion.' : '');
    feedback.emit(family === 'unknown' ? 'toggle-off' : 'toggle-on', {
      target: get('pantry-item-family'), sourceEvent: event,
    });
  }

  function changeUnit(event = null) {
    const select = get('pantry-item-unit');
    const quantity = get('pantry-item-quantity');
    const nextUnit = select?.value || '';
    const amount = Number(quantity?.value);
    if (lastEditorUnit && nextUnit && Number.isFinite(amount) && amount > 0) {
      try { quantity.value = String(convertPantryEditorAmount(amount, lastEditorUnit, nextUnit)); } catch { /* validation owns invalid text */ }
    }
    lastEditorUnit = nextUnit;
    feedback.emit('select', { target: select, sourceEvent: event });
  }

  async function confirmRemove(event = null) {
    const target = event?.target?.closest?.('[data-action="confirm-pantry-remove"]')
      || event?.target || get('pantry-item-remove');
    const outcome = deferredInteraction(event, target);
    if (!editorId || editorPending) return false;
    const removed = byId(editorId);
    if (!removed) {
      setError('This item was already removed by another household member.');
      emitBlocked(target, outcome);
      return false;
    }
    if (editorChanged(removed)) {
      setError('This item changed in the shared Pantry. Close and reopen it before removing it.');
      emitBlocked(target, outcome);
      return false;
    }
    const before = state.pantry;
    const next = removeFromPantry(before, { id: removed.id });
    const expectedFingerprint = pantryRecordFingerprint(removed);
    feedback.emit('destructive', { target, sourceEvent: event });
    setEditorPending(true, 'Removing on this device…');
    state.pantry = next;
    publish();
    let accepted = true;
    try {
      if (mutate) accepted = await mutate('pantry.remove', { id: removed.id, expectedFingerprint });
    } catch {
      accepted = false;
    }
    if (accepted === false) {
      if (state.pantry === next) state.pantry = before;
      publish();
      setEditorPending(false);
      setError('This item could not be removed because it changed or sync failed. It has been restored; review it and try again.');
      emitBlocked(target, outcome);
      return false;
    }
    feedback.emit('success', { target, interaction: outcome });
    closeEditor({ force: true });
    toast(`Removed "${removed.displayName}".`, {
      actionLabel: 'Undo',
      onAction: async (sourceEvent) => {
        const undoTarget = sourceEvent?.currentTarget || sourceEvent?.target || null;
        const undoOutcome = deferredInteraction(sourceEvent, undoTarget);
        feedback.emit('commit', { target: undoTarget, sourceEvent });
        const undoBefore = state.pantry;
        let restored;
        try {
          restored = restorePantryRecord(undoBefore, removed);
        } catch {
          toast(`Cannot restore "${removed.displayName}" because the shared Pantry changed. Review the current item first.`);
          emitBlocked(undoTarget, undoOutcome);
          return;
        }
        if (restored.alreadyPresent) {
          toast(`"${removed.displayName}" is already restored in the Pantry.`);
          feedback.emit('success', { target: undoTarget, interaction: undoOutcome });
          return;
        }
        state.pantry = restored.pantry;
        publish();
        let undoAccepted = true;
        try {
          if (mutate) undoAccepted = await mutate('pantry.restore', { item: removed, expectedAbsent: true });
        } catch {
          undoAccepted = false;
        }
        if (undoAccepted === false) {
          if (state.pantry === restored.pantry) state.pantry = undoBefore;
          publish();
          toast(`Could not restore "${removed.displayName}" because the shared Pantry changed. Review the current item and try again.`);
          emitBlocked(undoTarget, undoOutcome);
          return;
        }
        feedback.emit('success', { target: undoTarget, interaction: undoOutcome });
        toast(`Restored "${removed.displayName}".`);
        document.querySelector?.(`[data-pantry-id="${globalThis.CSS?.escape?.(removed.id) || removed.id}"]`)?.focus?.();
      },
    });
    return true;
  }

  function trapEditorFocus(event) {
    if (!modalOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      closeEditor();
      return;
    }
    if (event.key !== 'Tab') return;
    const modal = get('pantry-item-modal');
    const focusable = [...(modal?.querySelectorAll?.('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])') || [])]
      .filter((element) => !element.closest?.('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!modal?.contains?.(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function wireGrid() {
    const grid = get('pantry-grid');
    grid?.addEventListener?.('click', (event) => {
      if (event.target.closest('[data-action="clear-pantry-filters"]')) { clearFilters(); return; }
      const row = event.target.closest('.pantry-tag');
      if (row?.dataset.pantryId) openEditor(row.dataset.pantryId, '', { sourceEvent: event, target: row });
    });
    const addButton = get('pantry-add-btn');
    const input = get('pantry-input');
    const addFromInput = (event = null) => openEditor(null, input?.value || '', { sourceEvent: event, target: addButton });
    addButton?.addEventListener?.('click', addFromInput);
    input?.addEventListener?.('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); addFromInput(event); }
    });
    get('pantry-search')?.addEventListener?.('input', (event) => setQuery(event.target.value));
    get('pantry-filters')?.addEventListener?.('click', (event) => {
      const button = event.target.closest('.pantry-filter');
      if (button) setCategory(button.dataset.category);
    });
    get('pantry-recipe-results')?.addEventListener?.('click', openDiscoveredRecipe);
    get('pantry-recipe-results')?.addEventListener?.('error', fallbackRecipeImage, true);
    get('pantry-recipe-toggle')?.addEventListener?.('click', () => {
      recipeExpanded = !recipeExpanded;
      renderRecipeDiscovery({ focusToggle: true });
    });
    get('pantry-item-form')?.addEventListener?.('submit', saveEditor);
    const family = get('pantry-item-family');
    const unit = get('pantry-item-unit');
    family?.addEventListener?.('pointerdown', (event) => feedback.contextFromEvent?.(event, family));
    unit?.addEventListener?.('pointerdown', (event) => feedback.contextFromEvent?.(event, unit));
    family?.addEventListener?.('change', changeFamily);
    unit?.addEventListener?.('change', changeUnit);
    get('pantry-item-close')?.addEventListener?.('click', closeEditor);
    get('pantry-item-overlay')?.addEventListener?.('click', () => { if (!editorPending) closeEditor(); });
    get('pantry-item-remove')?.addEventListener?.('click', () => {
      const confirmation = get('pantry-remove-confirm');
      if (confirmation) {
        confirmation.hidden = false;
        confirmation.querySelector?.('[data-action="cancel-pantry-remove"]')?.focus?.();
      }
      setStatus('This removes only this exact Pantry record. You can undo after removing it.');
    });
    const removeConfirm = get('pantry-remove-confirm');
    removeConfirm?.addEventListener?.('pointerdown', (event) => {
      const confirm = event.target.closest?.('[data-action="confirm-pantry-remove"]');
      if (confirm) feedback.contextFromEvent?.(event, confirm);
    });
    removeConfirm?.addEventListener?.('click', (event) => {
      if (event.target.closest('[data-action="cancel-pantry-remove"]')) {
        get('pantry-remove-confirm').hidden = true;
        setStatus('');
        get('pantry-item-remove')?.focus?.();
      } else if (event.target.closest('[data-action="confirm-pantry-remove"]')) {
        void confirmRemove(event);
      }
    });
    document.addEventListener?.('keydown', trapEditorFocus);
  }

  wireGrid();
  return {
    render,
    add,
    addFromInput: () => openEditor(null, get('pantry-input')?.value || ''),
    update,
    remove,
    setQuery,
    setCategory,
    openEditor,
    closeEditor,
    suspendEditor,
    resumeEditor,
    renderRecipeDiscovery,
    editorRecordId: () => editorId,
  };
}

function pantryTagHTML(item, category = pantryCategory(item)) {
  const name = item.displayName || item.name;
  const amount = formatPantryAmount(item);
  return `<button type="button" class="pantry-tag" data-pantry-id="${esc(item.id)}" data-pantry-name="${esc(item.name)}" data-category="${category}" data-feedback="select" aria-label="Edit ${esc(name)}, ${esc(amount)}"><span class="pantry-category-dot" aria-hidden="true"></span><span class="pantry-tag-copy"><span>${esc(name)}</span><small>${esc(amount)}</small></span><span class="pantry-tag-edit" aria-hidden="true">›</span></button>`;
}
