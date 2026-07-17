import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (!globalThis.document) globalThis.document = { getElementById: () => null };
const { initDetail } = await import('../docs/js/controllers/detail.js');
const { initCart } = await import('../docs/js/controllers/cart.js');

function makeDom() {
  const ids = ['detail-modal','detail-overlay','dm-title','dm-eyebrow','dm-meta','dm-author-badge','dm-edit-btn','dm-schema-btn','dm-ingredients','dm-pantry-note','dm-steps','dm-nutrition','dm-nutrition-grid','dm-add-all-btn'];
  const elements = Object.fromEntries(ids.map((id) => [id, { textContent:'', innerHTML:'', style:{}, addEventListener(){}, classList:{ add(){}, remove(){}, contains(){ return false; } } }]));
  return { getElementById: (id) => elements[id] || null, body: { style: {} } };
}

const eggResult = (raw = '4 eggs') => ({ raw, name: 'egg', displayName: 'Eggs', countLabel: '', category: 'dairy-eggs', quantity: 4, unit: 'count', kind: 'indivisible', confidence: .95 });

test('detail add commits the selected recipe immediately and audits only it in the background', async () => {
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '4 servings', recipeIngredient: ['4 eggs'], recipeInstructions: [] };
  const soup = { _id: 'r0', name: 'Soup', recipeYield: '2 servings', recipeIngredient: ['1 cup milk'] };
  const soupSelection = { recipeId: 'r0', recipeName: 'Soup', sourceServings: 2, targetServings: 1, normalizationVersion: 2, ingredients: [{ raw: '1 cup milk', name: 'milk', displayName: 'Milk', countLabel: '', category: 'dairy-eggs', quantity: 8, unit: 'ounce', kind: 'divisible', confidence: .9 }] };
  const state = { recipes: [soup, recipe], cart: [soupSelection], pantry: [], normalizations: {} };
  let resolveAudit;
  const requests = [];
  const mutations = [];
  const ctrl = initDetail({ state, document: makeDom(), notify() {}, mutate: (op, payload) => mutations.push({ op, payload }), normalizeIngredients: (recipes) => {
    requests.push(recipes);
    return new Promise((resolve) => { resolveAudit = resolve; });
  } });
  ctrl.open('r1');
  const added = ctrl._addToCart();
  let addSettled = false;
  void added.then(() => { addSettled = true; });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(addSettled, true, 'the button must resolve before the remote audit');
  assert.equal(state.cart.length, 2, 'the selected recipe is immediately usable');
  assert.deepEqual(requests.map((request) => request.map(({ recipeId }) => recipeId)), [['r1']]);
  assert.deepEqual(mutations.map(({ op, payload }) => ({ op, recipeId: payload.selection.recipeId })), [
    { op: 'cart.upsertSelection', recipeId: 'r1' },
  ]);
  assert.equal(state.cart.find((item) => item.recipeId === 'r0').targetServings, 1, 'existing selections are untouched');

  resolveAudit([{ recipeId: 'r1', ingredients: [eggResult()] }]);
  await ctrl._waitForAudits();
  assert.deepEqual(mutations.map(({ payload }) => payload.selection.recipeId), ['r1', 'r1']);
});

test('the visible Add to cart button responds immediately and changes to In cart', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body>
    <div id="detail-modal"></div><div id="detail-overlay"></div><button id="detail-close-btn"></button>
    <div id="dm-eyebrow"></div><div id="dm-title"></div><div id="dm-meta"></div><div id="dm-author-badge"></div>
    <button id="dm-edit-btn"></button><button id="dm-schema-btn"></button><div id="dm-ingredients"></div>
    <div id="dm-pantry-note"></div><div id="dm-steps"></div><div id="dm-nutrition"><div id="dm-nutrition-grid"></div></div>
    <button id="dm-add-all-btn">Add recipe to cart</button>
  </body>`);
  const recipe = { _id: 'r1', name: 'Eggs', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: [], normalizations: {} };
  let resolveAudit;
  const notices = [];
  const ctrl = initDetail({
    state, document: dom.window.document, notify: (message) => notices.push(message),
    normalizeIngredients: () => new Promise((resolve) => { resolveAudit = resolve; }),
  });
  ctrl.open('r1');
  const button = dom.window.document.querySelector('#dm-pantry-note [data-action="add-missing"]');
  assert.ok(button, 'the pantry summary exposes the exact button the user clicked');
  button.click();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(state.cart.length, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'In cart');
  assert.equal(dom.window.document.getElementById('dm-add-all-btn').disabled, true);
  assert.deepEqual(notices, ['Added “Eggs” to shopping list']);

  resolveAudit([{ recipeId: 'r1', ingredients: [eggResult('1 egg')] }]);
  await ctrl._waitForAudits();
});

test('recipe-detail Pantry toggle preserves the ingredient quantity in its workspace mutation', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body>
    <div id="detail-modal"></div><div id="detail-overlay"></div><button id="detail-close-btn"></button>
    <div id="dm-eyebrow"></div><div id="dm-title"></div><div id="dm-meta"></div><div id="dm-author-badge"></div>
    <button id="dm-edit-btn"></button><button id="dm-schema-btn"></button><div id="dm-ingredients"></div>
    <div id="dm-pantry-note"></div><div id="dm-steps"></div><div id="dm-nutrition"><div id="dm-nutrition-grid"></div></div>
    <button id="dm-add-all-btn">Add recipe to cart</button>
  </body>`);
  const recipe = { _id: 'r1', name: 'Dressing', recipeYield: '1', recipeIngredient: ['2 tablespoons olive oil'], recipeInstructions: [] };
  const state = { recipes: [recipe], cart: [], pantry: [], normalizations: {} };
  const mutations = [];
  const ctrl = initDetail({ state, document: dom.window.document, notify() {}, mutate: (op, payload) => mutations.push({ op, payload }) });
  ctrl.open('r1');
  dom.window.document.querySelector('.detail-ing-item').click();
  assert.equal(state.pantry[0].quantity, 1);
  assert.deepEqual(mutations, [{ op: 'pantry.add', payload: { item: state.pantry[0] } }]);
});

test('recipe-detail Pantry removal syncs the matched stored stable ID', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body>
    <div id="detail-modal"></div><div id="detail-overlay"></div><button id="detail-close-btn"></button>
    <div id="dm-eyebrow"></div><div id="dm-title"></div><div id="dm-meta"></div><div id="dm-author-badge"></div>
    <button id="dm-edit-btn"></button><button id="dm-schema-btn"></button><div id="dm-ingredients"></div>
    <div id="dm-pantry-note"></div><div id="dm-steps"></div><div id="dm-nutrition"><div id="dm-nutrition-grid"></div></div>
    <button id="dm-add-all-btn">Add recipe to cart</button>
  </body>`);
  const recipe = { _id: 'r1', name: 'Water', recipeYield: '1', recipeIngredient: ['1 bottle water'], recipeInstructions: [] };
  const state = {
    recipes: [recipe], cart: [], normalizations: {},
    pantry: [
      {
        id: 'cart-water-bottles', name: 'water', displayName: 'Water', raw: '2 bottles water',
        quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', category: 'pantry',
      },
      {
        id: 'manual-water-cans', name: 'water', displayName: 'Water', raw: '3 cans water',
        quantity: 3, unit: 'count', kind: 'indivisible', countLabel: 'can', category: 'pantry',
      },
    ],
  };
  const mutations = [];
  const ctrl = initDetail({ state, document: dom.window.document, notify() {}, mutate: (op, payload) => mutations.push({ op, payload }) });
  ctrl.open('r1');

  dom.window.document.querySelector('.detail-ing-item').click();

  assert.deepEqual(state.pantry.map((item) => item.id), ['manual-water-cans']);
  assert.deepEqual(mutations, [{ op: 'pantry.remove', payload: { id: 'cart-water-bottles' } }]);
});

test('background audit failure keeps the immediate deterministic selection', async () => {
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

test('concurrent recipe additions audit each recipe independently without rewriting existing selections', async () => {
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
  await ctrl._waitForAudits();
  assert.deepEqual(requests, [['r1'], ['r2']]);
  assert.deepEqual(state.cart.map((recipe) => recipe.recipeId).sort(), ['r1', 'r2']);
});

test('adding one recipe cannot mark an unrelated stale selection as audited', async () => {
  const staleMilk = { raw: '1 cup milk', name: 'milk', displayName: 'Milk', countLabel: '', category: 'dairy-eggs', quantity: 8, unit: 'ounce', kind: 'divisible', confidence: .9 };
  const currentMilk = { raw: '2 cups milk', name: 'milk', displayName: 'Milk', countLabel: '', category: 'dairy-eggs', quantity: 16, unit: 'ounce', kind: 'divisible', confidence: .9 };
  const milkRecipe = { _id: 'r0', name: 'Milk', recipeYield: '1', recipeIngredient: ['2 cups milk'], recipeInstructions: [] };
  const eggRecipe = { _id: 'r1', name: 'Eggs', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] };
  const state = {
    recipes: [milkRecipe, eggRecipe], pantry: [],
    cart: [{ recipeId: 'r0', recipeName: 'Milk', sourceServings: 1, targetServings: 1, normalizationVersion: 2, ingredients: [staleMilk] }],
    normalizations: { r0: { version: 2, raw: ['1 cup milk'], ingredients: [staleMilk] } },
  };
  const detail = initDetail({
    state, document: makeDom(), notify() {},
    normalizeIngredients: async () => [{ recipeId: 'r1', ingredients: [eggResult('1 egg')] }],
  });
  detail.open('r1');
  await detail._addToCart();
  await detail._waitForAudits();

  let refreshCalls = 0;
  const cart = initCart({
    state, document: { getElementById: () => null },
    normalizeIngredients: async () => {
      refreshCalls += 1;
      return [
        { recipeId: 'r0', ingredients: [currentMilk] },
        { recipeId: 'r1', ingredients: [eggResult('1 egg')] },
      ];
    },
  });
  assert.equal(await cart._refreshNormalization(), true, 'the unrelated stale recipe must still require refresh');
  assert.equal(refreshCalls, 1);
  assert.equal(state.cart.find((selection) => selection.recipeId === 'r0').ingredients[0].raw, '2 cups milk');
});

test('an audit for old ingredient lines cannot mark an edited recipe as current', async () => {
  const original = { _id: 'r1', name: 'Eggs', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] };
  const state = { recipes: [original], cart: [], pantry: [], normalizations: {} };
  let resolveOldAudit;
  const detail = initDetail({
    state, document: makeDom(), notify() {},
    normalizeIngredients: () => new Promise((resolve) => { resolveOldAudit = resolve; }),
  });
  detail.open('r1');
  await detail._addToCart();

  state.recipes[0] = { ...original, recipeIngredient: ['2 cups flour'] };
  resolveOldAudit([{ recipeId: 'r1', ingredients: [eggResult('1 egg')] }]);
  await detail._waitForAudits();

  let refreshCalls = 0;
  const flour = { raw: '2 cups flour', name: 'flour', displayName: 'Flour', countLabel: '', category: 'pantry', quantity: 16, unit: 'ounce', kind: 'divisible', confidence: .95 };
  const cart = initCart({
    state, document: { getElementById: () => null },
    normalizeIngredients: async () => { refreshCalls += 1; return [{ recipeId: 'r1', ingredients: [flour] }]; },
  });
  assert.equal(await cart._refreshNormalization(), true, 'the edited recipe must remain detectably stale');
  assert.equal(refreshCalls, 1);
  assert.equal(state.cart[0].ingredients[0].raw, '2 cups flour');
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

test('clear prevents every in-flight per-recipe audit from resurrecting removed selections', async () => {
  const recipes = [
    { _id: 'r1', name: 'One', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] },
    { _id: 'r2', name: 'Two', recipeYield: '1', recipeIngredient: ['1 egg'], recipeInstructions: [] },
  ];
  const state = { recipes, cart: [], pantry: [], normalizations: {} };
  const audits = [];
  const detail = initDetail({ state, document: makeDom(), notify() {}, normalizeIngredients: (request) => new Promise((resolve) => { audits.push({ request, resolve }); }) });
  const cart = initCart({ state, document: { getElementById: () => null } });
  detail.open('r1');
  const first = detail._addToCart();
  detail.open('r2');
  const second = detail._addToCart();
  await Promise.all([first, second]);
  assert.equal(audits.length, 2);
  assert.deepEqual(state.cart.map((selection) => selection.recipeId).sort(), ['r1', 'r2']);

  cart.clear();
  for (const audit of audits) audit.resolve([{ recipeId: audit.request[0].recipeId, ingredients: [eggResult('1 egg')] }]);
  await detail._waitForAudits();
  assert.deepEqual(state.cart, []);
});
