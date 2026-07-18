import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  applyReviewedIngredientCorrection,
  buildRecipeUsageIndex,
  canonicalIngredientsMatch,
  ingredientEvidence,
} from '../docs/js/lib/ingredient-corrections.js';
import { publishRecipeAuthority } from '../docs/js/lib/recipe-authority.js';

const discovery = await import('../docs/js/lib/pantry-recipe-discovery.js').catch(() => ({}));
const {
  createPantryRecipeDiscovery,
  discoverPantryRecipes,
  pantryAvailability,
  safeRecipeImageUrl,
} = discovery;

const pantryItem = (name, extras = {}) => ({
  id: `pantry-${name.replace(/\W+/g, '-')}`,
  raw: name,
  name,
  displayName: name,
  quantity: null,
  unit: 'qualitative',
  kind: 'qualitative',
  amountState: 'qualitative',
  ...extras,
});

const recipe = (id, name, ingredients, extras = {}) => ({
  _id: id,
  name,
  recipeIngredient: ingredients,
  ...extras,
});

test('usage lookup matches canonical basil leaf variants but never arbitrary substrings or compounds', () => {
  const recipes = [
    recipe('leaf', 'Leaf', ['2 basil leaves', 'basil leaves']),
    recipe('plain', 'Plain', ['fresh basil']),
    recipe('basilisk', 'Basilisk', ['1 basilisk steak']),
    recipe('sauce', 'Sauce', ['1 cup thai basil sauce']),
  ];
  const basilUses = buildRecipeUsageIndex(recipes).find('basil');
  assert.deepEqual(basilUses.map(({ recipeId }) => recipeId), ['leaf', 'plain']);
  assert.deepEqual(buildRecipeUsageIndex(recipes).find('basil leaves').map(({ recipeId }) => recipeId), ['leaf', 'plain']);
  assert.equal(basilUses.some(({ recipeId }) => ['basilisk', 'sauce'].includes(recipeId)), false);
  assert.deepEqual(buildRecipeUsageIndex(recipes).find('basilisk steak').map(({ recipeId }) => recipeId), ['basilisk']);
});

test('leaf identity normalizes only the final singular/plural token and preserves compounds', () => {
  const matrix = [
    ['basil', 'basil leaves', true],
    ['basil leaf', 'basil leaves', true],
    ['mint', 'mint leaves', true],
    ['parsley', 'parsley leaves', true],
    ['cilantro', 'cilantro leaves', true],
    ['curry', 'curry leaves', false],
    ['curry leaf', 'curry leaves', true],
    ['tea', 'tea leaves', false],
    ['tea leaf', 'tea leaves', true],
    ['bay', 'bay leaves', false],
    ['bay leaf', 'bay leaves', true],
    ['spinach', 'spinach leaves', true],
    ['basil', 'basilisk steak', false],
    ['basil', 'thai basil sauce', false],
  ];
  for (const [left, right, expected] of matrix) {
    assert.equal(canonicalIngredientsMatch(left, right), expected, `${left} ↔ ${right}`);
    assert.equal(canonicalIngredientsMatch(right, left), expected, `${right} ↔ ${left}`);
  }
  const recipes = [
    recipe('curry', 'Curry', ['curry']),
    recipe('curry-leaf', 'Curry Leaf', ['curry leaves']),
    recipe('tea', 'Tea', ['tea']),
    recipe('tea-leaf', 'Tea Leaf', ['tea leaves']),
    recipe('bay', 'Bay', ['bay']),
    recipe('bay-leaf', 'Bay Leaf', ['bay leaves']),
  ];
  const index = buildRecipeUsageIndex(recipes);
  assert.deepEqual(index.find('curry').map(({ recipeId }) => recipeId), ['curry']);
  assert.deepEqual(index.find('curry leaf').map(({ recipeId }) => recipeId), ['curry-leaf']);
  assert.deepEqual(index.find('curry leaves').map(({ recipeId }) => recipeId), ['curry-leaf']);
  assert.deepEqual(index.find('tea').map(({ recipeId }) => recipeId), ['tea']);
  assert.deepEqual(index.find('tea leaf').map(({ recipeId }) => recipeId), ['tea-leaf']);
  assert.deepEqual(index.find('tea leaves').map(({ recipeId }) => recipeId), ['tea-leaf']);
  assert.deepEqual(index.find('bay').map(({ recipeId }) => recipeId), ['bay']);
  assert.deepEqual(index.find('bay leaf').map(({ recipeId }) => recipeId), ['bay-leaf']);
  assert.deepEqual(index.find('bay leaves').map(({ recipeId }) => recipeId), ['bay-leaf']);
});

test('intrinsic package-word compounds never collapse to their suffix ingredient', () => {
  const distinct = [
    ['bottle gourd', 'gourd'],
    ['bunch onion', 'onion'],
    ['can candy', 'candy'],
    ['jar tomato', 'tomato'],
  ];
  for (const [compound, suffix] of distinct) {
    assert.equal(canonicalIngredientsMatch(compound, suffix), false, `${compound} ↔ ${suffix}`);
    assert.equal(canonicalIngredientsMatch(suffix, compound), false, `${suffix} ↔ ${compound}`);
  }
});

test('discovery reuses one bounded recipe index until recipe authority identity changes', () => {
  assert.equal(typeof createPantryRecipeDiscovery, 'function');
  let builds = 0;
  const discover = createPantryRecipeDiscovery({ onIndexBuild: () => { builds += 1; } });
  const recipes = [recipe('pesto', 'Pesto', ['basil', 'tomato'])];
  const pantry = [pantryItem('basil')];
  for (let index = 0; index < 25; index += 1) {
    discover({ recipes, pantry: index % 2 ? pantry : [...pantry], ingredientName: 'basil' });
  }
  assert.equal(builds, 1, 'Pantry-only rerenders reuse the recipe authority index');
  discover({ recipes: [...recipes], pantry, ingredientName: 'basil' });
  assert.equal(builds, 2, 'a replacement recipe authority rebuilds exactly once');
});

test('Pantry discovery deduplicates, computes unique-name coverage, and sorts by availability label then stable name and id', () => {
  assert.equal(typeof discoverPantryRecipes, 'function');
  const recipes = [
    recipe('few-z', 'Zulu Few', ['basil', 'rice', 'beans']),
    recipe('all-b', 'Beta All', ['basil leaves', 'tomato', 'tomato']),
    recipe('some', 'Some Soup', ['basil', 'tomato', 'stock', 'cream']),
    recipe('all-a', 'Alpha All', ['fresh basil', '1 tomato']),
    recipe('few-a', 'Alpha Few', ['basil', 'rice', 'beans', 'lime']),
    recipe('all-a', 'Stale duplicate', ['basil']),
  ];
  const pantry = [pantryItem('basil'), pantryItem('tomato')];
  const forward = discoverPantryRecipes({ recipes, pantry, ingredientName: 'basil' });
  const reverse = discoverPantryRecipes({ recipes: [...recipes].reverse(), pantry: [...pantry].reverse(), ingredientName: 'basil' });
  assert.deepEqual(forward, reverse, 'input order cannot affect results');
  assert.deepEqual(forward.map(({ recipeId, availability }) => [recipeId, availability.label, availability.have, availability.total]), [
    ['all-a', 'All', 2, 2],
    ['all-b', 'All', 2, 2],
    ['some', 'Some', 2, 4],
    ['few-a', 'Few', 1, 4],
    ['few-z', 'Few', 1, 3],
  ]);
  assert.equal(new Set(forward.map(({ recipeIdentity }) => recipeIdentity)).size, forward.length);
  assert.equal(forward.find(({ recipeId }) => recipeId === 'all-b').matchingLine, 'basil leaves');
});

test('duplicate recipes with the same usage identity choose image evidence independently of input order', () => {
  const duplicates = [
    { _id: 'dup', name: 'Pesto', image: 'https://images.example.test/z.png', recipeIngredient: ['basil', 'bread'] },
    { _id: 'dup', name: 'Pesto', image: 'https://images.example.test/a.png', recipeIngredient: ['basil', 'bread'] },
  ];
  const options = { pantry: [pantryItem('basil')], ingredientName: 'basil' };
  const forward = discoverPantryRecipes({ ...options, recipes: duplicates });
  const reverse = discoverPantryRecipes({ ...options, recipes: [...duplicates].reverse() });
  assert.deepEqual(forward, reverse);
  assert.equal(forward[0]?.imageUrl, 'https://images.example.test/a.png');
});

test('availability thresholds are deterministic and existence-only for unknown or qualitative amounts', () => {
  assert.equal(typeof pantryAvailability, 'function');
  const pantry = [
    pantryItem('basil', { amountState: 'unknown' }),
    pantryItem('tomato', { amountState: 'qualitative' }),
    pantryItem('salt', { quantity: 1, unit: 'count', kind: 'indivisible', amountState: 'known' }),
  ];
  assert.deepEqual(pantryAvailability(['basil'], pantry), { label: 'All', have: 1, total: 1, ratio: 1 });
  assert.deepEqual(pantryAvailability(['basil', 'tomato', 'stock', 'cream'], pantry), { label: 'Some', have: 2, total: 4, ratio: 0.5 });
  assert.deepEqual(pantryAvailability(['basil', 'stock', 'cream'], pantry), { label: 'Few', have: 1, total: 3, ratio: 1 / 3 });
  assert.deepEqual(pantryAvailability([], pantry), { label: 'Few', have: 0, total: 0, ratio: 0 });
});

test('reviewed corrections and Pantry renames change discovery immediately while immutable matching evidence remains raw', () => {
  assert.equal(typeof discoverPantryRecipes, 'function');
  const base = recipe('pesto', 'Pesto', ['2 mystery leaves', '1 tomato']);
  const reviewed = applyReviewedIngredientCorrection(base, {
    ingredientId: ingredientEvidence(base)[0].id,
    correction: { name: 'basil', amountState: 'numeric', amount: '2', measurementFamily: 'count', sourceUnit: 'count', countLabel: 'leaf' },
    reviewer: { sub: 'member', name: 'Member' },
    reviewedAt: 10,
  });
  assert.equal(reviewed.ok, true, reviewed.error);
  assert.deepEqual(discoverPantryRecipes({ recipes: [base], pantry: [pantryItem('basil')], ingredientName: 'basil' }), []);
  const corrected = discoverPantryRecipes({ recipes: [reviewed.recipe], pantry: [pantryItem('basil')], ingredientName: 'basil' });
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].matchingLine, '2 mystery leaves', 'display evidence stays immutable source text');
  assert.deepEqual(discoverPantryRecipes({ recipes: [reviewed.recipe], pantry: [pantryItem('parsley')], ingredientName: 'parsley' }), []);
});

test('reviewed ingredient authority invalidates a warmed discovery index exactly once', () => {
  let builds = 0;
  const discover = createPantryRecipeDiscovery({ onIndexBuild: () => { builds += 1; } });
  const base = recipe('pesto', 'Pesto', ['2 mystery leaves']);
  const state = { recipes: [base], recipeAuthorityVersion: 0 };
  const options = { pantry: [pantryItem('basil')], ingredientName: 'basil' };
  const render = () => discover({ ...options, recipes: state.recipes, recipeAuthorityVersion: state.recipeAuthorityVersion });

  assert.deepEqual(render(), []);
  assert.deepEqual(render(), []);
  assert.equal(builds, 1, 'unchanged renders reuse the warm index');

  const reviewed = applyReviewedIngredientCorrection(base, {
    ingredientId: ingredientEvidence(base)[0].id,
    correction: { name: 'basil', amountState: 'numeric', amount: '2', measurementFamily: 'count', sourceUnit: 'count', countLabel: 'leaf' },
    reviewer: { sub: 'member', name: 'Member' },
    reviewedAt: 10,
  });
  assert.equal(reviewed.ok, true, reviewed.error);
  publishRecipeAuthority(state, [reviewed.recipe]);

  assert.equal(render().length, 1);
  assert.equal(builds, 2, 'one authority publication causes one rebuild');
  assert.equal(render().length, 1);
  assert.equal(builds, 2, 'unchanged form renders do not rebuild');

  const invalidated = structuredClone(reviewed.recipe);
  invalidated.ingredientNormalizations[0].parserVersion = 0;
  publishRecipeAuthority(state, [invalidated]);
  assert.deepEqual(render(), [], 'invalid reviewed metadata falls back to immutable source evidence');
  assert.equal(builds, 3, 'valid-to-invalid effective identity transition rebuilds the index');
});

test('image extraction accepts safe HTTP(S) forms and rejects executable, credentialed, malformed, and missing URLs', () => {
  assert.equal(typeof safeRecipeImageUrl, 'function');
  assert.equal(safeRecipeImageUrl('https://images.example.test/a.jpg'), 'https://images.example.test/a.jpg');
  assert.equal(safeRecipeImageUrl([{ url: 'https://images.example.test/b.jpg' }]), 'https://images.example.test/b.jpg');
  assert.equal(safeRecipeImageUrl({ contentUrl: 'http://images.example.test/c.jpg' }), 'http://images.example.test/c.jpg');
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://user:secret@example.test/a.jpg', 'not a url', '', null]) {
    assert.equal(safeRecipeImageUrl(value), '', String(value));
  }
});

test('empty, missing-id, missing-image, and large-corpus discovery stay safe and fast without mutating Shopping', () => {
  assert.equal(typeof discoverPantryRecipes, 'function');
  const shopping = { basil: true, tomato: false };
  const beforeShopping = structuredClone(shopping);
  assert.deepEqual(discoverPantryRecipes({ recipes: [], pantry: [pantryItem('basil')], ingredientName: 'basil' }), []);
  const missing = discoverPantryRecipes({
    recipes: [{ name: 'No id', recipeIngredient: ['basil'] }],
    pantry: [pantryItem('basil')],
    ingredientName: 'basil',
  });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].canOpen, false);
  assert.equal(missing[0].imageUrl, '');

  const corpus = Array.from({ length: 5_000 }, (_, index) => recipe(`r-${index}`, `Recipe ${String(index).padStart(5, '0')}`, ['basil', `ingredient ${index}`]));
  const started = performance.now();
  const found = discoverPantryRecipes({ recipes: corpus, pantry: [pantryItem('basil')], ingredientName: 'basil' });
  const elapsed = performance.now() - started;
  assert.equal(found.length, 5_000);
  assert.ok(elapsed < 30_000, `5k discovery took ${elapsed}ms`);
  assert.deepEqual(shopping, beforeShopping, 'availability must never subtract or mutate Shopping');
});

test('discovery scales with recipes plus Pantry names instead of multiplying both collections', () => {
  const measure = (size) => {
    const pantry = [pantryItem('basil'), ...Array.from({ length: size - 1 }, (_, index) => pantryItem(`pantry ${index}`))];
    const recipes = Array.from({ length: size }, (_, index) => recipe(`scale-${index}`, `Scale ${index}`, ['basil', `recipe ${index}`]));
    const started = performance.now();
    const found = discoverPantryRecipes({ recipes, pantry, ingredientName: 'basil' });
    return { elapsed: Math.max(performance.now() - started, 1), count: found.length };
  };
  const small = measure(500);
  const large = measure(2_000);
  assert.equal(small.count, 500);
  assert.equal(large.count, 2_000);
  assert.ok(large.elapsed < small.elapsed * 10,
    `discovery scaled like recipes × Pantry: 500=${small.elapsed}ms 2k=${large.elapsed}ms`);
});
