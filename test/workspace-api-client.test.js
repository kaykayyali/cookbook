import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../docs/js/lib/api.js';

const valid = {
  householdId: 'our-home', revision: 2, plan: [], cart: [], pantry: [],
  shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 10,
};

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('fetchWorkspace accepts only a complete authoritative workspace', async () => {
  const ok = await api.fetchWorkspace({ request: async (path) => {
    assert.equal(path, '/workspace');
    return response(200, valid);
  } });
  assert.deepEqual(ok, { ok: true, workspace: valid });
  const malformed = await api.fetchWorkspace({ request: async () => response(200, { revision: 2 }) });
  assert.deepEqual(malformed, { ok: false, error: 'invalid_workspace' });
});

test('mutateWorkspace marks thrown transport as status-zero unknown delivery', async () => {
  const result = await api.mutateWorkspace({
    mutationId: 'unknown-m1', baseRevision: 1, op: 'pantry.add', payload: { name: 'flour' },
  }, { request: async () => { throw new Error('connection reset after upload'); } });

  assert.deepEqual(result, { ok: false, status: 0, error: 'workspace_unavailable' });
});

test('mutateWorkspace returns conflict authority for one client rebase', async () => {
  const conflict = await api.mutateWorkspace({
    mutationId: 'm1', baseRevision: 1, op: 'pantry.add', payload: { name: 'flour' },
  }, { request: async (path, init) => {
    assert.equal(path, '/workspace');
    assert.equal(init.method, 'PATCH');
    assert.equal(JSON.parse(init.body).mutationId, 'm1');
    return response(409, { error: 'revision_conflict', workspace: valid });
  } });
  assert.deepEqual(conflict, { ok: false, status: 409, error: 'revision_conflict', workspace: valid });
});
