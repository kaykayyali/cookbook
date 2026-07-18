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
import { recipeDiscoveryAuthority } from '../docs/js/lib/recipe-discovery-projection.js';

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

test('discovery-equivalent ingredient reorder and duplication do not advance authority generation', () => {
  const before = recipe('r', 'Pesto', ['basil', 'tomato']);
  assert.equal(versionDelta(before, recipe('r', 'Pesto', ['tomato', 'basil'])), 0);
  assert.equal(versionDelta(before, recipe('r', 'Pesto', ['basil', 'tomato', 'basil'])), 0);
});

test('structured discovery signatures ignore order and exact duplicates', () => {
  const basil = normalizeIngredient('basil');
  const tomato = normalizeIngredient('tomato');
  const before = recipe('r', 'Pesto', [basil, tomato]);
  assert.equal(versionDelta(before, recipe('r', 'Pesto', [tomato, basil])), 0);
  assert.equal(versionDelta(before, recipe('r', 'Pesto', [basil, tomato, basil])), 0);
});

test('equal-timestamp reviewed correction winners are input-order independent', () => {
  const raw = recipe('r', 'Pesto', ['mystery']);
  const basil = reviewed(raw, basilCorrection, 20).ingredientNormalizations[0];
  const parsley = reviewed(raw, { ...basilCorrection, name: 'parsley' }, 20).ingredientNormalizations[0];
  const forward = { ...raw, ingredientNormalizations: [basil, parsley] };
  const reverse = { ...raw, ingredientNormalizations: [parsley, basil] };
  assert.equal(versionDelta(forward, reverse), 0);
  const discover = createPantryRecipeDiscovery();
  const names = (recipeValue) => ['basil', 'parsley'].filter((name) => discover({ recipes: [recipeValue], pantry: pantry(name), ingredientName: name }).length);
  assert.deepEqual(names(forward), names(reverse));
});

test('equivalent warmed large authorities reuse generation and index', async () => {
  const corpus = Array.from({ length: 201 }, (_, index) => recipe(`r-${index}`, `Recipe ${index}`, ['basil', `item ${index}`]));
  const state = { recipes: [], recipeAuthorityVersion: 0 };
  publishRecipeAuthority(state, corpus);
  const firstRecord = recipeDiscoveryAuthority(state.recipes);
  await firstRecord.promise;
  const firstIndex = firstRecord.index;
  const version = state.recipeAuthorityVersion;
  const equivalent = corpus.map((item) => ({ ...item, recipeIngredient: [...item.recipeIngredient].reverse() }));
  publishRecipeAuthority(state, equivalent);
  const nextRecord = recipeDiscoveryAuthority(state.recipes);
  assert.equal(state.recipeAuthorityVersion, version);
  assert.equal(nextRecord.index, firstIndex);
  const changed = equivalent.map((item, index) => index ? item : { ...item, recipeIngredient: ['parsley'] });
  publishRecipeAuthority(state, changed);
  assert.equal(state.recipeAuthorityVersion, version + 1);
  assert.notEqual(recipeDiscoveryAuthority(state.recipes).index, firstIndex);
});

test('missing-ID derived identities are collision-free for distinct recipes', () => {
  const recipes = [
    { name: 'Missing 39494', recipeIngredient: ['basil'] },
    { name: 'Missing 40089', recipeIngredient: ['basil'] },
  ];
  const results = createPantryRecipeDiscovery()({ recipes, pantry: pantry('basil'), ingredientName: 'basil' });
  assert.deepEqual(results.map(({ recipeName }) => recipeName), ['Missing 39494', 'Missing 40089']);
  assert.equal(new Set(results.map(({ recipeIdentity }) => recipeIdentity)).size, 2);
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

  const hostileArray = [];
  Object.defineProperty(hostileArray, '0', { enumerable: true, get() { throw new Error('array index getter'); } });
  Object.defineProperty(hostileArray, Symbol.iterator, { get() { throw new Error('iterator getter'); } });
  hostileArray.length = 1;
  const previousVersion = state.recipeAuthorityVersion;
  assert.doesNotThrow(() => publishRecipeAuthority(state, hostileArray));
  assert.equal(state.recipes.length, 1);
  assert.equal(0 in state.recipes, false, 'hostile element becomes a safe hole without running accessors');
  assert.ok(state.recipeAuthorityVersion > previousVersion, 'unsafe top-level publication invalidates stale discovery');
});

test('large-corpus publication and paged discovery stay bounded, responsive, and linear', { timeout: 20_000 }, async (t) => {
  const corpus = Array.from({ length: 5_000 }, (_, recipeIndex) => recipe(
    `recipe-${recipeIndex}`,
    `Recipe ${String(recipeIndex).padStart(5, '0')}`,
    ['basil', ...Array.from({ length: 19 }, (_, ingredientIndex) => `1 piece ingredient ${recipeIndex}-${ingredientIndex}`)],
  ));
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const state = { recipes: [], recipeAuthorityVersion: 0 };
  const publicationStarted = performance.now();
  publishRecipeAuthority(state, corpus);
  const publicationMs = performance.now() - publicationStarted;
  assert.ok(publicationMs < 50, `authority publication blocked for ${publicationMs}ms`);

  const discover = createPantryRecipeDiscovery();
  let timerFiredAt = 0;
  let lastTick = performance.now();
  let maxTimerGap = 0;
  const interval = setInterval(() => {
    const now = performance.now();
    maxTimerGap = Math.max(maxTimerGap, now - lastTick);
    lastTick = now;
  }, 5);
  t.after(() => clearInterval(interval));
  const timer = new Promise((resolve) => setTimeout(() => { timerFiredAt = performance.now(); resolve(); }, 0));
  const prepareStarted = performance.now();
  const prepareCpuStarted = process.cpuUsage();
  const preparing = discover.prepare({ recipes: state.recipes, recipeAuthorityVersion: state.recipeAuthorityVersion });
  await timer;
  assert.ok(timerFiredAt - prepareStarted < 100, `index preparation blocked the event loop for ${timerFiredAt - prepareStarted}ms`);
  await preparing;
  const preparationMs = performance.now() - prepareStarted;
  const preparationCpu = process.cpuUsage(prepareCpuStarted);
  const preparationCpuMs = (preparationCpu.user + preparationCpu.system) / 1_000;
  assert.ok(preparationMs < 5_000, `5k x 20 index took ${preparationMs}ms`);
  assert.ok(maxTimerGap < 50, `index preparation created a ${maxTimerGap}ms event-loop gap`);
  const heapDelta = process.memoryUsage().heapUsed - heapBefore;
  assert.ok(heapDelta < 80 * 1024 * 1024, `incremental heap was ${heapDelta} bytes`);

  const firstIndex = recipeDiscoveryAuthority(state.recipes).index;
  const authorityVersion = state.recipeAuthorityVersion;
  const equivalent = corpus.map((item) => ({ ...item, recipeIngredient: [...item.recipeIngredient].reverse() }));
  const acknowledgementStarted = performance.now();
  publishRecipeAuthority(state, equivalent);
  const acknowledgementMs = performance.now() - acknowledgementStarted;
  assert.ok(acknowledgementMs < 50, `equivalent 5k acknowledgement blocked for ${acknowledgementMs}ms`);
  assert.equal(state.recipeAuthorityVersion, authorityVersion);
  assert.equal(recipeDiscoveryAuthority(state.recipes).index, firstIndex);

  maxTimerGap = 0;
  lastTick = performance.now();
  const queryStarted = performance.now();
  const pageOptions = {
    recipes: state.recipes,
    recipeAuthorityVersion: state.recipeAuthorityVersion,
    pantry: pantry('basil'),
    ingredientName: 'basil',
    offset: 0,
    limit: 3,
  };
  let page = discover.page(pageOptions);
  const initialQueryMs = performance.now() - queryStarted;
  assert.equal(page.pending, true);
  assert.ok(initialQueryMs < 50, `initial common query call took ${initialQueryMs}ms`);
  await page.ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearInterval(interval);
  page = discover.page(pageOptions);
  const queryMs = performance.now() - queryStarted;
  assert.equal(page.pending, false);
  assert.equal(page.results.length, 3);
  assert.equal(page.total, 5_000);
  assert.equal(page.hasMore, true);
  assert.ok(queryMs < 3_000, `yielded common query took ${queryMs}ms`);
  assert.ok(maxTimerGap < 50, `paged query created a ${maxTimerGap}ms event-loop gap`);

  const half = corpus.slice(0, 1_250);
  const halfDiscover = createPantryRecipeDiscovery();
  const halfStarted = performance.now();
  const halfCpuStarted = process.cpuUsage();
  await halfDiscover.prepare({ recipes: half, recipeAuthorityVersion: 1 });
  const halfMs = performance.now() - halfStarted;
  const halfCpu = process.cpuUsage(halfCpuStarted);
  const halfCpuMs = (halfCpu.user + halfCpu.system) / 1_000;
  assert.ok(preparationCpuMs < (halfCpuMs * 6) + 100,
    `4x scaling exceeded linear CPU target: 1.25k=${halfCpuMs}ms 5k=${preparationCpuMs}ms (wall ${halfMs}ms/${preparationMs}ms)`);
});

test('stale asynchronous index preparation is cancelled when recipe authority changes', async () => {
  const discover = createPantryRecipeDiscovery();
  const stale = Array.from({ length: 2_000 }, (_, index) => recipe(`old-${index}`, `Old ${index}`, ['basil']));
  const current = [recipe('new', 'Current', ['basil'])];
  const stalePreparation = discover.prepare({ recipes: stale, recipeAuthorityVersion: 1 });
  await discover.prepare({ recipes: current, recipeAuthorityVersion: 2 });
  await stalePreparation;
  const options = { recipes: current, recipeAuthorityVersion: 2, pantry: pantry('basil'), ingredientName: 'basil', limit: 3 };
  let page = discover.page(options);
  if (page.pending) { await page.ready; page = discover.page(options); }
  assert.deepEqual(page.results.map(({ recipeId }) => recipeId), ['new']);
});
