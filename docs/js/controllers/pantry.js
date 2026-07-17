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
export function initPantry({ state, document = globalThis.document, onChange = null, mutate = null }) {
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
      grid.innerHTML = '<div class="pantry-empty"><span aria-hidden="true">✨</span><strong>Nothing here yet.</strong><p>Try another search or category.</p><button class="btn btn-ghost btn-sm" data-action="clear-pantry-filters">Show everything</button></div>';
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
      return `<button type="button" class="pantry-filter${active ? ' is-active' : ''}" data-category="${id}" aria-pressed="${active}">${label}<span>${count}</span></button>`;
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

  function openEditor(recordId = null, raw = '') {
    const modal = get('pantry-item-modal');
    const overlay = get('pantry-item-overlay');
    if (!modal) return false;
    const record = recordId ? byId(recordId) : normalizePantryEntry(raw, { updatedAt: Date.now() });
    if (recordId && !record) {
      toast('That Pantry item is no longer available.');
      return false;
    }
    editorId = recordId;
    editorOriginal = record ? JSON.parse(JSON.stringify(record)) : null;
    editorBaseFingerprint = record ? JSON.stringify(record) : '';
    editorReturnFocus = document.activeElement || null;
    editorReturnId = recordId;
    editorPending = false;
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
    modal.classList?.add('open');
    if (overlay) {
      overlay.hidden = false;
      overlay.classList?.add('open');
    }
    globalThis.setTimeout?.(() => get('pantry-item-name')?.focus?.(), 0);
    return true;
  }

  function closeEditor({ force = false } = {}) {
    if (editorPending && !force) return false;
    const modal = get('pantry-item-modal');
    const overlay = get('pantry-item-overlay');
    if (modal) { modal.hidden = true; modal.classList?.remove('open'); }
    if (overlay) { overlay.hidden = true; overlay.classList?.remove('open'); }
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
    focusTarget?.focus?.();
    return true;
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

  async function saveEditor(event) {
    event?.preventDefault?.();
    if (editorPending) return false;
    const current = editorId ? byId(editorId) : editorOriginal;
    if (editorId && !current) {
      setError('This item was removed by another household member. Your edits are still here.');
      return false;
    }
    if (editorId && editorChanged(current)) {
      setError('This item changed in the shared Pantry. Close and reopen it to review the latest version.');
      return false;
    }
    let candidate;
    try {
      candidate = pantryRecordFromEditor(editorValues(), current, { updatedAt: Date.now() });
    } catch (error) {
      setError(error?.message || 'Check the item details and try again.');
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
      return false;
    }
    const wasEdit = Boolean(editorId);
    if (!wasEdit) {
      const sourceInput = get('pantry-input');
      if (sourceInput) sourceInput.value = '';
    }
    closeEditor({ force: true });
    toast(wasEdit ? `Updated "${item.displayName}"` : `Added "${item.displayName}"`);
    return true;
  }

  function changeFamily() {
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
  }

  function changeUnit() {
    const select = get('pantry-item-unit');
    const quantity = get('pantry-item-quantity');
    const nextUnit = select?.value || '';
    const amount = Number(quantity?.value);
    if (lastEditorUnit && nextUnit && Number.isFinite(amount) && amount > 0) {
      try { quantity.value = String(convertPantryEditorAmount(amount, lastEditorUnit, nextUnit)); } catch { /* validation owns invalid text */ }
    }
    lastEditorUnit = nextUnit;
  }

  async function confirmRemove() {
    if (!editorId || editorPending) return false;
    const removed = byId(editorId);
    if (!removed) {
      setError('This item was already removed by another household member.');
      return false;
    }
    if (editorChanged(removed)) {
      setError('This item changed in the shared Pantry. Close and reopen it before removing it.');
      return false;
    }
    const before = state.pantry;
    const next = removeFromPantry(before, { id: removed.id });
    const expectedFingerprint = pantryRecordFingerprint(removed);
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
      return false;
    }
    closeEditor({ force: true });
    toast(`Removed "${removed.displayName}".`, {
      actionLabel: 'Undo',
      onAction: async () => {
        const undoBefore = state.pantry;
        let restored;
        try {
          restored = restorePantryRecord(undoBefore, removed);
        } catch {
          toast(`Cannot restore "${removed.displayName}" because the shared Pantry changed. Review the current item first.`);
          return;
        }
        if (restored.alreadyPresent) {
          toast(`"${removed.displayName}" is already restored in the Pantry.`);
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
          return;
        }
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
      if (row?.dataset.pantryId) openEditor(row.dataset.pantryId);
    });
    const addButton = get('pantry-add-btn');
    const input = get('pantry-input');
    const addFromInput = () => openEditor(null, input?.value || '');
    addButton?.addEventListener?.('click', addFromInput);
    input?.addEventListener?.('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); addFromInput(); }
    });
    get('pantry-search')?.addEventListener?.('input', (event) => setQuery(event.target.value));
    get('pantry-filters')?.addEventListener?.('click', (event) => {
      const button = event.target.closest('.pantry-filter');
      if (button) setCategory(button.dataset.category);
    });
    get('pantry-item-form')?.addEventListener?.('submit', saveEditor);
    get('pantry-item-family')?.addEventListener?.('change', changeFamily);
    get('pantry-item-unit')?.addEventListener?.('change', changeUnit);
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
    get('pantry-remove-confirm')?.addEventListener?.('click', (event) => {
      if (event.target.closest('[data-action="cancel-pantry-remove"]')) {
        get('pantry-remove-confirm').hidden = true;
        setStatus('');
        get('pantry-item-remove')?.focus?.();
      } else if (event.target.closest('[data-action="confirm-pantry-remove"]')) {
        void confirmRemove();
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
    editorRecordId: () => editorId,
  };
}

function pantryTagHTML(item, category = pantryCategory(item)) {
  const name = item.displayName || item.name;
  const amount = formatPantryAmount(item);
  return `<button type="button" class="pantry-tag" data-pantry-id="${esc(item.id)}" data-pantry-name="${esc(item.name)}" data-category="${category}" aria-label="Edit ${esc(name)}, ${esc(amount)}"><span class="pantry-category-dot" aria-hidden="true"></span><span class="pantry-tag-copy"><span>${esc(name)}</span><small>${esc(amount)}</small></span><span class="pantry-tag-edit" aria-hidden="true">›</span></button>`;
}
