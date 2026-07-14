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
