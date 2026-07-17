// test/controllers/search.test.js — search input, category chips, eligible-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

let mod;
try { mod = await import('../../docs/js/controllers/search.js'); } catch (e) { mod = {}; }

function makeDom() {
  const ids = ['search-input', 'search-clear', 'eligible-only', 'category-chips'];
  const elements = {};
  for (const id of ids) {
    elements[id] = {
      value: '', checked: false, innerHTML: '',
      listeners: {},
      addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
      focus: () => {},
      classList: { _set: new Set(), add(){}, remove(){}, contains(){return false}, toggle(c,on){on??=!this._set.has(c);on?this._set.add(c):this._set.delete(c);return on;}, },
      querySelectorAll: () => [],
    };
  }
  // search-clear's classList is observed by the controller, but our stub is generic.
  const document = {
    getElementById: (sel) => elements[sel] || null,
    querySelectorAll: () => [],
  };
  return { elements, document };
}

test('search.js exports initSearch', () => {
  assert.equal(typeof mod.initSearch, 'function');
});

test('initSearch returns { setQuery, setCategory, setEligibleOnly, _onSearchInput, _onCategoryClick }', () => {
  if (!mod.initSearch) return;
  const { document } = makeDom();
  const state = {};
  const ctrl = mod.initSearch({ state, document, onChange: () => {} });
  assert.equal(typeof ctrl.setQuery, 'function');
  assert.equal(typeof ctrl.setCategory, 'function');
  assert.equal(typeof ctrl.setEligibleOnly, 'function');
  assert.equal(typeof ctrl._onSearchInput, 'function');
  assert.equal(typeof ctrl._onCategoryClick, 'function');
});

test('typing in the search input updates state.searchTerm and calls onChange', () => {
  if (!mod.initSearch) return;
  const { document } = makeDom();
  const state = { searchTerm: '' };
  let changed = 0;
  const ctrl = mod.initSearch({ state, document, onChange: () => { changed++; } });
  ctrl._onSearchInput({ target: { value: 'pasta' } });
  assert.equal(state.searchTerm, 'pasta');
  assert.ok(changed > 0, 'onChange should fire');
});

test('typing a non-empty value adds .show to the clear button', () => {
  if (!mod.initSearch) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initSearch({ state: {}, document, onChange: () => {} });
  ctrl._onSearchInput({ target: { value: 'x' } });
  assert.equal(elements['search-clear'].classList._set.has('show'), true);
});

test('clearing the search via setQuery empties the input, state, and clear button', () => {
  if (!mod.initSearch) return;
  const { document, elements } = makeDom();
  elements['search-input'].value = 'leftover';
  const state = { searchTerm: 'leftover' };
  let changed = false;
  const ctrl = mod.initSearch({ state, document, onChange: () => { changed = true; } });
  ctrl.setQuery('');
  assert.equal(elements['search-input'].value, '');
  assert.equal(state.searchTerm, '');
  assert.equal(elements['search-clear'].classList._set.has('show'), false);
  assert.equal(changed, true);
});

test('toggling eligible-only checkbox updates state.eligibleOnly', () => {
  if (!mod.initSearch) return;
  const { document, elements } = makeDom();
  const state = { eligibleOnly: false };
  const ctrl = mod.initSearch({ state, document, onChange: () => {} });
  elements['eligible-only'].checked = true;
  ctrl._onEligibleChange({ target: { checked: true } });
  assert.equal(state.eligibleOnly, true);
});

test('clicking a category chip sets state.categoryFilter to chip.dataset.cat', () => {
  if (!mod.initSearch) return;
  const { document } = makeDom();
  const state = { categoryFilter: null };
  const chip = {
    dataset: { cat: 'Entree' },
    classList: { _set: new Set(), add(){}, remove(){}, toggle(){}, contains(){return false} },
    setAttribute() {},
    closest(sel) { return sel === '.chip' ? this : null; },
  };
  const fakeChips = [chip];
  const document2 = {
    getElementById: (sel) => {
      if (sel === 'category-chips') {
        return { querySelectorAll: () => fakeChips, addEventListener: () => {} };
      }
      return makeDom().elements[sel] || null;
    },
    querySelectorAll: () => [],
  };
  const ctrl = mod.initSearch({ state, document: document2, onChange: () => {} });
  ctrl._onCategoryClick({ target: chip });
  assert.equal(state.categoryFilter, 'Entree');
});

test('setCategory updates state and fires onChange', () => {
  if (!mod.initSearch) return;
  const { document } = makeDom();
  const state = { categoryFilter: null };
  let changed = 0;
  const ctrl = mod.initSearch({ state, document, onChange: () => { changed++; } });
  ctrl.setCategory('Dessert');
  assert.equal(state.categoryFilter, 'Dessert');
  assert.ok(changed > 0);
});

test('setEligibleOnly updates state and fires onChange', () => {
  if (!mod.initSearch) return;
  const { document } = makeDom();
  const state = { eligibleOnly: false };
  let changed = 0;
  const ctrl = mod.initSearch({ state, document, onChange: () => { changed++; } });
  ctrl.setEligibleOnly(true);
  assert.equal(state.eligibleOnly, true);
  assert.ok(changed > 0);
});

test('production search controller exposes reviewed recipe usage lookup without issue-21 UI', () => {
  const { document } = makeDom();
  const state = {
    recipes: [
      { _id: 'soup', name: 'Soup', recipeIngredient: ['1 onion', '2 onions'] },
      { _id: 'soup', name: 'Stale duplicate', recipeIngredient: ['1 onion'] },
      { name: 'No id', recipeIngredient: ['1 onion'] },
    ],
  };
  const ctrl = mod.initSearch({ state, document });
  assert.equal(typeof ctrl.findRecipeUses, 'function');
  const forward = ctrl.findRecipeUses('onions');
  state.recipes.reverse();
  assert.deepEqual(ctrl.findRecipeUses('onion'), forward);
  assert.equal(forward.length, 2);
  assert.deepEqual(forward.map((use) => use.recipeName), ['No id', 'Soup']);
});
