// test/controllers/recipes.test.js — recipe grid + card actions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod;
try {
  mod = await import('../../docs/js/controllers/recipes.js');
} catch (e) { mod = {}; }

// Minimal DOM stub: the grid container + a fake document with
// querySelector returning a single element, plus a click log.
function makeDom() {
  const grid = { innerHTML: '', children: [], addEventListener: () => {} };
  const count = { textContent: '' };
  const el = (sel) => {
    if (sel === 'recipe-grid') return grid;
    if (sel === 'recipe-count') return count;
    if (sel === 'pantry-suggestions') return { innerHTML: '' };
    return null;
  };
  const document = { getElementById: el };
  return { grid, count, document };
}

const SAMPLE_RECIPE = {
  _id: 'r1',
  name: 'Test Recipe',
  recipeCategory: 'Entree',
  recipeCuisine: 'Italian',
  recipeIngredient: ['salt', 'pepper'],
  recipeInstructions: ['step 1'],
  nutrition: { calories: '100 kcal' },
};

test('recipes.js exports initRecipes', () => {
  assert.equal(typeof mod.initRecipes, 'function');
});

test('initRecipes returns { render, openDetail }', () => {
  if (!mod.initRecipes) return;
  const { document } = makeDom();
  const state = { recipes: [SAMPLE_RECIPE], pantry: [], searchTerm: '', categoryFilter: '', eligibleOnly: false };
  const ctrl = mod.initRecipes({ state, document });
  assert.equal(typeof ctrl.render, 'function');
  assert.equal(typeof ctrl.openDetail, 'function');
});

test('render produces one card per recipe in state.recipes', () => {
  if (!mod.initRecipes) return;
  const { document, grid } = makeDom();
  const state = { recipes: [SAMPLE_RECIPE, { ...SAMPLE_RECIPE, _id: 'r2' }], pantry: [], searchTerm: '', categoryFilter: '', eligibleOnly: false };
  const ctrl = mod.initRecipes({ state, document });
  ctrl.render();
  // Count recipe-card occurrences — one per card.
  const cards = (grid.innerHTML.match(/recipe-card/g) || []).length;
  assert.ok(cards >= 2, `expected at least 2 cards, got ${cards}`);
});

test('render with empty recipes shows the empty state', () => {
  if (!mod.initRecipes) return;
  const { document, grid } = makeDom();
  const state = { recipes: [], pantry: [], searchTerm: '', categoryFilter: '', eligibleOnly: false };
  const ctrl = mod.initRecipes({ state, document });
  ctrl.render();
  assert.match(grid.innerHTML, /empty-state|Add your first/i, 'empty state should render');
});

test('render updates the recipe-count label', () => {
  if (!mod.initRecipes) return;
  const { document, count } = makeDom();
  const state = { recipes: [SAMPLE_RECIPE], pantry: [], searchTerm: '', categoryFilter: '', eligibleOnly: false };
  const ctrl = mod.initRecipes({ state, document });
  ctrl.render();
  assert.match(count.textContent, /1 recipe/, `expected "1 recipe" got "${count.textContent}"`);
});

test('openDetail(id) looks up the recipe and calls the onOpenDetail callback', () => {
  if (!mod.initRecipes) return;
  const { document } = makeDom();
  const state = { recipes: [SAMPLE_RECIPE], pantry: [] };
  let opened = null;
  const ctrl = mod.initRecipes({
    state,
    document,
    onOpenDetail: (id) => { opened = id; },
  });
  ctrl.openDetail('r1');
  assert.equal(opened, 'r1');
});

test('openDetail with unknown id is a no-op (no callback fired)', () => {
  if (!mod.initRecipes) return;
  const { document } = makeDom();
  const state = { recipes: [SAMPLE_RECIPE], pantry: [] };
  let opened = null;
  const ctrl = mod.initRecipes({ state, document, onOpenDetail: (id) => { opened = id; } });
  ctrl.openDetail('does-not-exist');
  assert.equal(opened, null);
});

test('cached offline mode blocks recipe deletion before confirmation or network write', async () => {
  const { document } = makeDom();
  let confirms = 0;
  let writes = 0;
  const state = { recipes: [SAMPLE_RECIPE], pantry: [], offlineCache: true };
  const ctrl = mod.initRecipes({
    state,
    document,
    confirmDelete: () => { confirms += 1; return true; },
    removeRecipe: async () => { writes += 1; return { ok: true }; },
    notify: () => {},
  });
  const result = await ctrl._delete('r1');
  assert.equal(result.ok, false);
  assert.match(result.error, /offline/i);
  assert.equal(confirms, 0);
  assert.equal(writes, 0);
});

test('durable recipe outbox allows confirmed deletion while offline', async () => {
  const { document } = makeDom();
  let writes = 0;
  const state = { recipes: [SAMPLE_RECIPE], pantry: [], offlineCache: true };
  const ctrl = mod.initRecipes({
    state, document, offlineMutations: true, confirmDelete: () => true,
    removeRecipe: async () => { writes += 1; return { ok: true }; }, notify: () => {},
  });
  const result = await ctrl._delete('r1');
  assert.equal(result.ok, true);
  assert.equal(writes, 1);
  assert.equal(state.recipes.length, 0);
});
