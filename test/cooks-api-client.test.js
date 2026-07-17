import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctCookHistory, deleteCookHistory, fetchCookHistory, markCooked, saveCookReaction, sendRecipeMutation,
} from '../docs/js/lib/api.js';

const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('cook-history client validates the shared history envelope', async () => {
  const ok = await fetchCookHistory({ request: async () => response(200, { events: [], reactions: [] }) });
  const invalid = await fetchCookHistory({ request: async () => response(200, { events: {} }) });
  assert.deepEqual(ok, { ok: true, events: [], reactions: [] });
  assert.equal(invalid.ok, false);
});

test('mark-cooked and reaction clients send bounded authenticated JSON', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return response(url === '/cooks' && options.method === 'POST' ? 201 : 200,
      options.method === 'POST' ? { event: { id: 'e1' } } : { reaction: { memberSub: 'kay' } });
  };
  assert.equal((await markCooked({ eventId: 'e1' }, { request })).ok, true);
  assert.equal((await saveCookReaction('e1', { reaction: 'loved' }, { request })).ok, true);
  assert.deepEqual(calls.map((call) => [call.url, call.options.method]), [['/cooks', 'POST'], ['/cooks', 'PATCH']]);
  assert.equal(JSON.parse(calls[1].options.body).eventId, 'e1');
});

test('cook mutation clients preserve HTTP failure status for outbox recovery', async () => {
  const request = async (_url, options) => response(
    options.method === 'POST' ? 409 : 400,
    { error: options.method === 'POST' ? 'workspace_revision_conflict' : 'invalid_reaction' },
  );
  assert.deepEqual(await markCooked({ eventId: 'e1' }, { request }), {
    ok: false, status: 409, error: 'workspace_revision_conflict',
  });
  assert.deepEqual(await saveCookReaction('e1', { tasteRating: 6 }, { request }), {
    ok: false, status: 400, error: 'invalid_reaction',
  });
});

test('recipe mutation transport preserves the durable mutation envelope', async () => {
  let captured;
  const result = await sendRecipeMutation({ mutationId: 'stable', op: 'recipe.delete', payload: { id: 'r1' } }, {
    request: async (url, options) => { captured = { url, options }; return response(200, { recipes: [] }); },
  });
  assert.equal(result.ok, true);
  assert.equal(captured.url, '/recipe-mutations');
  assert.equal(JSON.parse(captured.options.body).mutationId, 'stable');
});

test('history correction and deletion preserve event revision contracts', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return response(200, { event: { id: 'e1', revision: 2 } });
  };
  assert.equal((await correctCookHistory({ eventId: 'e1', eventRevision: 1, servings: 4 }, { request })).ok, true);
  assert.equal((await deleteCookHistory('e1', 2, { request })).ok, true);
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [['/cooks', 'PATCH'], ['/cooks', 'DELETE']]);
  assert.equal(JSON.parse(calls[0].options.body).action, 'correct');
  assert.deepEqual(JSON.parse(calls[1].options.body), { eventId: 'e1', eventRevision: 2 });
});
