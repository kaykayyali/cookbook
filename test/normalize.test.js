import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNormalizationPrompt, parseNormalizedIngredients, handleNormalize } from '../functions/_lib/normalize.js';
import { onRequestPost } from '../functions/api/normalize.js';

function rateDb(shared = new Map()) {
  return { prepare(sql) { if (/CREATE TABLE/i.test(sql)) return { run: async () => ({ success: true }) }; return { bind(bucket, now, cutoff) { return { first: async () => { const current = shared.get(bucket); const next = !current || current.windowStart <= cutoff ? { windowStart: now, count: 1 } : { ...current, count: current.count + 1 }; shared.set(bucket, next); return { count: next.count }; } }; } }; } };
}

const recipes = [{ recipeId: 'custard', recipeName: 'Custard', recipeYield: '4 servings', ingredients: ['1 cup milk'] }, { recipeId: 'cake', recipeName: 'Cake', recipeYield: '8 slices', ingredients: ['2 eggs'] }];
const normalizedOutput = JSON.stringify([
  { recipeIndex: 0, ingredientIndex: 0, name: 'milk', displayName: 'Whole Milk', countLabel: '', category: 'dairy-eggs', quantity: 8, unit: 'ounce', kind: 'divisible', confidence: .9 },
  { recipeIndex: 1, ingredientIndex: 0, name: 'egg', displayName: 'Eggs', countLabel: '', category: 'dairy-eggs', quantity: 2, unit: 'count', kind: 'indivisible', confidence: .95 },
]);

test('normalization prompt reviews the complete list, converts canonical units, and forbids scaling', () => {
  const messages = buildNormalizationPrompt(recipes);
  assert.match(messages[0].content, /interpret/i);
  assert.match(messages[0].content, /never scale/i);
  assert.match(messages[0].content, /displayName.*countLabel.*category/i);
  assert.match(messages[0].content, /1 cup = 8 ounces/i);
  assert.match(messages[1].content, /Custard/);
  assert.match(messages[1].content, /Cake/);
});

test('LLM output maps back to recipes while raw lines remain server-controlled', () => {
  const parsed = parseNormalizedIngredients(normalizedOutput, recipes);
  assert.equal(parsed[0].recipeId, 'custard');
  assert.equal(parsed[0].ingredients[0].raw, '1 cup milk');
  assert.equal(parsed[1].ingredients[0].name, 'egg');
});

test('malformed AI metadata and duplicate mappings are strictly rejected', () => {
  const base = JSON.parse(normalizedOutput)[0];
  const one = [{ recipeId: 'r', ingredients: ['milk'] }];
  for (const patch of [{ category: 'danger' }, { displayName: '<img>' }, { displayName: 'milk' }, { displayName: '½ Tbsp Rice Vinegar' }, { displayName: 'Ginger )' }, { countLabel: 'items<script>' }, { recipeIndex: 9 }]) {
    assert.equal(parseNormalizedIngredients(JSON.stringify([{ ...base, ...patch }]), one), null);
  }
  assert.equal(parseNormalizedIngredients(JSON.stringify([base, base]), one), null);
});

test('handleNormalize validates whole-set size and returns mapped recipes', async () => {
  const ok = await handleNormalize({ recipes }, { runLLM: async () => normalizedOutput });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.recipes.length, 2);
  assert.equal((await handleNormalize({ recipes: [{ recipeId: 'x', ingredients: Array(101).fill('salt') }] }, { runLLM: async () => '' })).status, 400);
  assert.equal((await handleNormalize({ recipes }, { runLLM: async () => 'not json' })).status, 422);
});

test('authenticated normalize route invokes a supported Workers AI model once for the whole set', async () => {
  let calls = 0;
  let model;
  const res = await onRequestPost({ request: { json: async () => ({ recipes }) }, data: { auth: { email: 'you@example.com' } }, env: { DB: rateDb(), AI: { run: async (requestedModel) => { calls += 1; model = requestedModel; return { response: normalizedOutput }; } } } });
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
  assert.equal(model, '@cf/meta/llama-3.1-8b-instruct-fp8');
});

test('normalize route rate limit is shared and failures are closed', async () => {
  const request = { json: async () => ({ recipes: [recipes[0]] }) };
  const shared = new Map();
  const ai = { run: async () => ({ response: JSON.stringify([JSON.parse(normalizedOutput)[0]]) }) };
  const base = { request, data: { auth: { email: 'rate@example.com' } } };
  assert.equal((await onRequestPost({ ...base, env: { DB: rateDb(shared), NORMALIZE_RATE_PER_MIN: '2', AI: ai } })).status, 200);
  assert.equal((await onRequestPost({ ...base, env: { DB: rateDb(shared), NORMALIZE_RATE_PER_MIN: '2', AI: ai } })).status, 200);
  assert.equal((await onRequestPost({ ...base, env: { DB: rateDb(shared), NORMALIZE_RATE_PER_MIN: '2', AI: ai } })).status, 429);
  assert.equal((await onRequestPost({ request, data: {}, env: { AI: ai } })).status, 401);
  assert.equal((await onRequestPost({ request, data: { auth: { email: 'x@y.z' } }, env: {} })).status, 503);
  assert.equal((await onRequestPost({ request, data: { auth: { email: 'x@y.z' } }, env: { AI: ai } })).status, 503);
});
