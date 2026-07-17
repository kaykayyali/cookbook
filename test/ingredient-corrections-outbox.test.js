import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { ingredientEvidence } from '../docs/js/lib/ingredient-corrections.js';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { applyRecipeOperation, createRecipeOutbox } from '../docs/js/lib/recipe-outbox.js';

const dbName = () => `ingredient-review-outbox-${Date.now()}-${Math.random()}`;
const recipe = {
  id: 'r1', _id: 'r1', _updatedAt: 1000, name: 'Basil Pasta',
  recipeIngredient: ['to 4 basil leaves'],
};
const ingredientId = ingredientEvidence(recipe)[0].id;
const payload = {
  id: 'r1', ingredientId, expectedUpdatedAt: 1000,
  correction: {
    name: 'basil', amountState: 'numeric', amount: '2 to 4', quantity: 4, quantityMin: 2,
    quantityState: 'range', measurementFamily: 'count', sourceUnit: 'count', unit: 'count',
    kind: 'indivisible', countLabel: 'leaf', displayName: 'Basil', category: 'produce', confidence: 1,
  },
};

test('review operation applies immutable raw evidence optimistically without trusting payload evidence fields', () => {
  const [updated] = applyRecipeOperation([recipe], {
    op: 'recipe.ingredient.review',
    payload: { ...payload, raw: 'forged', sourceUrl: 'https://evil.test' },
  });
  assert.equal(updated.ingredientNormalizations[0].raw, 'to 4 basil leaves');
  assert.equal(updated.ingredientNormalizations[0].name, 'basil');
  assert.equal(Object.hasOwn(updated.ingredientNormalizations[0], 'sourceUrl'), false);
  assert.ok(updated._updatedAt > recipe._updatedAt);
});

test('offline reviewed correction persists in the durable recipe outbox and reconstructs after reload', async () => {
  const name = dbName();
  let repo = await openOfflineDb({ indexedDB, name });
  const first = createRecipeOutbox({ repo, authSub: 'kay', householdId: 'home', initial: [recipe], isOnline: () => false });
  await first.init();
  assert.equal(await first.mutate('recipe.ingredient.review', payload), true);
  assert.equal(first.current()[0].ingredientNormalizations[0].reviewStatus, 'reviewed');
  assert.equal((await repo.listOutbox('kay', 'home', 'recipe')).length, 1);
  repo.close();

  repo = await openOfflineDb({ indexedDB, name });
  const restored = createRecipeOutbox({ repo, authSub: 'kay', householdId: 'home', initial: [recipe], isOnline: () => false });
  await restored.init();
  assert.equal(restored.current()[0].ingredientNormalizations[0].name, 'basil');
  assert.equal(restored.current()[0].ingredientNormalizations[0].raw, 'to 4 basil leaves');
  repo.close();
});

test('queued offline reviews rebase each CAS token onto the previous authoritative acknowledgement', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  const expected = [];
  let serverRecipe = recipe;
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'home', initial: [recipe], isOnline: () => online,
    send: async (request) => {
      expected.push(request.payload.expectedUpdatedAt);
      serverRecipe = applyRecipeOperation([serverRecipe], request)[0];
      serverRecipe._updatedAt = expected.length === 1 ? 2000 : 3000;
      return { ok: true, recipes: [serverRecipe] };
    },
  });
  await manager.init();
  await manager.mutate('recipe.ingredient.review', payload);
  await manager.mutate('recipe.ingredient.review', {
    ...payload, correction: { ...payload.correction, amount: '3 to 5', quantityMin: 3, quantity: 5 },
  });
  online = true;
  assert.equal(await manager.drain(), true);
  assert.deepEqual(expected, [1000, 2000]);
  assert.equal(manager.current()[0].ingredientNormalizations[0].quantity, 5);
  repo.close();
});

test('server conflict remains actionable and discard restores authoritative unreviewed recipe', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const statuses = [];
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'home', initial: [recipe], isOnline: () => true,
    send: async () => ({ ok: false, status: 409, error: 'recipe_conflict' }),
    onStatus: (status) => statuses.push(status),
  });
  await manager.init();
  assert.equal(await manager.mutate('recipe.ingredient.review', payload), true);
  assert.equal(await manager.drain(), false);
  const [pending] = manager.pending();
  assert.equal(manager.current()[0].ingredientNormalizations[0].name, 'basil');
  assert.deepEqual(statuses.at(-1), { status: 'blocked', pending: 1, sequence: pending.sequence });
  assert.equal(await manager.discard(pending.sequence), true);
  assert.equal(manager.current()[0].ingredientNormalizations, undefined);
  repo.close();
});

test('target-scoped correction acknowledgement merges authority without dropping 100+ existing recipes', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const extras = Array.from({ length: 120 }, (_, index) => ({ id: `extra-${index}`, _id: `extra-${index}`, _updatedAt: index + 1, name: `Extra ${index}`, recipeIngredient: ['1 egg'] }));
  const initial = [recipe, ...extras];
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'home', initial, isOnline: () => true,
    send: async (request) => ({ ok: true, authorityMode: 'merge', recipes: [applyRecipeOperation([recipe], request)[0]] }),
  });
  await manager.init();
  assert.equal(await manager.mutate('recipe.ingredient.review', payload), true);
  assert.equal(await manager.drain(), true);
  assert.equal(manager.current().length, 121);
  assert.equal(manager.current().find((item) => item.id === 'r1').ingredientNormalizations[0].name, 'basil');
  assert.ok(manager.current().some((item) => item.id === 'extra-119'));
  repo.close();
});

test('local persistence failure rolls back reviewed correction and never calls remote authority', async () => {
  let sends = 0;
  const repo = {
    listOutbox: async () => [],
    enqueue: async () => { throw new Error('quota'); },
    deleteOutbox: async () => {}, putRecipes: async () => {}, acknowledgeRecipes: async () => {},
  };
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'home', initial: [recipe], isOnline: () => true,
    send: async () => { sends += 1; return { ok: true, recipes: [] }; },
  });
  await manager.init();
  assert.equal(await manager.mutate('recipe.ingredient.review', payload), false);
  assert.equal(manager.current()[0].ingredientNormalizations, undefined);
  assert.equal(sends, 0);
});
