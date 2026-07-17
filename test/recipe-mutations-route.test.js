import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/recipe-mutations.js';

const context = (overrides = {}) => ({
  request: new Request('https://cookbook.test/api/recipe-mutations', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mutationId: 'm1', op: 'recipe.create', payload: { id: 'r1', recipe: { name: 'Soup' } } }),
  }),
  env: { DB: {} },
  data: {
    auth: { sub: 'kay', name: 'Kaysser' }, household: { household: { id: 'our-home' } },
    recipeMutationStore: { mutate: async (request) => ({ status: 200, recipes: [{ id: request.payload.id, recipe: request.payload.recipe }] }) },
  },
  ...overrides,
});

test('recipe mutation route fails closed without household membership', async () => {
  const ctx = context();
  ctx.data.household = null;
  const response = await onRequestPost(ctx);
  assert.equal(response.status, 403);
});

test('recipe mutation route binds authenticated author and stable mutation ID', async () => {
  let captured;
  const ctx = context();
  ctx.data.recipeMutationStore = { mutate: async (request) => { captured = request; return { status: 200, recipes: [] }; } };
  const response = await onRequestPost(ctx);
  assert.equal(response.status, 200);
  assert.equal(captured.mutationId, 'm1');
  assert.equal(captured.author.sub, 'kay');
  assert.equal(captured.householdId, 'our-home');
});

test('ingredient review route forwards correction under household authority and ignores forged reviewer identity', async () => {
  let captured;
  const body = {
    mutationId: 'review-1', op: 'recipe.ingredient.review',
    author: { sub: 'attacker', name: 'Attacker' },
    payload: {
      id: 'r1', ingredientId: 'ingredient-stable-0', expectedUpdatedAt: 1000,
      correction: { name: 'basil', amountState: 'qualitative' },
    },
  };
  const ctx = context({
    request: new Request('https://cookbook.test/api/recipe-mutations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
  });
  ctx.data.recipeMutationStore = { mutate: async (request) => { captured = request; return { status: 200, recipes: [] }; } };
  assert.equal((await onRequestPost(ctx)).status, 200);
  assert.equal(captured.op, 'recipe.ingredient.review');
  assert.deepEqual(captured.author, { sub: 'kay', name: 'Kaysser', picture: null });
  assert.equal(captured.payload.correction.name, 'basil');
});

test('recipe mutation route rejects malformed top-level ingredient-review bodies before persistence', async () => {
  let calls = 0;
  const ctx = context({
    request: new Request('https://cookbook.test/api/recipe-mutations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'review-bad', op: 'recipe.ingredient.review', payload: [] }),
    }),
  });
  ctx.data.recipeMutationStore = { mutate: async () => { calls += 1; return { status: 200, recipes: [] }; } };
  assert.equal((await onRequestPost(ctx)).status, 400);
  assert.equal(calls, 0);
});

test('recipe mutation route rejects oversize, prototype-key, deeply nested, and malformed identifier payloads atomically', async () => {
  const deeplyNested = `{"mutationId":"m","op":"recipe.ingredient.review","payload":${'{"x":'.repeat(3_000)}0${'}'.repeat(3_000)}}`;
  const bodies = [
    JSON.stringify({ mutationId: 'x'.repeat(201), op: 'recipe.ingredient.review', payload: {} }),
    JSON.stringify({ mutationId: 'm', op: 'recipe.ingredient.review', payload: { correction: { note: 'x'.repeat(50_001) } } }),
    '{"mutationId":"m","op":"recipe.ingredient.review","payload":{"__proto__":{"polluted":true}}}',
    deeplyNested,
  ];
  for (const body of bodies) {
    let calls = 0;
    const ctx = context({ request: new Request('https://cookbook.test/api/recipe-mutations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }) });
    ctx.data.recipeMutationStore = { mutate: async () => { calls += 1; return { status: 200, recipes: [] }; } };
    assert.equal((await onRequestPost(ctx)).status, 400);
    assert.equal(calls, 0);
  }
});
