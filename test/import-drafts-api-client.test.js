import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchImportDrafts, createImportDraft, patchImportDraft } from '../docs/js/lib/api.js';

const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('fetchImportDrafts validates the drafts envelope', async () => {
  const ok = await fetchImportDrafts({ request: async () => response(200, { drafts: [] }) });
  const invalid = await fetchImportDrafts({ request: async () => response(200, { drafts: 'nope' }) });
  const err = await fetchImportDrafts({ request: async () => response(500, {}) });
  assert.deepEqual(ok, { ok: true, drafts: [] });
  assert.equal(invalid.ok, false);
  assert.equal(err.ok, false);
});

test('createImportDraft sends authenticated POST and returns draft on success', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return response(201, { id: 'd1', status: 'pending', imageRefs: ['p.png'] });
  };
  const result = await createImportDraft({ imageRefs: ['p.png'], sourceType: 'image' }, { request });
  assert.equal(result.ok, true);
  assert.equal(result.draft.id, 'd1');
  assert.equal(calls[0].url, '/import-drafts');
  assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.imageRefs, ['p.png']);
});

test('patchImportDraft sends action and payload via PATCH', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'PATCH') return response(200, { status: 'confirmed', recipeId: 'r1' });
    return response(201, { id: 'd1' });
  };
  const result = await patchImportDraft('d1', 'confirm', { recipe: { name: 'Soup' } }, { request });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.recipeId, 'r1');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.id, 'd1');
  assert.equal(body.action, 'confirm');
  assert.equal(body.recipe.name, 'Soup');
});

test('createImportDraft handles server error gracefully', async () => {
  const result = await createImportDraft({ imageRefs: ['p.png'] }, {
    request: async () => response(400, { error: 'invalid_draft_input' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_draft_input');
});