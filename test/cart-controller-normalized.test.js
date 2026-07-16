import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (!globalThis.document) globalThis.document = { getElementById: () => null };
const { initCart } = await import('../docs/js/controllers/cart.js');

function dom() {
  const listeners = {};
  const grid = { innerHTML: '', addEventListener: (type, fn) => { listeners[type] = fn; } };
  const clear = { addEventListener() {} };
  return { grid, listeners, document: { getElementById: (id) => id === 'cart-grid' ? grid : id === 'cart-clear-btn' ? clear : null } };
}

const selection = { recipeId: 'r1', recipeName: 'Soup', sourceServings: 4, targetServings: 4, ingredients: [] };

test('delegated serving and item-removal controls dispatch through the grid', () => {
  const { document, listeners } = dom();
  const state = { cart: [{ ...selection, ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' }] }], pantry: [] };
  initCart({ state, document });
  listeners.click({ target: { closest: () => ({ dataset: { action: 'servings-up', recipeId: 'r1' } }) } });
  assert.equal(state.cart[0].targetServings, 5);
  listeners.click({ target: { closest: () => ({ dataset: { action: 'remove-item', name: 'egg' } }) } });
  assert.deepEqual(state.cart[0].ingredients, []);
});

test('cart controller adjusts target servings and persists through its public API', () => {
  const { document } = dom();
  const state = { cart: [selection], pantry: [] };
  const ctrl = initCart({ state, document });
  assert.equal(typeof ctrl.changeServings, 'function');
  ctrl.changeServings('r1', -1);
  assert.equal(state.cart[0].targetServings, 3);
  ctrl.changeServings('r1', 1);
  assert.equal(state.cart[0].targetServings, 4);
});

test('cart controller removes an individual aggregate shopping item', () => {
  const { document } = dom();
  const state = { cart: [{ ...selection, ingredients: [
    { raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' },
    { raw: '1 cup milk', name: 'milk', quantity: 8, unit: 'ounce', kind: 'divisible' },
  ] }], pantry: [] };
  const ctrl = initCart({ state, document });
  assert.equal(ctrl.removeItem('egg'), true);
  assert.deepEqual(state.cart[0].ingredients.map((item) => item.name), ['milk']);
});

test('cart controller removes a selected recipe rather than ingredient contributions', () => {
  const { document } = dom();
  const state = { cart: [selection], pantry: ['salt'] };
  const ctrl = initCart({ state, document });
  assert.equal(ctrl.removeRecipe('r1'), true);
  assert.deepEqual(state.cart, []);
  assert.deepEqual(state.pantry, ['salt'], 'pantry remains informational');
});

test('delegated check-off saves the normalized purchase quantity to Pantry', () => {
  const { document, listeners } = dom();
  const state = { cart: [{ ...selection, ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' }] }], pantry: [], shoppingChecked: {} };
  initCart({ state, document });
  const click = () => listeners.click({ target: { closest: () => ({ dataset: { action: 'toggle-item', name: 'egg' } }) } });
  click();
  assert.equal(state.shoppingChecked.egg, true);
  assert.deepEqual(state.pantry, [{
    name: 'egg', displayName: 'Egg', quantity: 3, unit: 'count', kind: 'indivisible',
    countLabel: '', category: 'dairy-eggs',
  }], 'checking a cart item transfers its buffered purchase quantity');
  click();
  assert.equal(state.shoppingChecked.egg, undefined);
  assert.equal(state.pantry[0].quantity, 3, 'unchecking keeps the pantry quantity (non-subtractive)');
  click();
  assert.equal(state.shoppingChecked.egg, true);
  assert.equal(state.pantry[0].quantity, 3, 'rechecking the same Shopping row does not transfer it twice');
});

test('manual Shopping items use the same quantity contract and transfer it to Pantry', () => {
  const { document } = dom();
  const state = { cart: [], pantry: [], shoppingChecked: {}, manualItems: [] };
  const ctrl = initCart({ state, document });
  const manual = ctrl.addManual('2 bottles flowers');
  assert.equal(manual.quantity, 2);
  assert.equal(manual.unit, 'count');
  assert.equal(manual.countLabel, 'bottle');
  ctrl.toggleManual(manual.id);
  assert.equal(state.shoppingChecked['manual:' + manual.id], true);
  assert.deepEqual(state.pantry.map(({ name, quantity, unit, countLabel }) => ({ name, quantity, unit, countLabel })), [
    { name: 'flower', quantity: 2, unit: 'count', countLabel: 'bottle' },
  ]);
  ctrl.toggleManual(manual.id);
  ctrl.toggleManual(manual.id);
  assert.equal(state.pantry[0].quantity, 2, 'restoring and rechecking one manual row does not transfer it twice');
});

test('delegated check-off plays a short exit animation before moving the row to Completed', () => {
  const { document, listeners } = dom();
  const state = { cart: [{ ...selection, ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' }] }], pantry: [], shoppingChecked: {} };
  let scheduled;
  const classes = new Set();
  const check = { textContent: '', setAttribute(name, value) { this[name] = value; } };
  const row = {
    dataset: {},
    classList: { add: (name) => classes.add(name) },
    querySelector: () => check,
  };
  const action = { dataset: { action: 'toggle-item', name: 'egg' }, closest: () => row };
  initCart({
    state,
    document,
    prefersReducedMotion: () => false,
    schedule: (fn, delay) => { scheduled = { fn, delay }; },
  });
  listeners.click({ target: { closest: () => action } });
  assert.equal(state.shoppingChecked.egg, undefined, 'state waits until the exit motion finishes');
  assert.equal(classes.has('is-completing'), true);
  assert.equal(check.textContent, '✓');
  assert.equal(check['aria-pressed'], 'true');
  assert.ok(scheduled.delay >= 200 && scheduled.delay <= 350);
  scheduled.fn();
  assert.equal(state.shoppingChecked.egg, true);
});

test('opening Shopping automatically upgrades a stale active cart with a whole-list review', async () => {
  const { document } = dom();
  const state = {
    recipesLoaded: true,
    recipes: [{ _id: 'r1', name: 'Garlic', recipeYield: '2', recipeIngredient: ['3 cloves garlic'] }],
    cart: [{ recipeId: 'r1', recipeName: 'Garlic', sourceServings: 2, targetServings: 2, normalizationVersion: 1,
      ingredients: [{ raw: '3 cloves garlic', name: 'garlic', quantity: 3, unit: 'count', kind: 'indivisible' }] }],
    pantry: [], shoppingChecked: {}, normalizations: {}, normalizationAudit: {},
  };
  let calls = 0;
  const ctrl = initCart({ state, document, normalizeIngredients: async (recipes) => {
    calls += 1;
    return [{ recipeId: 'r1', ingredients: [{ raw: recipes[0].ingredients[0], name: 'garlic', displayName: 'Garlic', countLabel: 'clove', category: 'produce', quantity: 3, unit: 'count', kind: 'indivisible', confidence: .98 }] }];
  } });
  await ctrl._refreshNormalization();
  assert.equal(calls, 1);
  assert.equal(state.cart[0].normalizationVersion, 2);
  assert.equal(state.cart[0].ingredients[0].countLabel, 'clove');
});

test('clear during an in-flight normalization cannot resurrect the cart', async () => {
  const { document } = dom();
  let resolve;
  const state = {
    recipesLoaded: true,
    recipes: [{ _id: 'r1', name: 'Eggs', recipeYield: '2', recipeIngredient: ['2 eggs'] }],
    cart: [{ recipeId: 'r1', recipeName: 'Eggs', sourceServings: 2, targetServings: 2, normalizationVersion: 1,
      ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' }] }],
    pantry: [], shoppingChecked: {}, normalizations: {}, normalizationAudit: {},
  };
  const ctrl = initCart({ state, document, normalizeIngredients: () => new Promise((done) => { resolve = done; }) });
  const pending = ctrl._refreshNormalization();
  ctrl.clear();
  resolve([{ recipeId: 'r1', ingredients: [{ raw: '2 eggs', name: 'egg', displayName: 'Eggs', countLabel: '', category: 'dairy-eggs', quantity: 2, unit: 'count', kind: 'indivisible', confidence: .95 }] }]);
  await pending;
  assert.deepEqual(state.cart, []);
});

test('item removal during an in-flight normalization is not undone by a stale response', async () => {
  const { document } = dom();
  let resolve;
  const state = {
    recipesLoaded: true,
    recipes: [{ _id: 'r1', name: 'Eggs', recipeYield: '2', recipeIngredient: ['2 eggs'] }],
    cart: [{ recipeId: 'r1', recipeName: 'Eggs', sourceServings: 2, targetServings: 2, normalizationVersion: 1,
      ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' }] }],
    pantry: [], shoppingChecked: {}, normalizations: {}, normalizationAudit: {},
  };
  const ctrl = initCart({ state, document, normalizeIngredients: () => new Promise((done) => { resolve = done; }) });
  const pending = ctrl._refreshNormalization();
  ctrl.removeItem('egg');
  resolve([{ recipeId: 'r1', ingredients: [{ raw: '2 eggs', name: 'egg', displayName: 'Eggs', countLabel: '', category: 'dairy-eggs', quantity: 2, unit: 'count', kind: 'indivisible', confidence: .95 }] }]);
  await pending;
  assert.deepEqual(state.cart[0].ingredients, []);
});

test('recipe removal invalidates whole-set audit but serving changes do not', () => {
  const { document } = dom();
  const state = { cart: [selection], pantry: [], normalizationAudit: { signature: 'audited' } };
  const ctrl = initCart({ state, document });
  ctrl.changeServings('r1', 1);
  assert.equal(state.normalizationAudit.signature, 'audited');
  ctrl.removeRecipe('r1');
  assert.deepEqual(state.normalizationAudit, {});
});
