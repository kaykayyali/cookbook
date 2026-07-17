import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createWorkspaceOutbox } from '../docs/js/lib/workspace-outbox.js';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { PANTRY_RAW_EVIDENCE_LIMITS } from '../docs/js/lib/pantry.js';

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

test('a deterministic mutation-ID collision restores the pre-existing durable optimistic row', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  await repo.enqueue({
    mutationId: 'collision', authSub: 'cook-1', householdId: 'our-home', scope: 'workspace',
    op: 'pantry.add', payload: { name: 'flour' }, createdAt: 1,
  });
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => false,
    makeId: () => 'collision',
  });

  assert.equal(await manager.mutate('pantry.add', { name: 'salt' }), false);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour'],
    'the failed provisional row cannot erase the durable row with the same ID');
  assert.deepEqual((await repo.listOutbox('cook-1', 'our-home')).map((row) => row.mutationId), ['collision']);
  repo.close();
});

test('a concurrent persistence collision reloads the winning durable row atomically', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const releaseSecond = deferred();
  const secondAttempted = deferred();
  let online = false;
  const statuses = [];
  const secondRepo = {
    ...repo,
    enqueue: async (row) => {
      secondAttempted.resolve();
      await releaseSecond.promise;
      return repo.enqueue(row);
    },
  };
  const winner = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => false,
    makeId: () => 'raced-id',
  });
  const loser = await createWorkspaceOutbox({
    repo: secondRepo, authSub: 'cook-1', householdId: 'our-home', initial: base(),
    isOnline: () => online, makeId: () => 'raced-id', onStatus: (value) => statuses.push(value),
    send: async () => ({ ok: false, status: 400 }),
  });

  const losingMutation = loser.mutate('pantry.add', { name: 'salt' });
  await secondAttempted.promise;
  assert.equal(await winner.mutate('pantry.add', { name: 'flour' }), true);
  releaseSecond.resolve();
  assert.equal(await losingMutation, false);
  assert.deepEqual(loser.current().pantry.map((item) => item.name), ['flour']);
  assert.deepEqual((await repo.listOutbox('cook-1', 'our-home')).map((row) => row.payload.name), ['flour']);

  online = true;
  assert.equal(await loser.drain(), false);
  const [durable] = await repo.listOutbox('cook-1', 'our-home');
  assert.equal(statuses.at(-1).discardable, false,
    'a row recovered from another runtime remains retry-only after a later rejection');
  assert.equal(await loser.discard(durable.sequence), false);
  assert.equal(loser.pending(), 1);
  repo.close();
});

test('raw Pantry evidence survives durable optimistic replay without duplication', async () => {
  const initial = base({ pantry: ['eggs'] });
  const repo = memoryRepo(initial);
  let manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial, isOnline: () => false,
    makeId: () => 'add-eggs',
  });
  assert.equal(await manager.mutate('pantry.add', { item: {
    raw: '3 eggs', name: 'egg', quantity: 3, unit: 'count', kind: 'indivisible',
  } }), true);
  assert.deepEqual(manager.current().pantry[0].rawEvidence, ['eggs', '3 eggs']);

  manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial, isOnline: () => false,
  });
  assert.equal(manager.current().pantry[0].raw, '3 eggs');
  assert.deepEqual(manager.current().pantry[0].rawEvidence, ['eggs', '3 eggs']);
});

test('durable outbox stores and sends only bounded Pantry evidence payloads', async () => {
  const repo = memoryRepo();
  let online = false;
  let sent;
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(),
    isOnline: () => online, makeId: () => 'bounded-evidence',
    send: async (request) => {
      sent = request;
      return { ok: true, workspace: base({ revision: 1, pantry: [request.payload.item] }) };
    },
  });
  const rawEvidence = [
    'eggs', ...Array.from({ length: 220 }, (_, index) => `queued-${index}-eggs`),
    '🥚'.repeat(60_000), '3 eggs',
  ];
  assert.equal(await manager.mutate('pantry.add', { item: {
    raw: '3 eggs', rawEvidence, name: 'egg', displayName: 'Egg',
    quantity: 3, unit: 'count', kind: 'indivisible',
  } }), true);

  const [durable] = await repo.listOutbox();
  assert.equal(durable.payload.item.raw, '3 eggs');
  assert.ok(durable.payload.item.rawEvidence.length <= PANTRY_RAW_EVIDENCE_LIMITS.maxEntries);
  assert.ok(new TextEncoder().encode(JSON.stringify(durable)).length < 10_000,
    'the durable mutation remains safely below the 50k workspace API cap');

  online = true;
  assert.equal(await manager.drain(), true);
  assert.ok(new TextEncoder().encode(JSON.stringify(sent)).length < 10_000);
  assert.equal(sent.payload.item.raw, '3 eggs');
  assert.deepEqual(manager.current().pantry[0].rawEvidence, sent.payload.item.rawEvidence,
    'authority acknowledgement and replay preserve the same bounded evidence');
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
  const sendStarted = deferred();
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: () => 'ack-during-refresh',
    send: async () => {
      sendStarted.resolve();
      return { ok: true, workspace: base({ revision: 2, pantry: ['flour'] }) };
    },
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
  const draining = manager.drain();
  await sendStarted.promise;
  release.resolve();
  await refresh;
  assert.equal(await draining, true);

  assert.equal(manager.pending(), 0);
  assert.deepEqual(await originalList(), []);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
});

test('refresh authority persistence is serialized before a newer acknowledgement', async () => {
  const repo = memoryRepo();
  let online = false;
  const refreshWriteStarted = deferred();
  const releaseRefreshWrite = deferred();
  const originalPutWorkspace = repo.putWorkspace;
  const originalAcknowledge = repo.acknowledge;
  let acknowledgementStarted = false;
  repo.putWorkspace = async (...args) => {
    if (args[2].revision === 1) {
      refreshWriteStarted.resolve();
      await releaseRefreshWrite.promise;
    }
    return originalPutWorkspace(...args);
  };
  repo.acknowledge = async (...args) => {
    acknowledgementStarted = true;
    return originalAcknowledge(...args);
  };
  const sendStarted = deferred();
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: () => 'serialized-ack',
    send: async () => {
      sendStarted.resolve();
      return { ok: true, workspace: base({ revision: 2, pantry: ['flour'] }) };
    },
  });
  await manager.mutate('pantry.add', { name: 'flour' });

  const refresh = manager.refresh(base({ revision: 1 }));
  await refreshWriteStarted.promise;
  online = true;
  const draining = manager.drain();
  await sendStarted.promise;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(acknowledgementStarted, false, 'acknowledgement waits for the older refresh cache write');
  releaseRefreshWrite.resolve();
  assert.equal(await refresh, true);
  assert.equal(await draining, true);
  assert.equal((await repo.getWorkspace()).revision, 2);
  assert.equal(manager.current().revision, 2);
});

test('discard revalidates delivery safety inside the authority mutex before deleting', async () => {
  const repo = memoryRepo();
  let online = false;
  const refreshWriteStarted = deferred();
  const releaseRefreshWrite = deferred();
  const sendStarted = deferred();
  const response = deferred();
  const originalPutWorkspace = repo.putWorkspace;
  repo.putWorkspace = async (...args) => {
    if (args[2].revision === 1) {
      refreshWriteStarted.resolve();
      await releaseRefreshWrite.promise;
    }
    return originalPutWorkspace(...args);
  };
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: () => 'discard-toctou',
    send: async () => {
      sendStarted.resolve();
      return response.promise;
    },
  });
  await manager.mutate('pantry.add', { name: 'flour' });
  const [pending] = await repo.listOutbox();

  const refresh = manager.refresh(base({ revision: 1 }));
  await refreshWriteStarted.promise;
  const discarded = manager.discard(pending.sequence);
  online = true;
  const draining = manager.drain();
  await sendStarted.promise;
  response.resolve({ ok: true, workspace: base({ revision: 2, pantry: ['flour'] }) });
  await Promise.resolve();
  await Promise.resolve();
  releaseRefreshWrite.resolve();

  assert.equal(await refresh, true);
  assert.equal(await discarded, false, 'an accepted row cannot be deleted by an earlier queued discard');
  assert.equal(await draining, true);
  assert.equal((await repo.getWorkspace()).revision, 2);
  assert.deepEqual(await repo.listOutbox(), []);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
});

test('accepted workspace mutation survives acknowledgement persistence failure and retries safely', async () => {
  const repo = memoryRepo();
  let online = false;
  let failAcknowledgement = true;
  const statuses = [];
  const sent = [];
  const originalAcknowledge = repo.acknowledge;
  repo.acknowledge = async (...args) => {
    if (failAcknowledgement) {
      failAcknowledgement = false;
      throw new Error('ack_failed');
    }
    return originalAcknowledge(...args);
  };
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: () => 'accepted-on-server', onStatus: (value) => statuses.push(value),
    send: async ({ mutationId }) => {
      sent.push(mutationId);
      return { ok: true, workspace: base({ revision: 1, pantry: ['flour'] }) };
    },
  });
  await manager.mutate('pantry.add', { name: 'flour' });
  const [pending] = await repo.listOutbox();
  online = true;

  assert.equal(await manager.drain(), false, 'background-safe drain contains acknowledgement failures');
  assert.deepEqual(statuses.at(-1), {
    state: 'failed', pending: 1, sequence: pending.sequence,
    code: 'local_acknowledgement_failed', discardable: false,
  });
  const durable = (await repo.listOutbox())[0];
  assert.equal(durable.status, 'pending', 'durable row remains actionable, not stranded sending');
  assert.equal(durable.deliveryState, 'accepted', 'server acceptance remains durable until atomic acknowledgement succeeds');
  assert.equal(await manager.discard(pending.sequence), false, 'an accepted server mutation cannot be rolled back locally');
  assert.equal(await manager.retry(pending.sequence), true);
  assert.deepEqual(sent, ['accepted-on-server', 'accepted-on-server']);
  assert.equal((await repo.getWorkspace()).revision, 1);
  assert.deepEqual(await repo.listOutbox(), []);
});

test('durable accepted marker survives restart and a later permanent response', async () => {
  const repo = memoryRepo();
  let online = false;
  const sent = [];
  repo.acknowledge = async () => { throw new Error('ack_failed'); };
  const first = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: () => 'accepted-before-restart',
    send: async ({ mutationId }) => {
      sent.push(mutationId);
      return { ok: true, workspace: base({ revision: 1, pantry: ['flour'] }) };
    },
  });
  await first.mutate('pantry.add', { name: 'flour' });
  online = true;
  assert.equal(await first.drain(), false);
  assert.equal((await repo.listOutbox())[0].deliveryState, 'accepted');

  const statuses = [];
  const restarted = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    onStatus: (value) => statuses.push(value),
    send: async ({ mutationId }) => {
      sent.push(mutationId);
      return { ok: false, status: 401, error: 'authentication_required' };
    },
  });
  const [pending] = await repo.listOutbox();
  assert.equal(await restarted.drain(), false);

  const [durable] = await repo.listOutbox();
  assert.deepEqual(sent, ['accepted-before-restart', 'accepted-before-restart']);
  assert.equal(durable.deliveryState, 'accepted', 'later errors cannot downgrade known server acceptance');
  assert.deepEqual(statuses.at(-1), {
    state: 'failed', pending: 1, sequence: pending.sequence,
    code: 'authentication_required', discardable: false,
  });
  assert.equal(await restarted.discard(pending.sequence), false);
  assert.equal(restarted.pending(), 1);
});

test('status zero keeps unknown workspace delivery retry-only and cannot discard reconciliation intent', async () => {
  const repo = memoryRepo();
  let online = false;
  const statuses = [];
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => online,
    makeId: () => 'unknown-delivery', onStatus: (value) => statuses.push(value),
    send: async () => ({ ok: false, status: 0, error: 'workspace_unavailable' }),
  });
  await manager.mutate('pantry.add', { name: 'flour' });
  const [pending] = await repo.listOutbox();
  online = true;

  assert.equal(await manager.drain(), false);
  assert.deepEqual(statuses.at(-1), {
    state: 'offline', pending: 1, sequence: pending.sequence,
    code: 'workspace_unavailable', discardable: false,
  });
  assert.equal(await manager.discard(pending.sequence), false);
  assert.equal(manager.pending(), 1);
  const [durable] = await repo.listOutbox();
  assert.equal(durable.deliveryState, 'uncertain');
});

test('background drain contains outbox enumeration failure and reports retry-only durable work', async () => {
  const repo = memoryRepo();
  const originalList = repo.listOutbox;
  let listCalls = 0;
  repo.listOutbox = async (...args) => {
    listCalls += 1;
    if (listCalls > 1) throw new Error('indexeddb_enumeration_failed');
    return originalList(...args);
  };
  const statuses = [];
  const manager = await createWorkspaceOutbox({
    repo, authSub: 'cook-1', householdId: 'our-home', initial: base(), isOnline: () => true,
    makeId: () => 'enumeration-failure', onStatus: (value) => statuses.push(value),
    send: async () => { throw new Error('transport must not run when enumeration fails'); },
  });

  assert.equal(await manager.mutate('pantry.add', { name: 'flour' }), true);
  assert.equal(await manager.drain(), false, 'the shared background drain boundary contains enumeration rejection');
  const [durable] = await originalList();
  assert.equal(durable.mutationId, 'enumeration-failure');
  assert.equal(manager.pending(), 1);
  assert.deepEqual(manager.current().pantry.map((item) => item.name), ['flour']);
  assert.deepEqual(statuses.at(-1), {
    state: 'failed', pending: 1, sequence: durable.sequence,
    code: 'local_storage_unavailable', discardable: false,
  });
  assert.equal(await manager.discard(durable.sequence), false);
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
