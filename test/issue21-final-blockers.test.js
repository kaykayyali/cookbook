import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  addRecipeSelection,
  aggregateCart,
  normalizeIngredient,
} from '../docs/js/lib/cart.js';
import {
  applyReviewedIngredientCorrection,
  buildReviewedIngredientRecord,
  buildRecipeUsageIndex,
  ingredientEvidence,
} from '../docs/js/lib/ingredient-corrections.js';
import { normalizePantryEntry } from '../docs/js/lib/pantry.js';
import { createPantryRecipeDiscovery } from '../docs/js/lib/pantry-recipe-discovery.js';
import { publishRecipeAuthority } from '../docs/js/lib/recipe-authority.js';

const pantry = (name) => [{ name }];
const recipe = (id, name, lines, extras = {}) => ({ _id: id, name, recipeIngredient: lines, ...extras });

function reviewed(base, correction, reviewedAt = 10) {
  const applied = applyReviewedIngredientCorrection(base, {
    ingredientId: ingredientEvidence(base)[0].id,
    correction,
    reviewer: { sub: 'member', name: 'Member' },
    reviewedAt,
  });
  assert.equal(applied.ok, true, applied.error);
  return applied.recipe;
}

const basilCorrection = {
  name: 'basil', amountState: 'numeric', amount: '2', measurementFamily: 'count',
  sourceUnit: 'count', countLabel: 'leaf',
};

function versionDelta(before, next) {
  const state = { recipes: [], recipeAuthorityVersion: 0 };
  publishRecipeAuthority(state, [before]);
  const version = state.recipeAuthorityVersion;
  publishRecipeAuthority(state, [next]);
  return state.recipeAuthorityVersion - version;
}

test('quantity-bearing intrinsic bottle gourd stays intrinsic through normalization, cart, Shopping, Pantry, and usage discovery', () => {
  const matrix = [
    ['bottle gourd', { name: 'bottle gourd', quantity: null, unit: 'qualitative', countLabel: '' }],
    ['1 bottle gourd', { name: 'bottle gourd', quantity: 1, unit: 'count', countLabel: '' }],
    ['2 bottle gourds', { name: 'bottle gourd', quantity: 2, unit: 'count', countLabel: '' }],
    ['1 bottle of oil', { name: 'oil', quantity: 1, unit: 'count', countLabel: 'bottle' }],
    ['2 slices of bread', { name: 'bread', quantity: 2, unit: 'count', countLabel: 'slice' }],
    ['3 cloves garlic', { name: 'garlic', quantity: 3, unit: 'count', countLabel: 'clove' }],
  ];
  for (const [raw, expected] of matrix) {
    const actual = normalizeIngredient(raw);
    assert.deepEqual({ name: actual.name, quantity: actual.quantity, unit: actual.unit, countLabel: actual.countLabel }, expected, raw);
  }

  const bottleRecipe = recipe('bottle', 'Bottle Gourd Curry', ['1 bottle gourd', '2 bottle gourds']);
  const gourdRecipe = recipe('plain', 'Plain Gourd', ['1 gourd']);
  const cart = addRecipeSelection([], bottleRecipe, bottleRecipe.recipeIngredient.map(normalizeIngredient));
  const shopping = aggregateCart(cart);
  assert.deepEqual(shopping.map(({ name, quantity, countLabel }) => ({ name, quantity, countLabel })), [
    { name: 'bottle gourd', quantity: 3, countLabel: '' },
  ]);
  assert.equal(normalizePantryEntry('1 bottle gourd').name, 'bottle gourd');
  const usage = buildRecipeUsageIndex([bottleRecipe, gourdRecipe]);
  assert.deepEqual(usage.find('bottle gourd').map(({ recipeId }) => recipeId), ['bottle']);
  assert.deepEqual(usage.find('gourd').map(({ recipeId }) => recipeId), ['plain']);
});

test('authority signature follows effective correction validity, winner selection, output fields, recipe presentation, and ignores irrelevant metadata', () => {
  const raw = recipe('r', 'Pesto', ['2 mystery leaves'], { image: 'https://img.test/a.jpg' });
  const valid = reviewed(raw, basilCorrection);
  const record = valid.ingredientNormalizations[0];
  const relevantMutations = [
    ['parserVersion invalidates', { parserVersion: 0 }],
    ['reviewStatus invalidates', { reviewStatus: 'unreviewed' }],
    ['reviewVersion invalidates', { reviewVersion: 999 }],
    ['displayName invalidates', { displayName: 'Wrong' }],
    ['category invalidates', { category: 'produce' }],
    ['confidence invalidates', { confidence: 0.5 }],
    ['kind invalidates', { kind: 'divisible' }],
    ['quantity invalidates', { quantity: 3 }],
    ['unit invalidates', { unit: 'ounce' }],
    ['immutable raw evidence invalidates', { raw: 'different evidence' }],
  ];
  for (const [label, change] of relevantMutations) {
    const next = { ...valid, ingredientNormalizations: [{ ...record, ...change }] };
    assert.equal(versionDelta(valid, next), 1, label);
  }
  assert.equal(versionDelta(valid, { ...valid, _id: 'next' }), 1, 'recipe ID');
  assert.equal(versionDelta(valid, { ...valid, name: 'Renamed' }), 1, 'recipe name');
  assert.equal(versionDelta(valid, { ...valid, image: 'https://img.test/b.jpg' }), 1, 'recipe image');
  assert.equal(versionDelta(valid, { ...valid, recipeIngredient: ['different evidence'] }), 1, 'raw ingredient source');
  assert.equal(versionDelta(valid, {
    ...valid,
    ingredientNormalizations: [{ ...record, countLabel: 'slice', reviewedBy: { sub: 'same', name: 'Metadata only' }, irrelevant: { any: 'value' } }],
    description: 'metadata only',
  }), 0, 'discovery-irrelevant structured and count-label metadata');

  const evidence = ingredientEvidence(raw)[0];
  const parsley = buildReviewedIngredientRecord({
    id: evidence.id,
    raw: evidence.raw,
    correction: { ...basilCorrection, name: 'parsley' },
    reviewedAt: 20,
  }).record;
  const basil = { ...record, reviewedAt: 10 };
  const parsleyWins = { ...raw, ingredientNormalizations: [basil, parsley] };
  const basilWins = { ...raw, ingredientNormalizations: [basil, { ...parsley, reviewedAt: 5 }] };
  assert.equal(versionDelta(parsleyWins, basilWins), 1, 'reviewedAt winner ordering');
});

test('invalid effective correction publication removes a stale warmed identity', () => {
  const base = recipe('r', 'Pesto', ['mystery']);
  const valid = reviewed(base, basilCorrection);
  const state = { recipes: [], recipeAuthorityVersion: 0 };
  const discover = createPantryRecipeDiscovery();
  publishRecipeAuthority(state, [valid]);
  assert.equal(discover({ ...state, pantry: pantry('basil'), ingredientName: 'basil' }).length, 1);
  publishRecipeAuthority(state, [{ ...valid, ingredientNormalizations: [{ ...valid.ingredientNormalizations[0], parserVersion: 0 }] }]);
  assert.deepEqual(discover({ ...state, pantry: pantry('basil'), ingredientName: 'basil' }), []);
});

test('authority publication is bounded, getter-safe, cycle-safe, BigInt-safe, and fails before mutating an invalid state', () => {
  assert.throws(() => publishRecipeAuthority(null, []), { name: 'TypeError', message: /state/i });
  const state = { recipes: ['sentinel'], recipeAuthorityVersion: 7 };
  const inherited = Object.create({
    get name() { throw new Error('inherited getter'); },
    get recipeIngredient() { throw new Error('inherited ingredients'); },
  });
  Object.defineProperty(inherited, 'image', { enumerable: true, get() { throw new Error('own image getter'); } });
  inherited._id = 'hostile';
  const cycle = { url: '' };
  cycle.contentUrl = cycle;
  const hostileIngredient = Object.create(null);
  Object.defineProperty(hostileIngredient, 'raw', { enumerable: true, get() { throw new Error('raw getter'); } });
  const nullPrototype = Object.assign(Object.create(null), {
    _id: 'null-prototype', name: 'Safe', image: cycle,
    recipeIngredient: [hostileIngredient, 'basil'],
    ingredientNormalizations: [{ raw: 'basil', quantity: 1n }],
  });
  const authority = [null, inherited, nullPrototype, { _id: 'big', name: 'Big', recipeIngredient: ['x'.repeat(2_000_000)] }];
  assert.doesNotThrow(() => publishRecipeAuthority(state, authority));
  assert.equal(state.recipes.length, authority.length, 'full authority publishes even when discovery projection fails closed');
  assert.equal(state.recipes[1], inherited);
  assert.ok(state.recipeAuthorityVersion > 7);

  const discover = createPantryRecipeDiscovery();
  assert.doesNotThrow(() => discover({ ...state, pantry: pantry('basil'), ingredientName: 'basil' }));
  const version = state.recipeAuthorityVersion;
  assert.doesNotThrow(() => publishRecipeAuthority(state, authority));
  assert.ok(state.recipeAuthorityVersion > version, 'fallback publication always invalidates so a stale cache cannot survive');
});

test('large-corpus publication and paged discovery stay bounded, responsive, and linear', { timeout: 20_000 }, async () => {
  const corpus = Array.from({ length: 5_000 }, (_, recipeIndex) => recipe(
    `recipe-${recipeIndex}`,
    `Recipe ${String(recipeIndex).padStart(5, '0')}`,
    Array.from({ length: 20 }, (_, ingredientIndex) => `1 piece ingredient ${ingredientIndex}`),
  ));
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const state = { recipes: [], recipeAuthorityVersion: 0 };
  const publicationStarted = performance.now();
  publishRecipeAuthority(state, corpus);
  const publicationMs = performance.now() - publicationStarted;
  assert.ok(publicationMs < 750, `authority projection took ${publicationMs}ms`);

  const discover = createPantryRecipeDiscovery();
  let timerFiredAt = 0;
  const timer = new Promise((resolve) => setTimeout(() => { timerFiredAt = performance.now(); resolve(); }, 0));
  const prepareStarted = performance.now();
  const preparing = discover.prepare({ recipes: state.recipes, recipeAuthorityVersion: state.recipeAuthorityVersion });
  await timer;
  assert.ok(timerFiredAt - prepareStarted < 100, `index preparation blocked the event loop for ${timerFiredAt - prepareStarted}ms`);
  await preparing;
  const preparationMs = performance.now() - prepareStarted;
  assert.ok(preparationMs < 1_500, `5k x 20 index took ${preparationMs}ms`);
  const heapDelta = process.memoryUsage().heapUsed - heapBefore;
  assert.ok(heapDelta < 80 * 1024 * 1024, `incremental heap was ${heapDelta} bytes`);

  const queryStarted = performance.now();
  const page = discover.page({
    recipes: state.recipes,
    recipeAuthorityVersion: state.recipeAuthorityVersion,
    pantry: pantry('ingredient 1'),
    ingredientName: 'ingredient 1',
    offset: 0,
    limit: 3,
  });
  const queryMs = performance.now() - queryStarted;
  assert.equal(page.pending, false);
  assert.equal(page.results.length, 3);
  assert.equal(page.total, 5_000);
  assert.equal(page.hasMore, true);
  assert.ok(queryMs < 50, `initial common query took ${queryMs}ms`);

  const half = corpus.slice(0, 1_250);
  const halfDiscover = createPantryRecipeDiscovery();
  const halfStarted = performance.now();
  await halfDiscover.prepare({ recipes: half });
  const halfMs = Math.max(performance.now() - halfStarted, 1);
  assert.ok(preparationMs < halfMs * 5, `4x scaling exceeded linear target: 1.25k=${halfMs}ms 5k=${preparationMs}ms`);
});

test('stale asynchronous index preparation is cancelled when recipe authority changes', async () => {
  const discover = createPantryRecipeDiscovery();
  const stale = Array.from({ length: 2_000 }, (_, index) => recipe(`old-${index}`, `Old ${index}`, ['basil']));
  const current = [recipe('new', 'Current', ['basil'])];
  const stalePreparation = discover.prepare({ recipes: stale, recipeAuthorityVersion: 1 });
  await discover.prepare({ recipes: current, recipeAuthorityVersion: 2 });
  await stalePreparation;
  const page = discover.page({ recipes: current, recipeAuthorityVersion: 2, pantry: pantry('basil'), ingredientName: 'basil', limit: 3 });
  assert.deepEqual(page.results.map(({ recipeId }) => recipeId), ['new']);
});
