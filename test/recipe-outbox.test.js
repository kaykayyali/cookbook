import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { createRecipeOutbox } from '../docs/js/lib/recipe-outbox.js';

const dbName = () => `recipe-outbox-${Date.now()}-${Math.random()}`;
const recipe = { id: 'local-r1', _id: 'local-r1', name: 'Offline soup', recipeIngredient: ['tomato'] };

test('online recipe mutation returns after IndexedDB publication without waiting for D1', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let resolveSend;
  const response = new Promise((resolve) => { resolveSend = resolve; });
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [],
    send: async () => response,
  });
  await manager.init();
  const mutation = manager.mutate('recipe.create', { id: recipe.id, item: recipe });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manager.current()[0].name, 'Offline soup');
  assert.equal(await Promise.race([
    mutation.then(() => 'resolved'),
    new Promise((resolve) => setTimeout(() => resolve('blocked-on-d1'), 20)),
  ]), 'resolved');
  resolveSend({ ok: true, recipes: [{ ...recipe, name: 'Authoritative soup' }] });
  assert.equal(await manager.drain(), true);
  repo.close();
});

test('recipe create persists before optimistic publication and reconstructs after reload', async () => {
  const name = dbName();
  let repo = await openOfflineDb({ indexedDB, name });
  const first = createRecipeOutbox({ repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => false, send: async () => { throw new Error('offline'); } });
  await first.init();
  await first.mutate('recipe.create', { id: recipe.id, recipe, item: recipe });
  assert.equal(first.current()[0].name, 'Offline soup');
  assert.equal((await repo.listOutbox('kay', 'our-home', 'recipe')).length, 1);
  repo.close();

  repo = await openOfflineDb({ indexedDB, name });
  const second = createRecipeOutbox({ repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => false });
  await second.init();
  assert.equal(second.current()[0].id, 'local-r1');
  repo.close();
});

test('reconnect acknowledges recipe intent only after authoritative reconciliation', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  const sent = [];
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => online,
    send: async (request) => { sent.push(request); return { ok: true, recipes: [{ ...recipe, name: 'Authoritative soup' }] }; },
  });
  await manager.init();
  await manager.mutate('recipe.create', { id: recipe.id, recipe, item: recipe });
  online = true;
  assert.equal(await manager.drain(), true);
  assert.equal(sent[0].mutationId.length > 0, true);
  assert.equal(manager.current()[0].name, 'Authoritative soup');
  assert.equal((await repo.listOutbox('kay', 'our-home', 'recipe')).length, 0);
  repo.close();
});

test('recipe conflicts remain visible and support stable retry or discard', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let shouldFail = true;
  const statuses = [];
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => true,
    send: async () => shouldFail
      ? ({ ok: false, status: 409, error: 'recipe_conflict' })
      : ({ ok: true, recipes: [{ id: 'r1', name: 'Soup' }] }),
    onStatus: (status) => statuses.push(status),
  });
  await manager.init();
  await manager.mutate('recipe.create', { id: 'r1', item: { id: 'r1', name: 'Soup' } });
  await manager.drain();
  const [pending] = manager.pending();
  assert.equal(manager.status(), 'blocked');
  assert.equal(statuses.at(-1).status, 'blocked');
  shouldFail = false;
  await manager.retry(pending.sequence);
  assert.equal(manager.pending().length, 0);
  assert.equal(manager.status(), 'synced');

  const offline = createRecipeOutbox({ repo, authSub: 'kay', householdId: 'our-home', initial: manager.current(), isOnline: () => false });
  await offline.init();
  await offline.mutate('recipe.delete', { id: 'r1' });
  const [deletion] = offline.pending();
  assert.equal(offline.current().length, 0);
  await offline.discard(deletion.sequence);
  assert.equal(offline.current().length, 1);
  repo.close();
});

test('discarding a failed recipe mutation immediately drains later work', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  const sent = [];
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => online,
    makeId: (() => { let i = 0; return () => `recipe-discard-${++i}`; })(),
    send: async (request) => {
      sent.push(request.mutationId);
      return request.mutationId === 'recipe-discard-1'
        ? { ok: false, status: 409 }
        : { ok: true, recipes: [{ id: 'r2', name: 'Stew' }] };
    },
  });
  await manager.init();
  await manager.mutate('recipe.create', { id: 'r1', item: { id: 'r1', name: 'Soup' } });
  await manager.mutate('recipe.create', { id: 'r2', item: { id: 'r2', name: 'Stew' } });
  online = true;
  assert.equal(await manager.drain(), false);
  const [failed] = manager.pending();
  assert.equal(await manager.discard(failed.sequence), true);
  assert.deepEqual(sent, ['recipe-discard-1', 'recipe-discard-2']);
  assert.equal(manager.pending().length, 0);
  repo.close();
});

test('recipe drain never acknowledges a mutation before its enqueue completes', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const originalEnqueue = repo.enqueue;
  let enqueueCalls = 0;
  let releaseSecondEnqueue;
  const secondEnqueue = new Promise((resolve) => { releaseSecondEnqueue = resolve; });
  repo.enqueue = async (row) => {
    enqueueCalls += 1;
    if (enqueueCalls === 2) await secondEnqueue;
    return originalEnqueue(row);
  };
  let releaseFirstSend;
  let firstSendStarted;
  const firstStarted = new Promise((resolve) => { firstSendStarted = resolve; });
  const sent = [];
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [],
    makeId: (() => { let i = 0; return () => `recipe-race-${++i}`; })(),
    send: async (request) => {
      sent.push(request.mutationId);
      if (request.mutationId === 'recipe-race-1') {
        firstSendStarted();
        await new Promise((resolve) => { releaseFirstSend = resolve; });
        return { ok: true, recipes: [{ id: 'r1', name: 'Soup' }] };
      }
      return { ok: true, recipes: [{ id: 'r1', name: 'Soup' }, { id: 'r2', name: 'Stew' }] };
    },
  });
  await manager.init();
  await manager.mutate('recipe.create', { id: 'r1', item: { id: 'r1', name: 'Soup' } });
  await firstStarted;
  const second = manager.mutate('recipe.create', { id: 'r2', item: { id: 'r2', name: 'Stew' } });
  releaseFirstSend();
  while (manager.pending().some((row) => row.mutationId === 'recipe-race-1')) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const beforePersistence = { sent: [...sent], pending: manager.pending().length };
  releaseSecondEnqueue();
  await second;
  await manager.drain();
  const durable = await repo.listOutbox('kay', 'our-home', 'recipe');

  assert.deepEqual(beforePersistence, { sent: ['recipe-race-1'], pending: 1 });
  assert.deepEqual(sent, ['recipe-race-1', 'recipe-race-2']);
  assert.deepEqual(durable, []);
  repo.close();
});

test('stale recipe authority cannot resurrect a deletion during or after acknowledgement', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  let releaseAcknowledgement;
  let acknowledgementStarted;
  const acknowledgementHeld = new Promise((resolve) => { releaseAcknowledgement = resolve; });
  const acknowledgementObserved = new Promise((resolve) => { acknowledgementStarted = resolve; });
  const heldRepo = {
    ...repo,
    async acknowledgeRecipes(...args) {
      acknowledgementStarted();
      await acknowledgementHeld;
      return repo.acknowledgeRecipes(...args);
    },
  };
  const manager = createRecipeOutbox({
    repo: heldRepo, authSub: 'kay', householdId: 'our-home', initial: [recipe],
    isOnline: () => online, send: async () => ({ ok: true, recipes: [] }),
  });
  await manager.init();
  await manager.mutate('recipe.delete', { id: recipe.id });
  const fetchVersion = manager.version();
  online = true;
  const draining = manager.drain();
  await acknowledgementObserved;
  const staleRefresh = manager.setAuthority([recipe], { mutationVersion: fetchVersion });
  await Promise.resolve();
  releaseAcknowledgement();

  assert.equal(await draining, true);
  assert.equal(await staleRefresh, false);
  assert.deepEqual(manager.current(), []);
  assert.deepEqual(await repo.getRecipes('kay', 'our-home'), []);
  repo.close();
});

test('discard waits for an in-flight accepted recipe mutation to reconcile', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  let releaseSend;
  let sendStarted;
  const sendHeld = new Promise((resolve) => { releaseSend = resolve; });
  const sendObserved = new Promise((resolve) => { sendStarted = resolve; });
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => online,
    send: async () => {
      sendStarted();
      await sendHeld;
      return { ok: true, recipes: [recipe] };
    },
  });
  await manager.init();
  await manager.mutate('recipe.create', { id: recipe.id, item: recipe });
  const [pending] = manager.pending();
  online = true;
  const draining = manager.drain();
  await sendObserved;
  const discarded = manager.discard(pending.sequence);
  releaseSend();

  assert.equal(await draining, true);
  assert.equal(await discarded, false);
  assert.deepEqual(manager.current().map(({ id }) => id), ['local-r1']);
  assert.deepEqual((await repo.getRecipes('kay', 'our-home')).map(({ id }) => id), ['local-r1']);
  repo.close();
});

test('failed recipe acknowledgement persistence is retry-only and replays the stable mutation', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  let failAcknowledgement = true;
  const statuses = [];
  const sent = [];
  const failedRepo = {
    ...repo,
    acknowledgeRecipes: async (...args) => {
      if (failAcknowledgement) { failAcknowledgement = false; throw new Error('ack_failed'); }
      return repo.acknowledgeRecipes(...args);
    },
  };
  const manager = createRecipeOutbox({
    repo: failedRepo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => online,
    send: async ({ mutationId }) => { sent.push(mutationId); return { ok: true, recipes: [recipe] }; },
    onStatus: (status) => statuses.push(status),
  });
  await manager.init();
  await manager.mutate('recipe.create', { id: recipe.id, item: recipe });
  const [pending] = manager.pending();
  online = true;

  assert.equal(await manager.drain(), false);
  assert.deepEqual(statuses.at(-1), { status: 'blocked', pending: 1, sequence: pending.sequence, discardable: false });
  assert.equal(await manager.discard(pending.sequence), false);
  assert.equal(await manager.retry(pending.sequence), true);
  assert.deepEqual(sent, [pending.mutationId, pending.mutationId]);
  assert.deepEqual(manager.current().map(({ id }) => id), ['local-r1']);
  assert.equal(manager.pending().length, 0);
  repo.close();
});

test('uncertain recipe transport failure is offline retry-only and cannot be discarded', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  const statuses = [];
  const manager = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => online,
    send: async () => ({ ok: false, status: 0, error: 'network_unavailable' }),
    onStatus: (status) => statuses.push(status),
  });
  await manager.init();
  await manager.mutate('recipe.create', { id: recipe.id, item: recipe });
  const [pending] = manager.pending();
  online = true;

  assert.equal(await manager.drain(), false);
  assert.deepEqual(statuses.at(-1), { status: 'offline', pending: 1, sequence: pending.sequence, discardable: false });
  assert.equal(await manager.discard(pending.sequence), false);
  assert.equal(manager.pending().length, 1);
  repo.close();
});

test('accepted recipe mutation remains retry-only after acknowledgement failure and restart', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  const failedRepo = { ...repo, acknowledgeRecipes: async () => { throw new Error('ack_failed'); } };
  const first = createRecipeOutbox({
    repo: failedRepo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => online,
    send: async () => ({ ok: true, recipes: [recipe] }),
  });
  await first.init();
  await first.mutate('recipe.create', { id: recipe.id, item: recipe });
  online = true;
  assert.equal(await first.drain(), false);

  const statuses = [];
  const restarted = createRecipeOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: [], isOnline: () => true,
    send: async () => ({ ok: false, status: 409, error: 'recipe_conflict' }),
    onStatus: (status) => statuses.push(status),
  });
  await restarted.init();
  const [pending] = restarted.pending();
  assert.equal(await restarted.drain(), false);
  assert.deepEqual(statuses.at(-1), { status: 'blocked', pending: 1, sequence: pending.sequence, discardable: false });
  assert.equal(await restarted.discard(pending.sequence), false);
  assert.deepEqual(restarted.current().map(({ id }) => id), ['local-r1']);
  assert.equal(restarted.pending().length, 1);
  repo.close();
});
