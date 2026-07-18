import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

import { normalizeIngredient } from '../docs/js/lib/cart.js';
import {
  buildRecipeDiscoveryIndexSync,
  prepareRecipeDiscoveryIndex,
  prepareRecipeDiscoveryPage,
  queryRecipeDiscoveryIndex,
  recipeDiscoveryAuthority,
} from '../docs/js/lib/recipe-discovery-projection.js';

const WIDE_INGREDIENT_COUNT = 1_001;
const MAX_WORK_BETWEEN_YIELDS = 50;
const isArrayIndex = (property) => typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property);

function installYieldProbe(t) {
  const hadScheduler = Object.hasOwn(globalThis, 'scheduler');
  const previousScheduler = globalThis.scheduler;
  let work = 0;
  let maxWork = 0;
  let yields = 0;
  globalThis.scheduler = {
    yield: async () => {
      maxWork = Math.max(maxWork, work);
      work = 0;
      yields += 1;
    },
  };
  t.after(() => {
    if (hadScheduler) globalThis.scheduler = previousScheduler;
    else delete globalThis.scheduler;
  });
  return {
    touch() { work += 1; },
    result() {
      maxWork = Math.max(maxWork, work);
      return { maxWork, yields };
    },
  };
}

function descriptorObservedArray(values, probe) {
  return new Proxy(values, {
    getOwnPropertyDescriptor(target, property) {
      if (isArrayIndex(property)) probe.touch();
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

function readObservedArray(values, probe) {
  return new Proxy(values, {
    get(target, property, receiver) {
      if (isArrayIndex(property)) probe.touch();
      return Reflect.get(target, property, receiver);
    },
  });
}

function assertChunked(probe, phase) {
  const observed = probe.result();
  assert.ok(observed.yields > 1, `${phase} should yield repeatedly: ${JSON.stringify(observed)}`);
  assert.ok(observed.maxWork <= MAX_WORK_BETWEEN_YIELDS,
    `${phase} performed ${observed.maxWork} ingredient reads between yields`);
}

test('wide asynchronous authority projection yields inside one recipe ingredient loop', async (t) => {
  const probe = installYieldProbe(t);
  const ingredientValues = Array.from({ length: WIDE_INGREDIENT_COUNT }, (_, index) => `ingredient ${index}`);
  const ingredients = descriptorObservedArray(ingredientValues, probe);
  const recipes = [
    { _id: 'wide', name: 'Wide recipe', recipeIngredient: ingredients },
    ...Array.from({ length: 200 }, (_, index) => ({
      _id: `filler-${index}`, name: `Filler ${index}`, recipeIngredient: [],
    })),
  ];

  const record = recipeDiscoveryAuthority(recipes);
  await prepareRecipeDiscoveryIndex(record);

  assert.equal(record.snapshot.find((item) => item.id === 'wide').recipe.recipeIngredient.length,
    WIDE_INGREDIENT_COUNT);
  const syncIndex = buildRecipeDiscoveryIndexSync(recipeDiscoveryAuthority([
    { _id: 'wide', name: 'Wide recipe', recipeIngredient: ingredientValues },
  ]));
  assert.deepEqual(record.index.recipes.find((item) => item.recipeId === 'wide'), syncIndex.recipes[0],
    'yielding preserves the synchronous deterministic projection and index output');
  assertChunked(probe, 'authority projection');
});

test('structured asynchronous authority retains the exact compact synchronous snapshot', { timeout: 30_000 }, async () => {
  const makeCorpus = () => Array.from({ length: 201 }, (_, recipeIndex) => ({
    _id: `structured-${recipeIndex}`,
    name: `Structured recipe ${recipeIndex}`,
    recipeIngredient: Array.from({ length: 250 }, (_, ingredientIndex) => (
      normalizeIngredient(`${ingredientIndex + 1} cups ingredient-${recipeIndex}-${ingredientIndex}`)
    )),
  }));

  const synchronous = recipeDiscoveryAuthority(makeCorpus());
  buildRecipeDiscoveryIndexSync(synchronous);
  const asynchronous = recipeDiscoveryAuthority(makeCorpus());
  await prepareRecipeDiscoveryIndex(asynchronous);

  assert.equal(isDeepStrictEqual(asynchronous.snapshot, synchronous.snapshot), true,
    'yielded and synchronous authority snapshots must be exactly equal');
  assert.deepEqual(Object.keys(asynchronous.snapshot[0].effective[0]), ['raw', 'name'],
    'the retained effective projection contains only discovery fields');
  const retainedEffectiveBytes = Buffer.byteLength(JSON.stringify(
    asynchronous.snapshot.map((item) => item.effective),
  ));
  assert.ok(retainedEffectiveBytes < 4 * 1024 * 1024,
    `compact effective snapshot retained ${retainedEffectiveBytes} bytes`);
});

test('wide asynchronous index build yields inside one recipe ingredient loop', async (t) => {
  const probe = installYieldProbe(t);
  const recipeIngredient = readObservedArray(
    Array.from({ length: WIDE_INGREDIENT_COUNT }, (_, index) => `ingredient ${index}`),
    probe,
  );
  const item = {
    id: 'wide', name: 'Wide recipe', image: '', identity: 'id:wide', rawOnly: true,
    recipe: { recipeIngredient }, effective: null,
  };
  const record = {
    ok: true, signature: '', snapshot: [item], source: null,
    index: null, promise: null, authorityPromise: null,
  };

  const index = await prepareRecipeDiscoveryIndex(record);

  assert.equal(index.recipes[0].names.length, WIDE_INGREDIENT_COUNT);
  assertChunked(probe, 'index build');
});

test('allocation-bounded async query also yields while materializing one wide selected recipe', async (t) => {
  const probe = installYieldProbe(t);
  let resultLikeReads = 0;
  const wideNameValues = [
    'basil',
    ...Array.from({ length: WIDE_INGREDIENT_COUNT - 1 }, (_, index) => `wide-${index}`),
  ];
  const wideNames = readObservedArray(wideNameValues, probe);
  const wideRaws = wideNameValues.map((name) => `raw ${name}`);
  const recipes = Array.from({ length: 5_000 }, (_, index) => {
    const names = index === 0 ? wideNames : ['basil'];
    const raws = index === 0 ? wideRaws : ['raw basil'];
    return {
      recipeId: `recipe-${index}`,
      recipeIdentity: `id:recipe-${index}`,
      recipeName: `Recipe ${String(index).padStart(5, '0')}`,
      imageUrl: '',
      canOpen: true,
      names,
      get raws() {
        resultLikeReads += 1;
        return raws;
      },
    };
  });
  const index = {
    recipes,
    byIngredient: new Map([['basil', recipes.map((_, index) => index)]]),
  };

  const page = await prepareRecipeDiscoveryPage(index, [], 'basil', { limit: 3 });

  assert.deepEqual(page.results.map(({ recipeId }) => recipeId), [
    'recipe-0', 'recipe-1', 'recipe-2',
  ]);
  assert.equal(resultLikeReads, 3, 'only selected refs materialize result evidence');
  assert.equal(page.results[0].availability.total, WIDE_INGREDIENT_COUNT);
  assertChunked(probe, 'selected recipe materialization');
});

test('wide asynchronous query yields inside one recipe ranking loop', async (t) => {
  const probe = installYieldProbe(t);
  const nameValues = [
    'basil',
    ...Array.from({ length: WIDE_INGREDIENT_COUNT - 1 }, (_, index) => `ingredient-${index}`),
  ];
  const names = readObservedArray(nameValues, probe);
  const raws = ['fresh basil', ...Array.from({ length: WIDE_INGREDIENT_COUNT - 1 }, () => '')];
  const source = {
    recipeId: 'wide', recipeIdentity: 'id:wide', recipeName: 'Wide recipe', imageUrl: '', canOpen: true,
    names, raws,
  };
  const index = { recipes: [source], byIngredient: new Map([['basil', [0]]]) };

  const page = await prepareRecipeDiscoveryPage(index, [], 'basil', { limit: 3 });

  assert.equal(page.results[0].matchingLine, 'fresh basil');
  assert.equal(page.results[0].availability.total, WIDE_INGREDIENT_COUNT);
  const syncPage = queryRecipeDiscoveryIndex({
    recipes: [{ ...source, names: nameValues }], byIngredient: index.byIngredient,
  }, [], 'basil', { limit: 3 });
  assert.deepEqual(page, syncPage, 'yielding preserves synchronous query ordering and availability output');
  assertChunked(probe, 'query ranking');
});
