import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { initDetail } = await import('../docs/js/controllers/detail.js');
const { initCart } = await import('../docs/js/controllers/cart.js');

function makeDom() {
  const ids = ['detail-modal','detail-overlay','dm-title','dm-eyebrow','dm-meta','dm-author-badge','dm-edit-btn','dm-schema-btn','dm-ingredients','dm-pantry-note','dm-steps','dm-nutrition','dm-nutrition-grid','dm-add-all-btn'];
  const elements = Object.fromEntries(ids.map((id) => [id, { textContent:'', innerHTML:'', style:{}, addEventListener(){}, classList:{ add(){}, remove(){}, contains(){ return false; } } }]));
  return { getElementById: (id) => elements[id] || null, body: { style: {} } };
}

const eggResult = (raw = '4 eggs') => ({ raw, name: 'egg', displayName: 'Eggs', countLabel: '', category: 'dairy-eggs', quantity: 4, unit: 'count', kind: 'indivisible', confidence: .95 });

test('detail add audits the complete changed recipe set in one request and maps results back', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '4 servings', recipeIngredient: ['4 eggs'], recipeInstructions: [] };
  const soup = { _id: 'r0', name: 'Soup', recipeYield: '2 servings', recipeIngredient: ['1 cup milk'] };
  const state = { recipes: [soup, recipe], cart: [{ recipeId: 'r0', recipeName: 'Soup', sourceServings: 2, targetServings: 1, normalizationVersion: 2, ingredients: [{ raw: '1 cup milk', name: 'milk', displayName: 'Milk', countLabel: '', category: 'dairy-eggs', quantity: 8, unit: 'ounce', kind: 'divisible', confidence: .9 }] }], pantry: [], normalizations: {} };
  let request;
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: async (recipes) => {
    request = recipes;
    return recipes.map((entry) => ({ recipeId: entry.recipeId, ingredients: entry.ingredients.map((raw) => raw.includes('milk')
      ? { raw, name: 'milk', displayName: 'Milk', countLabel: '', category: 'dairy-eggs', quantity: 8, unit: 'ounce', kind: 'divisible', confidence: .9 }
      : eggResult(raw)) }));
  } });
  ctrl.open('r1');
  await ctrl._addToCart();
  assert.deepEqual(request.map(({ recipeId, recipeName, ingredients }) => ({ recipeId, recipeName, ingredients })), [
    { recipeId: 'r0', recipeName: 'Soup', ingredients: ['1 cup milk'] },
    { recipeId: 'r1', recipeName: 'Eggs', ingredients: ['4 eggs'] },
  ]);
  assert.equal(state.cart.length, 2);
  assert.equal(state.cart.find((x) => x.recipeId === 'r0').targetServings, 1);
  assert.equal(state.normalizations.r0.version, 2);
  assert.equal(state.normalizations.r1.version, 2);
});

test('whole-set failure uses deterministic local fallback without cart loss', async () => {
  const recipe = { _id: 'r1', name: 'Milk', recipeYield: '2', recipeIngredient: ['1 cup milk'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: ['milk'] };
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: async () => { throw new Error('offline'); } });
  ctrl.open('r1');
  await ctrl._addToCart();
  assert.equal(state.cart[0].ingredients[0].quantity, 8);
  assert.equal(state.cart[0].normalizationVersion, 2);
  assert.deepEqual(state.pantry, ['milk']);
});

test('unchanged audited set reuses per-recipe v2 caches without another AI request', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '4 servings', recipeIngredient: ['4 eggs'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: [], normalizations: {} };
  let calls = 0;
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: async (recipes) => {
    calls += 1;
    return [{ recipeId: 'r1', ingredients: [eggResult(recipes[0].ingredients[0])] }];
  } });
  ctrl.open('r1');
  await ctrl._addToCart();
  await ctrl._addToCart();
  assert.equal(calls, 1);
  assert.equal(state.cart.length, 1);
});

test('v1 active normalization is invalidated and reprocessed by v2', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '4 servings', recipeIngredient: ['4 eggs'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [{ recipeId: 'r1', recipeName: 'Eggs', sourceServings: 4, targetServings: 2, normalizationVersion: 1, ingredients: [{ raw: '4 eggs', name: 'egg', quantity: 4, unit: 'count', kind: 'indivisible' }] }], pantry: [], normalizations: { r1: { version: 1, raw: ['4 eggs'], ingredients: [eggResult()] } } };
  let calls = 0;
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: async () => { calls += 1; return [{ recipeId: 'r1', ingredients: [eggResult()] }]; } });
  ctrl.open('r1');
  await ctrl._addToCart();
  assert.equal(calls, 1);
  assert.equal(state.cart[0].targetServings, 2);
  assert.equal(state.cart[0].normalizationVersion, 2);
});

test('concurrent recipe additions are serialized so the second whole-list review includes the first', async () => {
  const first = { _id: 'r1', name: 'First', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] };
  const second = { _id: 'r2', name: 'Second', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] };
  const state = { recipes: [first, second], cart: [], pantry: [], normalizations: {} };
  const requests = [];
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: async (recipes) => {
    requests.push(recipes.map((recipe) => recipe.recipeId));
    return recipes.map((recipe) => ({ recipeId: recipe.recipeId, ingredients: [eggResult(recipe.ingredients[0])] }));
  } });
  ctrl.open('r1');
  const one = ctrl._addToCart();
  ctrl.open('r2');
  const two = ctrl._addToCart();
  await Promise.all([one, two]);
  assert.deepEqual(requests, [['r1'], ['r1', 'r2']]);
  assert.deepEqual(state.cart.map((recipe) => recipe.recipeId).sort(), ['r1', 'r2']);
});

test('clearing while a detail normalization is in flight cancels the pending recipe addition', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: [], normalizations: {} };
  let resolve;
  const detail = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: () => new Promise((done) => { resolve = done; }) });
  const cart = initCart({ state, document: { getElementById: () => null } });
  detail.open('r1');
  const pending = detail._addToCart();
  await Promise.resolve();
  cart.clear();
  resolve([{ recipeId: 'r1', ingredients: [eggResult('1 egg')] }]);
  await pending;
  assert.deepEqual(state.cart, []);
});

test('clear cancels every recipe addition that was already waiting in the detail queue', async () => {
  const recipes = [
    { _id: 'r1', name: 'One', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] },
    { _id: 'r2', name: 'Two', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] },
  ];
  const state = { recipes, cart: [], pantry: [], normalizations: {} };
  let resolve;
  let requests = 0;
  const detail = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: () => {
    requests += 1;
    return new Promise((done) => { resolve = done; });
  } });
  const cart = initCart({ state, document: { getElementById: () => null } });
  detail.open('r1');
  const first = detail._addToCart();
  detail.open('r2');
  const second = detail._addToCart();
  await Promise.resolve();
  cart.clear();
  resolve([{ recipeId: 'r1', ingredients: [eggResult('1 egg')] }]);
  await Promise.all([first, second]);
  assert.equal(requests, 1, 'the pre-clear queued request must never start');
  assert.deepEqual(state.cart, []);
});
