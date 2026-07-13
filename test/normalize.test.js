import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNormalizationPrompt,
  parseNormalizedIngredients,
  handleNormalize,
} from '../functions/_lib/normalize.js';
import { onRequestPost } from '../functions/api/normalize.js';

function rateDb(shared = new Map()) {
  return {
    prepare(sql) {
      if (/CREATE TABLE/i.test(sql)) return { run: async () => ({ success: true }) };
      return {
        bind(bucket, now, cutoff) {
          return {
            first: async () => {
              const current = shared.get(bucket);
              const next = !current || current.windowStart <= cutoff
                ? { windowStart: now, count: 1 }
                : { ...current, count: current.count + 1 };
              shared.set(bucket, next);
              return { count: next.count };
            },
          };
        },
      };
    },
  };
}

test('normalization prompt includes recipe context but limits AI to interpretation', () => {
  const messages = buildNormalizationPrompt(['1 cup milk'], { recipeName: 'Custard', recipeYield: '4 servings' });
  assert.match(messages[0].content, /interpret/i);
  assert.match(messages[0].content, /do not scale|never scale/i);
  assert.match(messages[0].content, /count.*ounce.*qualitative/i);
  assert.match(messages[0].content, /singular.*grocery name|canonical grocery name/i);
  assert.match(messages[0].content, /remove.*preparation|ignore.*preparation/i);
  assert.match(messages[1].content, /Custard/);
  assert.match(messages[1].content, /4 servings/);
  assert.match(messages[0].content, /confidence/i);
});

test('LLM normalization output is strictly validated and raw input is server-controlled', () => {
  const output = JSON.stringify([{ name: 'Eggs', quantity: 12, unit: 'count', kind: 'indivisible', confidence: 0.98 }]);
  assert.deepEqual(parseNormalizedIngredients(output, ['1 dozen eggs']), [{
    raw: '1 dozen eggs', name: 'egg', quantity: 12, unit: 'count', kind: 'indivisible', confidence: 0.98,
  }]);
  assert.equal(parseNormalizedIngredients('[{"name":"milk","quantity":1,"unit":"liters"}]', ['milk']), null);
  assert.equal(parseNormalizedIngredients('[{"name":"milk","quantity":-1,"unit":"ounce"}]', ['milk']), null);
  assert.equal(parseNormalizedIngredients('[]', ['milk']), null);
  assert.equal(parseNormalizedIngredients('[{"name":"milk","quantity":1,"unit":"ounce","kind":"divisible","confidence":2}]', ['milk']), null);
});

test('handleNormalize returns validated interpretation and rejects bad AI output', async () => {
  const ok = await handleNormalize({ ingredients: ['2 eggs'], recipeName: 'Eggs', recipeYield: '2 servings' }, { runLLM: async () => '[{"name":"egg","quantity":2,"unit":"count","kind":"indivisible","confidence":0.9}]' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ingredients[0].raw, '2 eggs');
  const bad = await handleNormalize({ ingredients: ['2 eggs'] }, { runLLM: async () => 'not json' });
  assert.equal(bad.status, 422);
});

test('authenticated normalize route invokes Workers AI', async () => {
  let called = false;
  const res = await onRequestPost({
    request: { json: async () => ({ ingredients: ['2 eggs'], recipeName: 'Eggs', recipeYield: '2 servings' }) },
    data: { auth: { email: 'you@example.com' } },
    env: { DB: rateDb(), AI: { run: async () => { called = true; return { response: '[{"name":"egg","quantity":2,"unit":"count","kind":"indivisible","confidence":0.9}]' }; } } },
  });
  assert.equal(res.status, 200);
  assert.equal(called, true);
});

test('normalize route rate limit is shared across independent Worker instances', async () => {
  const request = { json: async () => ({ ingredients: ['2 eggs'] }) };
  const shared = new Map();
  const base = {
    request,
    data: { auth: { email: 'rate-limit@example.com' } },
  };
  const ai = { run: async () => ({ response: '[{"name":"egg","quantity":2,"unit":"count","kind":"indivisible","confidence":0.9}]' }) };
  const firstInstance = { ...base, env: { DB: rateDb(shared), NORMALIZE_RATE_PER_MIN: '2', AI: ai } };
  const secondInstance = { ...base, env: { DB: rateDb(shared), NORMALIZE_RATE_PER_MIN: '2', AI: ai } };
  assert.equal((await onRequestPost(firstInstance)).status, 200);
  assert.equal((await onRequestPost(secondInstance)).status, 200);
  assert.equal((await onRequestPost(firstInstance)).status, 429);
});

test('normalize route fails closed when the durable rate-limit store is unavailable', async () => {
  let called = false;
  const response = await onRequestPost({
    request: { json: async () => ({ ingredients: ['2 eggs'] }) },
    data: { auth: { email: 'x@y.z' } },
    env: { AI: { run: async () => { called = true; return ''; } } },
  });
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test('normalize route rejects missing auth and unavailable AI', async () => {
  const request = { json: async () => ({ ingredients: ['2 eggs'] }) };
  assert.equal((await onRequestPost({ request, data: {}, env: { AI: { run: async () => '' } } })).status, 401);
  assert.equal((await onRequestPost({ request, data: { auth: { email: 'x@y.z' } }, env: {} })).status, 503);
});
