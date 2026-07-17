// test/controllers/detail.test.js — recipe detail modal open/close + render.

import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod;
try { mod = await import('../../docs/js/controllers/detail.js'); } catch (e) { mod = {}; }

function makeDom() {
  const ids = [
    'detail-modal', 'detail-overlay', 'dm-eyebrow', 'dm-title', 'dm-meta',
    'dm-ingredients', 'dm-pantry-note', 'dm-steps', 'dm-nutrition', 'dm-nutrition-grid',
    'dm-edit-btn', 'dm-schema-btn', 'dm-community-edit-btn', 'dm-community-delete-btn',
  ];
  const elements = {};
  for (const id of ids) {
    elements[id] = {
      textContent: '', innerHTML: '', style: { display: '' },
      addEventListener: () => {},
      classList: { _set: new Set(), add(c){this._set.add(c)}, remove(c){this._set.delete(c)}, contains(c){return this._set.has(c)}, toggle(c,on){on??=!this._set.has(c);on?this._set.add(c):this._set.delete(c);return on;}, },
    };
  }
  const detailBody = { scrollTop: 0 };
  const document = {
    getElementById: (sel) => elements[sel] || null,
    querySelector: (sel) => sel === '.detail-body' ? detailBody : null,
    body: { style: { overflow: '' } },
  };
  elements.detailBody = detailBody;
  return { elements, document };
}

const SAMPLE = {
  _id: 'r1',
  name: 'Carbonara',
  recipeCategory: 'Entree',
  recipeCuisine: 'Italian',
  recipeIngredient: ['spaghetti', 'eggs'],
  recipeInstructions: ['boil', 'mix'],
  nutrition: { calories: '650 kcal' },
};

test('detail.js exports initDetail', () => {
  assert.equal(typeof mod.initDetail, 'function');
});

test('initDetail returns { open, close }', () => {
  if (!mod.initDetail) return;
  const { document } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  assert.equal(typeof ctrl.open, 'function');
  assert.equal(typeof ctrl.close, 'function');
});

test('open(id) fills dm-title with the recipe name', () => {
  if (!mod.initDetail) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('r1');
  assert.equal(elements['dm-title'].textContent, 'Carbonara');
});

test('open(id) formats array-valued category and cuisine metadata for people', () => {
  const { document, elements } = makeDom();
  const recipe = {
    ...SAMPLE,
    recipeCategory: ['Dinner', 'Weeknight'],
    recipeCuisine: ['Italian', 'American'],
  };
  mod.initDetail({ state: { recipes: [recipe], pantry: [] }, document }).open('r1');
  assert.equal(elements['dm-eyebrow'].textContent, 'Dinner · Weeknight · Italian · American');
});

test('open(id) sets state.detailId', () => {
  if (!mod.initDetail) return;
  const { document } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('r1');
  assert.equal(state.detailId, 'r1');
});

test('open(id) hides author-only controls from a non-author', () => {
  const { document, elements } = makeDom();
  const recipe = { ...SAMPLE, _author: { sub: 'author-1', name: 'Ada' } };
  const state = { recipes: [recipe], pantry: [], auth: { sub: 'reader-1' } };
  mod.initDetail({ state, document }).open('r1');
  assert.equal(elements['dm-edit-btn'].style.display, 'none');
});

test('open(id) opens the modal and overlay (.open class)', () => {
  if (!mod.initDetail) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('r1');
  assert.equal(elements['detail-modal'].classList.contains('open'), true);
  assert.equal(elements['detail-overlay'].classList.contains('open'), true);
});

test('open with unknown id is a no-op', () => {
  if (!mod.initDetail) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('nope');
  assert.equal(elements['dm-title'].textContent, '');
  assert.equal(elements['detail-modal'].classList.contains('open'), false);
});

test('close removes .open from modal + overlay and clears state.detailId', () => {
  if (!mod.initDetail) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('r1');
  ctrl.close();
  assert.equal(elements['detail-modal'].classList.contains('open'), false);
  assert.equal(elements['detail-overlay'].classList.contains('open'), false);
  assert.equal(state.detailId, null);
});

test('open persists the recipe id and close clears it', () => {
  const stored = {};
  globalThis.localStorage = {
    getItem: (key) => stored[key] ?? null,
    setItem: (key, value) => { stored[key] = String(value); },
    removeItem: (key) => { delete stored[key]; },
  };
  const { document } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('r1');
  assert.equal(stored.cb_detail_id, 'r1');
  ctrl.close();
  assert.equal(stored.cb_detail_id, undefined);
});

test('restore reopens the persisted recipe detail', () => {
  const stored = { cb_detail_id: 'r1' };
  globalThis.localStorage = {
    getItem: (key) => stored[key] ?? null,
    setItem: (key, value) => { stored[key] = String(value); },
    removeItem: (key) => { delete stored[key]; },
  };
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.restore();
  assert.equal(state.detailId, 'r1');
  assert.equal(elements['dm-title'].textContent, 'Carbonara');
  assert.equal(elements['detail-modal'].classList.contains('open'), true);
});

test('restore clears a saved recipe id that no longer exists', () => {
  const stored = { cb_detail_id: 'deleted' };
  globalThis.localStorage = {
    getItem: (key) => stored[key] ?? null,
    setItem: (key, value) => { stored[key] = String(value); },
    removeItem: (key) => { delete stored[key]; },
  };
  const { document, elements } = makeDom();
  const ctrl = mod.initDetail({ state: { recipes: [SAMPLE], pantry: [] }, document });
  ctrl.restore();
  assert.equal(stored.cb_detail_id, undefined);
  assert.equal(elements['detail-modal'].classList.contains('open'), false);
});

test('open renders ingredients list when present', () => {
  if (!mod.initDetail) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('r1');
  assert.match(elements['dm-ingredients'].innerHTML, /spaghetti/);
  assert.match(elements['dm-ingredients'].innerHTML, /eggs/);
});

test('open hides nutrition block when recipe has no nutrition', () => {
  if (!mod.initDetail) return;
  const { document, elements } = makeDom();
  const noNut = { ...SAMPLE, _id: 'r2', nutrition: null };
  const state = { recipes: [SAMPLE, noNut], pantry: [] };
  const ctrl = mod.initDetail({ state, document });
  ctrl.open('r2');
  assert.equal(elements['dm-nutrition'].style.display, 'none');
});

test('opening a recipe always starts the detail scroller at the top', () => {
  const { document, elements } = makeDom();
  elements.detailBody.scrollTop = 240;
  const state = { recipes: [SAMPLE], pantry: [] };
  mod.initDetail({ state, document }).open('r1');
  assert.equal(elements.detailBody.scrollTop, 0);
});
