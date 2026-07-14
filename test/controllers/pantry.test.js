// test/controllers/pantry.test.js — pantry add/remove + render.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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

function makeDom() {
  const grid = { innerHTML: '', addEventListener: () => {} };
  const input = { value: '', focus() {}, addEventListener: () => {} };
  const suggestions = { innerHTML: '' };
  const addBtn = { addEventListener: () => {} };
  const document = {
    getElementById(sel) {
      if (sel === 'pantry-grid') return grid;
      if (sel === 'pantry-input') return input;
      if (sel === 'pantry-suggestions') return suggestions;
      if (sel === 'pantry-add-btn') return addBtn;
      return null;
    },
  };
  return { grid, input, suggestions, document };
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
});

test('add("salt") pushes "salt" to state.pantry and returns the new item', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  const result = ctrl.add('salt');
  assert.equal(result, 'salt', 'add should return the added item name');
  assert.ok(state.pantry.includes('salt'), 'state.pantry should contain the new item');
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

test('add normalizes the ingredient (lowercase, trimmed)', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = initPantryFn(mod, state, document);
  ctrl.add('  Olive Oil  ');
  assert.deepEqual(state.pantry, ['olive oil']);
});

function initPantryFn(m, state, document) {
  return m.initPantry({ state, document });
}

test('add duplicate returns null and does not double-add', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: ['salt'], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  const result = ctrl.add('salt');
  assert.equal(result, null, 'duplicate returns null');
  assert.equal(state.pantry.length, 1);
});

test('remove("salt") drops it from state.pantry', () => {
  if (!mod.initPantry) return;
  const { document } = makeDom();
  const state = { pantry: ['salt', 'pepper'], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.remove('salt');
  assert.deepEqual(state.pantry, ['pepper']);
});

test('shared pantry add and remove emit absolute workspace operations', () => {
  const { document } = makeDom();
  const state = { pantry: [], recipes: [] };
  const calls = [];
  const ctrl = mod.initPantry({ state, document, mutate: (op, payload) => calls.push({ op, payload }) });
  ctrl.add('  Olive Oil  ');
  ctrl.remove('olive oil');
  assert.deepEqual(calls, [
    { op: 'pantry.add', payload: { name: 'olive oil' } },
    { op: 'pantry.remove', payload: { name: 'olive oil' } },
  ]);
});

test('render produces one .pantry-tag per item', () => {
  if (!mod.initPantry) return;
  const { document, grid } = makeDom();
  const state = { pantry: ['salt', 'pepper', 'olive oil'], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.render();
  const tags = (grid.innerHTML.match(/pantry-tag/g) || []).length;
  assert.equal(tags, 3, `expected 3 pantry tags, got ${tags}`);
});

test('render with empty pantry shows the empty hint', () => {
  if (!mod.initPantry) return;
  const { document, grid } = makeDom();
  const state = { pantry: [], recipes: [] };
  const ctrl = mod.initPantry({ state, document });
  ctrl.render();
  assert.match(grid.innerHTML, /empty|pantry/i, 'empty state should render');
});
