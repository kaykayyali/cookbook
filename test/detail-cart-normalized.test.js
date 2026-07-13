import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { initDetail } = await import('../docs/js/controllers/detail.js');

function makeDom() {
  const ids = ['detail-modal','detail-overlay','dm-title','dm-eyebrow','dm-meta','dm-author-badge','dm-edit-btn','dm-schema-btn','dm-ingredients','dm-pantry-note','dm-steps','dm-nutrition','dm-nutrition-grid','dm-add-all-btn'];
  const elements = Object.fromEntries(ids.map((id) => [id, { textContent:'', innerHTML:'', style:{}, addEventListener(){}, classList:{ add(){}, remove(){}, contains(){ return false; } } }]));
  return { getElementById: (id) => elements[id] || null, body: { style: {} } };
}

test('detail add stores one recipe selection using validated remote normalization when available', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '4 servings', recipeIngredient: ['4 eggs'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: [] };
  let raw;
  let contextRecipe;
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: async (lines, recipeContext) => {
    raw = lines;
    contextRecipe = recipeContext;
    return [{ raw: '4 eggs', name: 'egg', quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.95 }];
  } });
  ctrl.open('r1');
  await ctrl._addToCart();
  assert.deepEqual(raw, ['4 eggs']);
  assert.equal(contextRecipe, recipe);
  assert.equal(state.cart.length, 1);
  assert.equal(state.cart[0].sourceServings, 4);
  assert.equal(state.cart[0].targetServings, 4);
});

test('detail add uses deterministic local fallback when normalization endpoint fails', async () => {
  const recipe = { _id: 'r1', name: 'Milk', recipeYield: '2', recipeIngredient: ['1 cup milk'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: ['milk'] };
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: async () => { throw new Error('offline'); } });
  ctrl.open('r1');
  await ctrl._addToCart();
  assert.equal(state.cart[0].ingredients[0].quantity, 8);
  assert.equal(state.cart[0].ingredients[0].unit, 'ounce');
  assert.deepEqual(state.pantry, ['milk']);
});

test('normalization cache survives removing a recipe from the cart', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '4 servings', recipeIngredient: ['4 eggs'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: [], normalizations: {} };
  let calls = 0;
  const ctrl = initDetail({
    state,
    document: makeDom(),
    notify() {},
    normalizeIngredients: async () => {
      calls += 1;
      return [{ raw: '4 eggs', name: 'egg', quantity: 4, unit: 'count', kind: 'indivisible', confidence: .95 }];
    },
  });
  ctrl.open('r1');
  await ctrl._addToCart();
  state.cart = [];
  await ctrl._addToCart();
  assert.equal(calls, 1);
  assert.equal(state.cart.length, 1);
});

test('detail add reuses a current normalization without another AI request', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '4 servings', recipeIngredient: ['4 eggs'], recipeInstructions: [] };
  const cached = {
    recipeId: 'r1', recipeName: 'Eggs', sourceServings: 4, targetServings: 2,
    normalizationVersion: 1,
    ingredients: [{ raw: '4 eggs', name: 'egg', quantity: 4, unit: 'count', kind: 'indivisible' }],
  };
  const state = { recipes: [recipe], cart: [cached], pantry: [] };
  let calls = 0;
  const ctrl = initDetail({
    state,
    document: makeDom(),
    notify() {},
    normalizeIngredients: async () => { calls += 1; throw new Error('should not run'); },
  });
  ctrl.open('r1');
  await ctrl._addToCart();
  assert.equal(calls, 0);
  assert.equal(state.cart[0].targetServings, 2);
});
