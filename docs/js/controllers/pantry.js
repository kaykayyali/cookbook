// ════════════════════════════════════════════════════════
// controllers/pantry.js — pantry add/remove + render
// ════════════════════════════════════════════════════════

import { esc } from '../lib/format.js';
import {
  addToPantry,
  removeFromPantry,
  normalizePantry,
  normalizePantryEntry,
  formatPantryAmount,
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
 * Pantry controller. Owns the pantry grid, add/remove handlers, and the
 * suggestions datalist refresh.
 *
 * @param {object} deps
 * @param {object} deps.state - { pantry, recipes }
 * @param {Document} [deps.document]
 * @param {() => void} [deps.onChange] - called after add/remove
 * @returns {{ render: () => void, add: (raw) => string|null, remove: (item) => void }}
 */
export function initPantry({ state, document = globalThis.document, onChange = null, mutate = null }) {
  state.pantry = normalizePantry(state.pantry);
  let query = '';
  let category = 'all';

  function render() {
    const grid = document.getElementById('pantry-grid');
    if (!grid) return;
    const total = state.pantry.length;
    const normalizedQuery = query.trim().toLowerCase();
    const visible = [...state.pantry]
      .filter((item) => !normalizedQuery
        || item.name.includes(normalizedQuery)
        || item.displayName.toLowerCase().includes(normalizedQuery))
      .filter((item) => category === 'all' || pantryCategory(item) === category)
      .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));

    renderFilters();
    const summary = document.getElementById('pantry-summary');
    if (summary) summary.textContent = visible.length === total
      ? `${total} ${total === 1 ? 'item' : 'items'}`
      : `${visible.length} of ${total} items`;

    if (!state.pantry.length) {
      grid.innerHTML = '<div class="pantry-empty"><span aria-hidden="true">🫙</span><strong>Your pantry is ready.</strong><p>Add a few things you usually cook with.</p></div>';
      return;
    }
    if (!visible.length) {
      grid.innerHTML = '<div class="pantry-empty"><span aria-hidden="true">✨</span><strong>Nothing here yet.</strong><p>Try another search or category.</p><button class="btn btn-ghost btn-sm" data-action="clear-pantry-filters" data-feedback="select">Show everything</button></div>';
      return;
    }

    grid.innerHTML = PANTRY_CATEGORIES.map(([id, label]) => {
      const items = visible.filter((item) => pantryCategory(item) === id);
      if (!items.length) return '';
      return `<section class="pantry-group" data-category="${id}">
        <div class="pantry-group-heading"><span class="pantry-category-dot" aria-hidden="true"></span><h3>${label}</h3><span>${items.length}</span></div>
        <div class="pantry-items">${items.map((item) => pantryTagHTML(item, id)).join('')}</div>
      </section>`;
    }).join('');
  }

  function renderFilters() {
    const zone = document.getElementById('pantry-filters');
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
    const search = document.getElementById('pantry-search');
    if (search) search.value = '';
    render();
  }

  function add(raw) {
    const updatedAt = Date.now();
    const delta = normalizePantryEntry(raw, { updatedAt });
    const { pantry, added, name, item } = addToPantry(state.pantry, delta);
    if (!name) return null;
    if (!added) return null;
    state.pantry = pantry;
    if (mutate) void mutate('pantry.add', { item: delta });
    persist();
    render();
    if (onChange) onChange();
    toast(`Added "${name}"`);
    return item;
  }

  function addFromInput() {
    const inp = document.getElementById('pantry-input');
    if (!inp) return;
    add(inp.value);
    inp.value = '';
    inp.focus();
  }

  function update(recordId, value) {
    const updatedAt = Date.now();
    state.pantry = updatePantryRecord(state.pantry, recordId, value, { updatedAt });
    const item = state.pantry.find((entry) => entry.id === recordId);
    if (mutate) void mutate('pantry.update', { id: recordId, item });
    persist();
    render();
    if (onChange) onChange();
    return item;
  }

  function remove(item) {
    state.pantry = removeFromPantry(state.pantry, item);
    const id = typeof item === 'object' ? item?.id : undefined;
    const name = typeof item === 'string' ? item : item?.name;
    const unit = typeof item === 'object' ? item?.unit : undefined;
    const countLabel = typeof item === 'object' ? item?.countLabel : undefined;
    if (mutate) void mutate('pantry.remove', {
      ...(id ? { id } : {}),
      ...(!id ? {
        name,
        ...(unit ? { unit } : {}),
        ...(unit === 'count' ? { countLabel: countLabel || '' } : {}),
      } : {}),
    });
    persist();
    render();
    if (onChange) onChange();
    toast(`Removed "${name}"`);
  }

  function wireGrid() {
    const grid = document.getElementById('pantry-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="clear-pantry-filters"]')) { clearFilters(); return; }
        const btn = e.target.closest('.pantry-remove');
        if (!btn) return;
        remove({
          id: btn.dataset.pantryRecordId,
          name: btn.dataset.item,
          unit: btn.dataset.unit,
          countLabel: btn.dataset.countLabel,
        });
      });
    }
    const addBtn = document.getElementById('pantry-add-btn');
    if (addBtn) addBtn.addEventListener('click', addFromInput);
    const inp = document.getElementById('pantry-input');
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
      });
    }
    const search = document.getElementById('pantry-search');
    if (search) search.addEventListener('input', (e) => setQuery(e.target.value));
    const filters = document.getElementById('pantry-filters');
    if (filters) filters.addEventListener('click', (e) => {
      const btn = e.target.closest('.pantry-filter');
      if (btn) setCategory(btn.dataset.category);
    });
  }

  wireGrid();
  return { render, add, addFromInput, update, remove, setQuery, setCategory };
}

function pantryTagHTML(item, category = pantryCategory(item)) {
  const name = item.displayName || item.name;
  const amount = formatPantryAmount(item);
  return `<span class="pantry-tag" data-pantry-id="${esc(item.id)}" data-category="${category}"><span class="pantry-category-dot" aria-hidden="true"></span><span class="pantry-tag-copy"><span>${esc(name)}</span><small>${esc(amount)}</small></span>
       <button class="pantry-remove" data-pantry-record-id="${esc(item.id)}" data-item="${esc(item.name)}" data-unit="${esc(item.unit)}" data-count-label="${esc(item.countLabel)}" data-feedback="destructive" aria-label="Remove ${esc(name)}, ${esc(amount)}">${'<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'}</button>
     </span>`;
}
