import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createWorkspaceOutbox } from '../docs/js/lib/workspace-outbox.js';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';
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
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('mutation publishes before persistence and survives a reload once locally durable', async () => {
  const repo = memoryRepo();
  const order = repo.calls;
  const first = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => false,
    makeId: () => 'offline-1', onChange: () => order.push('publish'),
  });
  assert.equal(await first.mutate('pantry.add', { name: 'flour' }), true);
  assert.deepEqual(order, ['publish', 'persist:offline-1']);
  assert.deepEqual(first.current().pantry.map((item) => item.name), ['flour']);
  const reloaded = await createWorkspaceOutbox({ repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => false });
  assert.deepEqual(reloaded.current().pantry.map((item) => item.name), ['flour']);
});

test('online mutation returns after durable optimistic publication without waiting for D1', async () => {
  const repo = memoryRepo();
  const response = deferred();
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(),
    makeId: () => 'nonblocking-1', send: async () => response.promise,
  });
  const mutation = manager.mutate('pantry.add', { name: 'flour' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
  assert.equal(await Promise.race([
    mutation.then(() => 'resolved'),
    new Promise((resolve) => setTimeout(() => resolve('blocked-on-d1'), 20)),
  ]), 'resolved');
  response.resolve({ ok: true, workspace: base({ revision: 1, pantry: ['flour'] }) });
  assert.equal(await manager.drain(), true);
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
  assert.equal(await manager.mutate('pantry.add', { name: 'flour' }), true);
  assert.equal(await manager.drain(), false);
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
  assert.equal(await manager.mutate('cart.upsertSelection', { selection }), true);
  assert.equal(await manager.drain(), false);
  assert.equal(sends, 1);
  assert.deepEqual(manager.current().cart, [selection]);
  assert.equal(statuses.at(-1).state, 'failed');
  const [row] = await repo.listOutbox();
  await manager.discard(row.sequence);
  assert.deepEqual(manager.current().cart, []);
});

test('discarding a failed mutation immediately drains later workspace work', async () => {
  const repo = memoryRepo();
  let online = false;
  const sent = [];
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: (() => { let i = 0; return () => `discard-${++i}`; })(),
    send: async (request) => {
      sent.push(request.mutationId);
      return request.mutationId === 'discard-1'
        ? { ok: false, status: 400 }
        : { ok: true, workspace: base({ revision: 1, pantry: ['salt'] }) };
    },
  });
  await manager.mutate('pantry.add', { name: 'flour' });
  await manager.mutate('pantry.add', { name: 'salt' });
  online = true;
  assert.equal(await manager.drain(), false);
  const [failed] = await repo.listOutbox();
  assert.equal(await manager.discard(failed.sequence), true);
  assert.deepEqual(sent, ['discard-1', 'discard-2']);
  assert.equal(manager.pending(), 0);
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

test('refresh preserves a mutation persisted after its outbox snapshot', async () => {
  const repo = memoryRepo();
  const listed = deferred();
  const release = deferred();
  const originalList = repo.listOutbox;
  let listCalls = 0;
  repo.listOutbox = async (...args) => {
    listCalls += 1;
    if (listCalls !== 2) return originalList(...args);
    const snapshot = await originalList(...args);
    listed.resolve();
    await release.promise;
    return snapshot;
  };
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => false,
    makeId: () => 'during-refresh',
  });
  const refresh = manager.refresh(base({ revision: 1 }));
  await listed.promise;
  await manager.mutate('pantry.add', { name: 'flour' });
  release.resolve();
  await refresh;
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
  assert.equal(manager.pending(), 1);
  assert.equal((await originalList()).length, 1);
});

test('refresh cannot resurrect a mutation acknowledged after its outbox snapshot', async () => {
  const repo = memoryRepo();
  let online = false;
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: () => 'ack-during-refresh',
    send: async () => ({ ok: true, workspace: base({ revision: 2, pantry: ['flour'] }) }),
  });
  await manager.mutate('pantry.add', { name: 'flour' });
  const listed = deferred();
  const release = deferred();
  const originalList = repo.listOutbox;
  let pauseNextList = true;
  repo.listOutbox = async (...args) => {
    const snapshot = await originalList(...args);
    if (!pauseNextList) return snapshot;
    pauseNextList = false;
    listed.resolve();
    await release.promise;
    return snapshot;
  };

  const refresh = manager.refresh(base({ revision: 1 }));
  await listed.promise;
  online = true;
  assert.equal(await manager.drain(), true);
  release.resolve();
  await refresh;

  assert.equal(manager.pending(), 0);
  assert.deepEqual(await originalList(), []);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
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
  assert.equal(await manager.drain(), true);
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

test('offline pantry.update replays by stable ID and converges after reload', async () => {
  const initial = base({ pantry: ['to 4 basil leaves'] });
  const repo = memoryRepo(initial);
  let online = false;
  const sent = [];
  let manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial, isOnline: () => online,
    makeId: () => 'edit-basil', send: async (request) => {
      sent.push(request);
      const workspace = applyWorkspaceOperation(base({ revision: 1, pantry: ['to 4 basil leaves'] }), request);
      return { ok: true, workspace: { ...workspace, revision: 2 } };
    },
  });
  const target = manager.current().pantry[0];
  await manager.mutate('pantry.update', { id: target.id, item: {
    raw: '4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
    quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.95,
  } });
  manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial, isOnline: () => online,
    send: async (request) => {
      sent.push(request);
      const workspace = applyWorkspaceOperation(base({ revision: 1, pantry: ['to 4 basil leaves'] }), request);
      return { ok: true, workspace: { ...workspace, revision: 2 } };
    },
  });
  assert.equal(manager.current().pantry[0].id, target.id);
  assert.equal(manager.current().pantry[0].amountState, 'known');
  online = true;
  assert.equal(await manager.drain(), true);
  assert.equal(sent[0].payload.id, target.id);
  assert.equal(manager.current().pantry[0].id, target.id);
  assert.equal(manager.current().pantry[0].amountState, 'known');
});

test('concurrent remote Pantry edit blocks local update replay instead of overwriting it', async () => {
  const initial = base({ revision: 1, pantry: ['to 4 basil leaves'] });
  const repo = memoryRepo(initial);
  let online = false;
  const statuses = [];
  let sends = 0;
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial, isOnline: () => online,
    makeId: () => 'local-edit', onStatus: (status) => statuses.push(status),
    send: async () => {
      sends += 1;
      const targetId = manager.current().pantry[0].id;
      const remote = applyWorkspaceOperation(initial, {
        op: 'pantry.update', createdAt: 400, payload: {
          id: targetId,
          item: {
            raw: '6 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
            quantity: 6, unit: 'count', kind: 'indivisible', confidence: 0.95,
          },
        },
      });
      return { ok: false, status: 409, workspace: { ...remote, revision: 2 } };
    },
  });
  const target = manager.current().pantry[0];
  await manager.mutate('pantry.update', { id: target.id, item: {
    raw: '4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
    quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.95,
  } });
  online = true;
  assert.equal(await manager.drain(), false);
  assert.equal(sends, 1, 'pantry.update is not blindly rebased over another member edit');
  assert.equal(manager.pending(), 1);
  assert.equal(statuses.at(-1).code, 'revision_conflict');
});

test('remote Pantry removal blocks an offline update without crashing replay', async () => {
  const initial = base({ revision: 1, pantry: ['to 4 basil leaves'] });
  const repo = memoryRepo(initial);
  let online = false;
  const statuses = [];
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial, isOnline: () => online,
    makeId: () => 'edit-removed', onStatus: (status) => statuses.push(status),
    send: async () => ({ ok: false, status: 409, workspace: base({ revision: 2, pantry: [] }) }),
  });
  const target = manager.current().pantry[0];
  await manager.mutate('pantry.update', { id: target.id, item: {
    ...target, raw: '4 basil leaves', quantity: 4, unit: 'count', confidence: 0.95,
  } });
  online = true;
  assert.equal(await manager.drain(), false);
  assert.equal(manager.pending(), 1);
  assert.deepEqual(manager.current().pantry, [], 'remote deletion remains visible while the failed edit awaits discard');
  assert.equal(statuses.at(-1).code, 'revision_conflict');
});
