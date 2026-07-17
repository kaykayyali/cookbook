// test/controllers/pantry.test.js — pantry add/remove + render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePantry } from '../../docs/js/lib/pantry.js';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    getElementById: (sel) => sel === 'toast' ? { innerHTML: '', textContent: '', classList: { add() {}, remove() {} } } : null,
  };
}

let mod;
try { mod = await import('../../docs/js/controllers/pantry.js'); } catch (e) { mod = {}; }

const pantryItem = (name, overrides = {}) => ({
  name,
  displayName: name.split(' ').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '),
  quantity: null,
  unit: 'qualitative',
  kind: 'qualitative',
  countLabel: '',
  category: 'other',
  ...overrides,
});

function makeDom() {
  const grid = { innerHTML: '', addEventListener: () => {} };
  const input = { value: '', focus() {}, addEventListener: () => {} };
  const suggestions = { innerHTML: '' };
  const addBtn = { addEventListener: () => {} };
  const search = { value: '', addEventListener: () => {} };
  const filters = { innerHTML: '', addEventListener: () => {} };
  const summary = { textContent: '' };
  const document = {
    getElementById(sel) {
      if (sel === 'pantry-grid') return grid;
      if (sel === 'pantry-input') return input;
      if (sel === 'pantry-suggestions') return suggestions;
      if (sel === 'pantry-add-btn') return addBtn;
      if (sel === 'pantry-search') return search;
      if (sel === 'pantry-filters') return filters;
      if (sel === 'pantry-summary') return summary;
      return null;
    },
  };
  return { grid, input, suggestions, search, filters, summary, document };
}

test('pantry.js exports initPantry', () => {
  assert.equal(typeof mod.initPantry, 'function');
});

test('initPantry returns { render, add, remove }', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  assert.equal(typeof ctrl.render, 'function');
  assert.equal(typeof ctrl.add, 'function');
  assert.equal(typeof ctrl.remove, 'function');
  assert.equal(typeof ctrl.setQuery, 'function');
  assert.equal(typeof ctrl.setCategory, 'function');
});

test('pantryCategory assigns simple display-only food groups', () => {
  assert.equal(mod.pantryCategory('fresh basil'), 'produce');
  assert.equal(mod.pantryCategory('red bell pepper'), 'produce');
  assert.equal(mod.pantryCategory('lemons'), 'produce');
  assert.equal(mod.pantryCategory('whole milk'), 'fridge');
  assert.equal(mod.pantryCategory('chicken thighs'), 'proteins');
  assert.equal(mod.pantryCategory('olive oil'), 'staples');
  assert.equal(mod.pantryCategory('black pepper'), 'staples');
  assert.equal(mod.pantryCategory(pantryItem('black pepper', { category: 'produce' })), 'staples');
  assert.equal(mod.pantryCategory('mystery sauce'), 'other');
});

test('add parses free-form quantity text into the shared normalized contract', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  const result = ctrl.add('2 cups olive oil');
  assert.deepEqual(
    (({ name, displayName, quantity, unit, kind, countLabel, category, amountState }) => (
      { name, displayName, quantity, unit, kind, countLabel, category, amountState }
    ))(result),
    {
      name: 'olive oil', displayName: 'Olive Oil', quantity: 16, unit: 'ounce',
      kind: 'divisible', countLabel: '', category: 'pantry', amountState: 'known',
    },
  );
  assert.match(result.id, /^pantry-/);
  assert.equal(result.raw, '2 cups olive oil');
  assert.deepEqual(state.pantry, [result]);
});

test('add with empty/whitespace string is a no-op', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  const result = ctrl.add('   ');
  assert.equal(result, null, 'empty input returns null');
  assert.equal(state.pantry.length, 0);
});

test('add without a stated quantity remains a compatible qualitative entry', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = initPantryFn(mod, state, document);
  ctrl.add('  Olive Oil  ');
  assert.deepEqual(state.pantry.map(({ name, displayName, quantity, unit, category, amountState, raw }) => ({
    name, displayName, quantity, unit, category, amountState, raw,
  })), [{
    name: 'olive oil', displayName: 'Olive Oil', quantity: null, unit: 'qualitative',
    category: 'pantry', amountState: 'unknown', raw: 'Olive Oil',
  }]);
});

function initPantryFn(m, state, document) {
  return m.initPantry({ state, document });
}

test('add duplicate returns null and does not double-add', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [pantryItem('salt', { displayName: 'Salt', category: 'pantry' })], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  const result = ctrl.add('salt');
  assert.equal(result, null, 'duplicate returns null');
  assert.equal(state.pantry.length, 1);
});

test('remove("salt") drops it from state.pantry', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [pantryItem('salt'), pantryItem('pepper')], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.remove('salt');
  assert.deepEqual(state.pantry.map((item) => item.name), ['pepper']);
});

test('shared pantry add and remove emit absolute workspace operations', () => {
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const calls = [];
  const ctrl = mod.initPantry({ state, document, mutate: (op, payload) => calls.push({ op, payload }) });
  ctrl.add('2 cups Olive Oil');
  ctrl.remove('olive oil');
  assert.equal(calls[0].op, 'pantry.add');
  assert.deepEqual(
    (({ name, quantity, unit, amountState, raw }) => ({ name, quantity, unit, amountState, raw }))(calls[0].payload.item),
    { name: 'olive oil', quantity: 16, unit: 'ounce', amountState: 'known', raw: '2 cups Olive Oil' },
  );
  assert.match(calls[0].payload.item.id, /^pantry-/);
  assert.deepEqual(calls[1], { op: 'pantry.remove', payload: { name: 'olive oil' } });
});

test('adding to an existing Pantry quantity sends only the new amount as the workspace delta', () => {
  const { document } = makeDom();
  const state = { pantry: [pantryItem('olive oil', {
    displayName: 'Olive Oil', quantity: 16, unit: 'ounce', kind: 'divisible', category: 'pantry',
  })], recipes: [] };
  const calls = [];
  const ctrl = mod.initPantry({ state, document, mutate: (op, payload) => calls.push({ op, payload }) });
  ctrl.add('1 cup olive oil');
  assert.equal(state.pantry[0].quantity, 24, 'local Pantry shows the accumulated total');
  assert.equal(calls[0].payload.item.quantity, 8, 'authority receives only the new additive amount');
});

test('render shows each Pantry item with a compatible formatted quantity', () => {
  const { document, grid } = makeDom();
  const state = { pantry: [pantryItem('olive oil', {
    displayName: 'Olive Oil', quantity: 16, unit: 'ounce', kind: 'divisible', category: 'pantry',
  })], recipes: [] };
  mod.initPantry({ state, document }).render();
  assert.match(grid.innerHTML, /Olive Oil/);
  assert.match(grid.innerHTML, /2 cups/);
});

test('render produces one .pantry-tag per item', () => {
  if (!mod.initPantry) return;
  const { document, grid } = makeDom();
  const state = { pantry: ['salt', 'pepper', 'olive oil'], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.render();
  const tags = (grid.innerHTML.match(/class="pantry-tag"/g) || []).length;
  assert.equal(tags, 3, `expected 3 pantry tags, got ${tags}`);
});

test('render groups pantry items and reports the total', () => {
  const { document, grid, summary, filters } = makeDom();
  const state = { pantry: ['milk', 'basil', 'chicken thighs', 'olive oil'], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.render();
  assert.match(grid.innerHTML, /pantry-group/);
  assert.match(grid.innerHTML, /Produce/);
  assert.match(grid.innerHTML, /Fridge/);
  assert.equal(summary.textContent, '4 items');
  assert.match(filters.innerHTML, /data-category="all"/);
  assert.match(filters.innerHTML, /data-category="produce"/);
});

test('search filters pantry names case-insensitively', () => {
  const { document, grid, summary } = makeDom();
  const state = { pantry: ['olive oil', 'black olives', 'salt'], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.setQuery('OLIVE');
  assert.match(grid.innerHTML, /olive oil/);
  assert.match(grid.innerHTML, /black olives/);
  assert.doesNotMatch(grid.innerHTML, />salt</);
  assert.equal(summary.textContent, '2 of 3 items');
});

test('category chips filter pantry without changing stored normalized entries', () => {
  const { document, grid, summary } = makeDom();
  const state = { pantry: ['milk', 'basil', 'olive oil'], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.setCategory('produce');
  assert.match(grid.innerHTML, /basil/);
  assert.doesNotMatch(grid.innerHTML, /milk|olive oil/);
  assert.equal(summary.textContent, '1 of 3 items');
  assert.deepEqual(state.pantry.map((item) => item.name), ['basil', 'milk', 'olive oil']);
});

test('no matches renders a friendly resettable empty state', () => {
  const { document, grid } = makeDom();
  const ctrl = mod.initPantry({ state: { pantry: ['salt'], recipes: [] }, document });
  ctrl.setQuery('mango');
  assert.match(grid.innerHTML, /Nothing here yet/);
  assert.match(grid.innerHTML, /data-action="clear-pantry-filters"/);
});

test('render with empty pantry shows the empty hint', () => {
  if (!mod.initPantry) return;
  const { document, grid } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.render();
  assert.match(grid.innerHTML, /empty|pantry/i, 'empty state should render');
});

test('render identifies records stably and displays unknown quantities exactly as Not sure', () => {
  const { document, grid } = makeDom();
  const state = { pantry: [{
    id: 'pantry-basil', raw: 'to 4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
    quantity: 4, unit: 'count', kind: 'indivisible', countLabel: '', category: 'produce',
    confidence: 0.4, amountState: 'unknown', measurementFamily: 'count',
    normalizationVersion: 1, updatedAt: 10,
  }], recipes: [] };
  mod.initPantry({ state, document }).render();
  assert.match(grid.innerHTML, /data-pantry-id="pantry-basil"/);
  assert.match(grid.innerHTML, />Not sure</);
  assert.doesNotMatch(grid.innerHTML, /As needed/i);
});

test('controller exposes update-by-ID semantics for a later editor without building the editor UI', () => {
  const { document } = makeDom();
  const [record] = normalizePantry(['to 4 basil leaves']);
  const state = { pantry: [record], recipes: [] };
  const calls = [];
  const ctrl = mod.initPantry({ state, document, mutate: (op, payload) => calls.push({ op, payload }) });
  assert.equal(typeof ctrl.update, 'function');
  const updated = ctrl.update(record.id, {
    raw: '4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
    quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.95,
  });
  assert.equal(updated.id, record.id);
  assert.equal(state.pantry[0].amountState, 'known');
  assert.equal(calls[0].op, 'pantry.update');
  assert.equal(calls[0].payload.id, record.id);
  assert.equal(calls[0].payload.item.id, record.id);
});
