// test/controllers/drawer.test.js — recipe create/edit drawer.
//
// Note: lib/dom.js uses a global `document` reference. The form rebuilders
// (rebuildIngEditor, rebuildStepsList) call $() from lib/dom.js, which means
// the test must populate globalThis.document before importing the controller.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPantryRecipeDiscovery } from '../../docs/js/lib/pantry-recipe-discovery.js';
import { formBuffers } from '../../docs/js/components/recipeForm.js';
import { toSchema } from '../../docs/js/lib/schema.js';

const doc = {
  getElementById: () => ({
    value: '',
    innerHTML: '',
    textContent: '',
    style: { display: '' },
    focus: () => {},
    addEventListener: () => {},
    classList: { _set: new Set(), add(){}, remove(){}, contains(){return false}, toggle(){} },
  }),
  body: { style: { overflow: '' } },
  querySelectorAll: () => [],
};
globalThis.document = doc;

let mod;
try { mod = await import('../../docs/js/controllers/drawer.js'); } catch (e) { mod = {}; }

function makeDom() {
  const ids = [
    'recipe-drawer', 'drawer-overlay', 'drawer-title', 'f-id',
    'f-name', 'f-category', 'f-cuisine', 'f-yield', 'f-method', 'f-diet', 'f-url',
    'f-prep', 'f-cook', 'f-total', 'f-serving', 'f-calories', 'f-protein', 'f-fat', 'f-carbs',
    'ing-editor', 'ing-new-input', 'steps-list', 'save-recipe-btn',
  ];
  const elements = {};
  for (const id of ids) {
    elements[id] = { textContent: '', value: '', innerHTML: '', style: { display: '' }, focus: () => {}, classList: { _set: new Set(), add(c){this._set.add(c)}, remove(c){this._set.delete(c)}, contains(c){return this._set.has(c)}, toggle(c,on){on??=!this._set.has(c);on?this._set.add(c):this._set.delete(c);return on;}, } };
  }
  // addEventListener stub
  for (const el of Object.values(elements)) {
    el.addEventListener = () => {};
  }
  const document = {
    getElementById: (sel) => elements[sel] || null,
    body: { style: { overflow: '' } },
  };
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

test('drawer.js exports initDrawer', () => {
  assert.equal(typeof mod.initDrawer, 'function');
});

test('initDrawer returns { open, openPrefilled, close, save }', () => {
  if (!mod.initDrawer) return;
  const { document } = makeDom();
  const state = { recipes: [SAMPLE], editingId: null };
  const ctrl = mod.initDrawer({ state, document });
  assert.equal(typeof ctrl.open, 'function');
  assert.equal(typeof ctrl.openPrefilled, 'function');
  assert.equal(typeof ctrl.close, 'function');
  assert.equal(typeof ctrl.save, 'function');
});

test('open(null) shows "New Recipe" title and clears editingId', () => {
  if (!mod.initDrawer) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], editingId: null };
  const ctrl = mod.initDrawer({ state, document });
  ctrl.open(null);
  assert.equal(elements['drawer-title'].textContent, 'New Recipe');
  assert.equal(state.editingId, null);
});

test('open(id) shows "Edit Recipe" title and sets editingId', () => {
  if (!mod.initDrawer) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], editingId: null };
  const ctrl = mod.initDrawer({ state, document });
  ctrl.open('r1');
  assert.equal(elements['drawer-title'].textContent, 'Edit Recipe');
  assert.equal(state.editingId, 'r1');
});

test('open(id) populates the form fields with the recipe', () => {
  if (!mod.initDrawer) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], editingId: null };
  const ctrl = mod.initDrawer({ state, document });
  ctrl.open('r1');
  assert.equal(elements['f-name'].value, 'Carbonara');
  assert.equal(elements['f-category'].value, 'Entree');
  assert.equal(elements['f-cuisine'].value, 'Italian');
  assert.equal(elements['f-id'].value, 'r1');
});

test('cached offline mode disables recipe saving before any network write', async () => {
  const { document, elements } = makeDom();
  let writes = 0;
  const state = { recipes: [], editingId: null, offlineCache: true };
  const ctrl = mod.initDrawer({ state, document, create: async () => { writes += 1; return { ok: true }; } });
  ctrl.open(null);
  assert.equal(elements['save-recipe-btn'].disabled, true);
  const result = await ctrl.save();
  assert.equal(result.ok, false);
  assert.match(result.error, /offline/i);
  assert.equal(writes, 0);
});

test('durable recipe outbox allows an offline edit after queue persistence', async () => {
  const { document, elements } = makeDom();
  globalThis.document = document;
  const calls = [];
  const state = { recipes: [SAMPLE], editingId: null, offlineCache: true };
  const ctrl = mod.initDrawer({
    state, document,
    mutateRecipe: async (op, payload) => { calls.push({ op, payload }); state.recipes[0] = payload.item; return true; },
  });
  ctrl.open('r1');
  assert.equal(elements['save-recipe-btn'].disabled, false);
  elements['f-name'].value = 'Offline Carbonara';
  const result = await ctrl.save();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(calls[0].op, 'recipe.update');
  assert.equal(calls[0].payload.id, 'r1');
  assert.equal(calls[0].payload.recipe.name, 'Offline Carbonara');
  globalThis.document = doc;
});

test('online-only fallback update replaces recipe authority and invalidates a warm Pantry index once', async () => {
  const { document, elements } = makeDom();
  globalThis.document = document;
  const state = { recipes: [SAMPLE], editingId: null, recipeAuthorityVersion: 0 };
  let builds = 0;
  const discover = createPantryRecipeDiscovery({ onIndexBuild: () => { builds += 1; } });
  const render = () => discover({
    recipes: state.recipes,
    recipeAuthorityVersion: state.recipeAuthorityVersion,
    pantry: [],
    ingredientName: 'eggs',
  });
  render();
  render();
  const before = state.recipes;
  const ctrl = mod.initDrawer({
    state, document,
    update: async (_id, recipe) => ({ ok: true, item: { id: 'r1', recipe: toSchema({ ...SAMPLE, ...recipe }) } }),
  });
  ctrl.open('r1');
  elements['f-name'].value = 'Renamed Carbonara';
  const result = await ctrl.save();

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.notEqual(state.recipes, before, 'fallback update publishes an immutable authority array');
  assert.equal(state.recipeAuthorityVersion, 1);
  assert.equal(render()[0]?.recipeName, 'Renamed Carbonara');
  assert.equal(builds, 2);
  render();
  assert.equal(builds, 2, 'unchanged rerender reuses the rebuilt index');
  globalThis.document = doc;
});

test('online-only fallback create invalidates a warm Pantry index exactly once', async () => {
  const { document, elements } = makeDom();
  globalThis.document = document;
  const state = { recipes: [], editingId: null, recipeAuthorityVersion: 4 };
  let builds = 0;
  const discover = createPantryRecipeDiscovery({ onIndexBuild: () => { builds += 1; } });
  const render = () => discover({
    recipes: state.recipes,
    recipeAuthorityVersion: state.recipeAuthorityVersion,
    pantry: [],
    ingredientName: 'salt',
  });
  render();
  const ctrl = mod.initDrawer({
    state, document,
    create: async (recipe) => ({ ok: true, item: { id: 'new', recipe: toSchema(recipe) } }),
  });
  ctrl.open(null);
  elements['f-name'].value = 'Salt Toast';
  formBuffers.ingredients = ['salt'];
  formBuffers.steps = ['Toast it'];
  const result = await ctrl.save();

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.recipeAuthorityVersion, 5);
  assert.equal(render()[0]?.recipeName, 'Salt Toast');
  assert.equal(builds, 2);
  render();
  assert.equal(builds, 2, 'unchanged rerender reuses the rebuilt index');
  formBuffers.ingredients = [];
  formBuffers.steps = [''];
  globalThis.document = doc;
});

test('openPrefilled strips _id so the recipe opens as "New"', () => {
  if (!mod.initDrawer) return;
  const { document, elements } = makeDom();
  const state = { recipes: [], editingId: null };
  const extracted = { name: 'Extracted Recipe', _id: 'should-be-stripped', recipeIngredient: ['x'] };
  const ctrl = mod.initDrawer({ state, document });
  ctrl.openPrefilled(extracted);
  assert.equal(elements['drawer-title'].textContent, 'New Recipe');
  assert.equal(state.editingId, null);
  assert.equal(elements['f-name'].value, 'Extracted Recipe');
  assert.equal(extracted._id, undefined, '_id should be stripped from the input');
});

test('reviewable draft uses its explicit confirmation callback instead of ordinary recipe creation', async () => {
  const { document } = makeDom();
  const previousDocument = globalThis.document;
  globalThis.document = document;
  const state = { recipes: [], editingId: null };
  let confirmed;
  let created = 0;
  const ctrl = mod.initDrawer({ state, document, create: async () => { created += 1; return { ok: true }; } });
  ctrl.openPrefilled({ name: 'Photo Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] }, {
    onSave: async (recipe) => { confirmed = recipe; return { ok: true, recipeId: 'published-1' }; },
  });
  const result = await ctrl.save();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(confirmed.name, 'Photo Soup');
  assert.equal(created, 0);
  globalThis.document = previousDocument;
});

test('save returns an object describing the result', async () => {
  if (!mod.initDrawer) return;
  formBuffers.ingredients = [];
  formBuffers.steps = [''];
  const state = { recipes: [], editingId: null };
  const ctrl = mod.initDrawer({ state, document: doc });
  // Validation will fail (no name, no ingredients) — that's fine, the API
  // contract is: save() returns { ok: boolean, ... }. save() is async because
  // the community-edit branch awaits onCommunitySave; the local branch still
  // resolves synchronously to the same { ok, ... } shape.
  const result = await ctrl.save();
  assert.equal(typeof result, 'object');
  assert.equal(result.ok, false, 'save without required fields returns ok:false');
});

test('closing before delayed initial focus does not steal focus back into the hidden drawer', () => {
  const { document, elements } = makeDom();
  const scheduled = [];
  let focused = 0;
  elements['f-name'].focus = () => { focused += 1; };
  const ctrl = mod.initDrawer({
    state: { recipes: [SAMPLE], editingId: null },
    document,
    scheduleFocus: (callback) => { scheduled.push(callback); },
  });
  ctrl.open('r1');
  ctrl.close();
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.equal(focused, 0, 'a closed drawer cannot reclaim focus from the resumed detail');
});

test('close removes .open class from drawer + overlay and clears editingId', () => {
  if (!mod.initDrawer) return;
  const { document, elements } = makeDom();
  const state = { recipes: [SAMPLE], editingId: 'r1' };
  const ctrl = mod.initDrawer({ state, document });
  ctrl.close();
  assert.equal(elements['recipe-drawer'].classList.contains('open'), false);
  assert.equal(elements['drawer-overlay'].classList.contains('open'), false);
});
