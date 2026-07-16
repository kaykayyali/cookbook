import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createWorkspaceOutbox } from '../docs/js/lib/workspace-outbox.js';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';

const base = (overrides = {}) => ({
  householdId: 'our-home', revision: 0, plan: [], cart: [], pantry: [], shoppingChecked: {},
  manualItems: [], recentMutations: [], updatedAt: 0, ...overrides,
});

function memoryRepo(authority = base()) {
  let rows = [];
  let cached = authority;
  let sequence = 0;
  const calls = [];
  return {
    calls,
    getWorkspace: async () => structuredClone(cached),
    putWorkspace: async (_sub, _home, value) => { cached = structuredClone(value); calls.push('cache'); },
    enqueue: async (row) => { calls.push(`persist:${row.mutationId}`); const saved = { ...structuredClone(row), sequence: ++sequence, status: 'pending', attempts: 0 }; rows.push(saved); return structuredClone(saved); },
    listOutbox: async () => structuredClone(rows).sort((a, b) => a.sequence - b.sequence),
    updateOutbox: async (row) => { rows = rows.map((item) => item.sequence === row.sequence ? structuredClone(row) : item); },
    deleteOutbox: async (seq) => { rows = rows.filter((row) => row.sequence !== seq); },
    acknowledge: async (_sub, _home, mutationId, value) => {
      cached = structuredClone(value);
      rows = rows.filter((row) => row.mutationId !== mutationId);
      calls.push(`ack:${mutationId}`);
    },
  };
}

const dbName = () => `cookbook-workspace-outbox-${Date.now()}-${Math.random()}`;
const availableLocks = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

test('mutation persists before optimistic publication and survives a reload', async () => {
  const repo = memoryRepo();
  const order = repo.calls;
  const first = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => false,
    makeId: () => 'offline-1', onChange: () => order.push('publish'),
  });
  assert.equal(await first.mutate('pantry.add', { name: 'flour' }), true);
  assert.deepEqual(order.slice(-2), ['persist:offline-1', 'publish']);
  assert.deepEqual(first.current().pantry.map((item) => item.name), ['flour']);
  const reloaded = await createWorkspaceOutbox({ repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => false });
  assert.deepEqual(reloaded.current().pantry.map((item) => item.name), ['flour']);
});

test('pending mutations replay in sequence and acknowledge one-by-one', async () => {
  const repo = memoryRepo();
  let online = false;
  const sent = [];
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: (() => { let i = 0; return () => `m${++i}`; })(),
    send: async (request) => {
      sent.push(request);
      const pantry = request.op === 'pantry.add' ? [...(sent.length === 1 ? [] : ['flour']), request.payload.name] : [];
      return { ok: true, workspace: base({ revision: sent.length, pantry }) };
    },
  });
  await manager.mutate('pantry.add', { name: 'flour' });
  await manager.mutate('pantry.add', { name: 'salt' });
  online = true;
  assert.equal(await manager.drain(), true);
  assert.deepEqual(sent.map((row) => row.mutationId), ['m1', 'm2']);
  assert.deepEqual(sent.map((row) => row.baseRevision), [0, 1]);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour', 'salt']);
  assert.deepEqual(await repo.listOutbox(), []);
});

test('network failure retains stable mutation intent and retry sends the same ID', async () => {
  const repo = memoryRepo();
  let attempts = 0;
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => true,
    makeId: () => 'stable-id',
    send: async (request) => {
      attempts += 1;
      if (attempts === 1) throw new Error('network details must stay private');
      assert.equal(request.mutationId, 'stable-id');
      return { ok: true, workspace: base({ revision: 1, pantry: ['flour'] }) };
    },
  });
  assert.equal(await manager.mutate('pantry.add', { name: 'flour' }), false);
  assert.equal((await repo.listOutbox())[0].mutationId, 'stable-id');
  assert.equal(await manager.retry((await repo.listOutbox())[0].sequence), true);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
});

test('remote destructive conflict blocks constructive replay until retry or discard', async () => {
  const selection = { recipeId: 'r1', sourceServings: 2, targetServings: 2, ingredients: [] };
  const repo = memoryRepo(base({ cart: [selection] }));
  const statuses = [];
  let sends = 0;
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base({ cart: [selection] }),
    isOnline: () => true, makeId: () => 'stale-add', onStatus: (status) => statuses.push(status),
    send: async () => { sends += 1; return { ok: false, status: 409, workspace: base({ revision: 1, cart: [] }) }; },
  });
  assert.equal(await manager.mutate('cart.upsertSelection', { selection }), false);
  assert.equal(sends, 1);
  assert.deepEqual(manager.current().cart, [selection]);
  assert.equal(statuses.at(-1).state, 'failed');
  const [row] = await repo.listOutbox();
  await manager.discard(row.sequence);
  assert.deepEqual(manager.current().cart, []);
});

test('offline launch reports durable queue status immediately', async () => {
  const repo = memoryRepo(base());
  const statuses = [];
  await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(),
    isOnline: () => false, send: async () => { throw new Error('must not send'); },
    onStatus: (value) => statuses.push(value),
  });
  assert.equal(statuses[0].state, 'offline');
  assert.equal(statuses[0].pending, 0);
});

test('real IndexedDB repository exposes a newly persisted workspace mutation to the same drain', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const sent = [];
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), locks: availableLocks,
    makeId: () => 'persisted-v2',
    send: async (request) => {
      sent.push(request);
      return { ok: true, workspace: base({ revision: 1, pantry: ['flour'] }) };
    },
  });

  assert.equal(await manager.mutate('pantry.add', { name: 'flour' }), true);
  assert.deepEqual(sent.map(({ mutationId, op, baseRevision }) => ({ mutationId, op, baseRevision })), [
    { mutationId: 'persisted-v2', op: 'pantry.add', baseRevision: 0 },
  ]);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
  assert.deepEqual(await repo.listOutbox('cook-1', 'our-home'), []);
  repo.close();
});

test('real IndexedDB repository replays a workspace mutation stranded with schema version 1', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  await repo.rawPut('outbox', {
    schemaVersion: 1, mutationId: 'stranded-v1', authSub: 'cook-1', householdId: 'our-home',
    scope: 'workspace', op: 'pantry.add', payload: { name: 'salt' }, createdAt: 1,
    status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null,
  });
  const sent = [];
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), locks: availableLocks,
    send: async (request) => {
      sent.push(request);
      return { ok: true, workspace: base({ revision: 1, pantry: ['salt'] }) };
    },
  });

  assert.equal(await manager.drain(), true);
  assert.deepEqual(sent.map(({ mutationId }) => mutationId), ['stranded-v1']);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['salt']);
  assert.deepEqual(await repo.listOutbox('cook-1', 'our-home'), []);
  repo.close();
});
