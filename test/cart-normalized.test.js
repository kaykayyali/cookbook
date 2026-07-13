import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseServings,
  normalizeIngredient,
  normalizeIngredientsLocal,
  addRecipeSelection,
  setTargetServings,
  aggregateCart,
  removeShoppingItem,
  formatCanonicalAmount,
  normalizeCart,
} from '../docs/js/lib/cart.js';

test('parseServings reads recipeYield text and falls back safely', () => {
  assert.equal(parseServings('Makes 6 servings'), 6);
  assert.equal(parseServings(['4 portions']), 4);
  assert.equal(parseServings(''), 1);
});

test('local normalization converts cooking units to canonical units and preserves raw text', () => {
  assert.deepEqual(normalizeIngredient('1 cup olive oil'), {
    raw: '1 cup olive oil', name: 'olive oil', quantity: 8, unit: 'ounce', kind: 'divisible', confidence: 0.9,
  });
  assert.deepEqual(normalizeIngredient('1 dozen large eggs'), {
    raw: '1 dozen large eggs', name: 'egg', quantity: 12, unit: 'count', kind: 'indivisible', confidence: 0.85,
  });
  assert.deepEqual(normalizeIngredient('salt to taste'), {
    raw: 'salt to taste', name: 'salt', quantity: null, unit: 'qualitative', kind: 'qualitative', confidence: 0.4,
  });
});

test('local normalization implements the approved water-equivalent conversion table', () => {
  const cases = [
    ['1 ml water', 0.035274], ['1 g water', 0.035274], ['1 fl oz water', 1],
    ['1 tbsp water', 0.5], ['1 tsp water', 1 / 6], ['1 lb water', 16], ['1 kg water', 35.274],
  ];
  for (const [raw, expected] of cases) {
    assert.ok(Math.abs(normalizeIngredient(raw).quantity - expected) < 1e-9, raw);
    assert.equal(normalizeIngredient(raw).unit, 'ounce');
  }
});

test('local normalization handles ranges, cloves, and package weights conservatively', () => {
  for (const raw of ['1-2 cups milk', '1 1/2-2 cups milk']) {
    assert.deepEqual(normalizeIngredient(raw), {
      raw, name: 'milk', quantity: 16, unit: 'ounce', kind: 'divisible', confidence: 0.8,
    });
  }
  assert.equal(normalizeIngredient('1/2-1 cup milk').quantity, 8);
  assert.equal(normalizeIngredient('1 clove garlic').name, 'garlic');
  assert.equal(normalizeIngredient('2 cloves garlic').name, 'garlic');
  for (const [raw, quantity] of [
    ['1 (14 ounce) can tomatoes', 14],
    ['2 14-ounce cans tomatoes', 28],
    ['1 (28-oz) can whole peeled tomatoes', 28],
  ]) {
    assert.deepEqual(normalizeIngredient(raw), {
      raw, name: 'tomato', quantity, unit: 'ounce', kind: 'divisible', confidence: 0.75,
    });
  }
});

test('selection stores source and target servings with canonical ingredients', () => {
  const recipe = { _id: 'r1', name: 'Cake', recipeYield: '8 slices', recipeIngredient: ['2 cups flour'] };
  const cart = addRecipeSelection([], recipe, normalizeIngredientsLocal(recipe.recipeIngredient));
  assert.equal(cart[0].sourceServings, 8);
  assert.equal(cart[0].targetServings, 8);
  assert.equal(cart[0].normalizationVersion, 1);
  assert.equal(cart[0].ingredients[0].unit, 'ounce');
  assert.equal(cart[0].ingredients[0].raw, '2 cups flour');
});

test('re-adding a normalized recipe preserves its selected serving amount', () => {
  const recipe = { _id: 'r1', name: 'Cake', recipeYield: '8 slices', recipeIngredient: ['2 cups flour'] };
  let cart = addRecipeSelection([], recipe, normalizeIngredientsLocal(recipe.recipeIngredient));
  cart = setTargetServings(cart, 'r1', 3);
  cart = addRecipeSelection(cart, recipe, cart[0].ingredients);
  assert.equal(cart[0].targetServings, 3);
  assert.equal(cart[0].normalizationVersion, 1);
});

test('removing one aggregate item keeps selected recipes and other ingredients', () => {
  const cart = [{ recipeId: 'a', recipeName: 'A', sourceServings: 1, targetServings: 1, ingredients: [
    { raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible' },
    { raw: '1 cup milk', name: 'milk', quantity: 8, unit: 'ounce', kind: 'divisible' },
  ] }];
  const next = removeShoppingItem(cart, 'egg');
  assert.equal(next.length, 1);
  assert.deepEqual(next[0].ingredients.map((item) => item.name), ['milk']);
});

test('serving changes scale and merge canonical names before applying one safety buffer', () => {
  const a = { _id: 'a', name: 'A', recipeYield: '4 servings', recipeIngredient: ['1 dozen eggs'] };
  const b = { _id: 'b', name: 'B', recipeYield: '2 servings', recipeIngredient: ['2 eggs'] };
  let cart = addRecipeSelection([], a, normalizeIngredientsLocal(a.recipeIngredient));
  cart = addRecipeSelection(cart, b, normalizeIngredientsLocal(b.recipeIngredient));
  cart = setTargetServings(cart, 'a', 2);
  cart = setTargetServings(cart, 'b', 2);
  const [eggs] = aggregateCart(cart);
  assert.equal(eggs.name, 'egg');
  assert.equal(eggs.quantity, 8, 'deterministic scaling and aggregation happens before buffer');
  assert.equal(eggs.purchaseQuantity, 9, '10% buffer then indivisible whole-count rounding');
});

test('divisible amounts receive exactly one 10% buffer after aggregation', () => {
  const cart = [
    { recipeId: 'a', sourceServings: 2, targetServings: 1, ingredients: [{ raw: '8 oz milk', name: 'milk', quantity: 8, unit: 'ounce', kind: 'divisible' }] },
    { recipeId: 'b', sourceServings: 1, targetServings: 1, ingredients: [{ raw: '4 oz milk', name: 'milk', quantity: 4, unit: 'ounce', kind: 'divisible' }] },
  ];
  const [milk] = aggregateCart(cart);
  assert.equal(milk.quantity, 8);
  assert.ok(Math.abs(milk.purchaseQuantity - 8.8) < 1e-9);
});

test('qualitative ingredients remain uncertain and preserve every source line', () => {
  const cart = [{ recipeId: 'a', sourceServings: 1, targetServings: 1, ingredients: [
    { raw: 'salt to taste', name: 'salt', quantity: null, unit: 'qualitative', kind: 'qualitative' },
    { raw: 'a pinch of salt', name: 'salt', quantity: null, unit: 'qualitative', kind: 'qualitative' },
  ] }];
  const [salt] = aggregateCart(cart);
  assert.equal(salt.unit, 'qualitative');
  assert.deepEqual(salt.raw, ['salt to taste', 'a pinch of salt']);
});

test('quantified and qualitative contributions share one concise canonical line', () => {
  const cart = [{ recipeId: 'a', sourceServings: 1, targetServings: 1, ingredients: [
    { raw: '1 tsp salt', name: 'salt', quantity: 1 / 6, unit: 'ounce', kind: 'divisible', confidence: 0.9 },
    { raw: 'salt to taste', name: 'salt', quantity: null, unit: 'qualitative', kind: 'qualitative', confidence: 0.4 },
  ] }];
  const rows = aggregateCart(cart);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'salt');
  assert.equal(rows[0].uncertain, true);
  assert.deepEqual(rows[0].raw, ['1 tsp salt', 'salt to taste']);
});

test('tiny positive amounts survive normalization, aggregation, buffering, and display', () => {
  assert.equal(formatCanonicalAmount(0.0044, 'ounce'), '0.0044 oz');
  assert.equal(formatCanonicalAmount(0.0132, 'ounce'), '0.0132 oz');
  const ingredient = normalizeIngredient('0.000000001 g spice');
  assert.ok(ingredient.quantity > 0);
  const [row] = aggregateCart([{
    recipeId: 'tiny', sourceServings: 1, targetServings: 1, ingredients: [ingredient],
  }]);
  assert.ok(row.quantity > 0);
  assert.ok(row.purchaseQuantity >= row.quantity);
  assert.doesNotMatch(formatCanonicalAmount(row.purchaseQuantity, row.unit), /^0(?:\.0+)? oz$/);
  const [smaller] = aggregateCart([{
    recipeId: 'smaller', sourceServings: 1, targetServings: 1,
    ingredients: [{ raw: 'trace spice', name: 'spice', quantity: 1.1e-12, unit: 'ounce', kind: 'divisible', confidence: .9 }],
  }]);
  assert.equal(formatCanonicalAmount(smaller.purchaseQuantity, smaller.unit), '1.21e-12 oz');
});

test('canonical ounces display as practical US grocery and cooking units', () => {
  assert.equal(formatCanonicalAmount(16, 'ounce'), '1 lb');
  assert.equal(formatCanonicalAmount(8, 'ounce'), '1 cup');
  assert.equal(formatCanonicalAmount(0.5, 'ounce'), '1 tbsp');
  assert.equal(formatCanonicalAmount(1 / 6, 'ounce'), '1 tsp');
});

test('legacy flat localStorage cart migrates into recipe selections without dropping raw lines', () => {
  const legacy = [
    { recipeId: 'r1', recipeName: 'Soup', line: '2 cups stock', qtyText: '2 cups', name: 'stock' },
    { recipeId: 'r1', recipeName: 'Soup', line: 'salt to taste', qtyText: '', name: 'salt to taste' },
    { nonsense: true },
  ];
  const migrated = normalizeCart(legacy);
  assert.equal(migrated.length, 2, 'recoverable legacy rows are grouped and malformed data is retained separately');
  assert.deepEqual(migrated.flatMap((s) => s.ingredients.map((i) => i.raw)), [
    '2 cups stock', 'salt to taste', JSON.stringify({ nonsense: true }),
  ]);
  assert.doesNotThrow(() => normalizeCart('not-an-array'));
});
