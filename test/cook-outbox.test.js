import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { createCookOutbox } from '../docs/js/lib/cook-outbox.js';

const dbName = () => `cookbook-cook-outbox-${Date.now()}-${Math.random()}`;
const empty = { events: [], reactions: [] };
const event = {
  id: 'e1', recipeId: 'r1', planEntryId: 'p1', cookedAt: 1000,
  participants: ['kay'], cookSub: 'kay', servings: 2, occasion: '', revision: 1,
};

test('offline cooked event persists, renders optimistically, and reconstructs after reload', async () => {
  const name = dbName();
  let repo = await openOfflineDb({ indexedDB, name });
  const first = createCookOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: empty, isOnline: () => false,
    makeId: () => 'cook-m1',
  });
  await first.init();
  assert.equal(await first.mutate('cook.record', { event }), true);
  assert.equal(first.current().events[0].id, 'e1');
  assert.equal((await repo.listOutbox('kay', 'our-home', 'cook')).length, 1);
  repo.close();

  repo = await openOfflineDb({ indexedDB, name });
  const second = createCookOutbox({ repo, authSub: 'kay', householdId: 'our-home', initial: empty, isOnline: () => false });
  await second.init();
  assert.equal(second.current().events[0].id, 'e1');
  repo.close();
});

test('member star review publishes from IndexedDB without waiting for D1', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let resolveSend;
  const response = new Promise((resolve) => { resolveSend = resolve; });
  const manager = createCookOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: { events: [event], reactions: [] },
    makeId: () => 'review-m1', send: async () => response,
  });
  await manager.init();
  const reaction = { cookEventId: 'e1', recipeId: 'r1', memberSub: 'kay', taste: 5, complexity: 2, review: 'Wonderful' };
  const mutation = manager.mutate('cook.react', { eventId: 'e1', reaction });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manager.current().reactions[0].taste, 5);
  assert.equal(await Promise.race([
    mutation.then(() => 'resolved'),
    new Promise((resolve) => setTimeout(() => resolve('blocked-on-d1'), 20)),
  ]), 'resolved');
  resolveSend({ ok: true, history: { events: [event], reactions: [reaction] } });
  assert.equal(await manager.drain(), true);
  assert.equal((await repo.listOutbox('kay', 'our-home', 'cook')).length, 0);
  repo.close();
});

test('discarding a failed cook mutation immediately drains later work', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  const sent = [];
  const second = { ...event, id: 'e2', planEntryId: 'p2' };
  const manager = createCookOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: empty, isOnline: () => online,
    makeId: (() => { let i = 0; return () => `cook-discard-${++i}`; })(),
    send: async (request) => {
      sent.push(request.mutationId);
      return request.mutationId === 'cook-discard-1'
        ? { ok: false, status: 409 }
        : { ok: true, history: { events: [second], reactions: [] } };
    },
  });
  await manager.init();
  await manager.mutate('cook.record', { event });
  await manager.mutate('cook.record', { event: second });
  online = true;
  assert.equal(await manager.drain(), false);
  const [failed] = manager.pending();
  assert.equal(await manager.discard(failed.sequence), true);
  assert.deepEqual(sent, ['cook-discard-1', 'cook-discard-2']);
  assert.equal(manager.pending().length, 0);
  repo.close();
});

test('cook drain never acknowledges a mutation before its enqueue completes', async () => {
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
  let firstAcknowledged;
  const firstAck = new Promise((resolve) => { firstAcknowledged = resolve; });
  const sent = [];
  const secondEvent = { ...event, id: 'e2', planEntryId: 'p2' };
  const manager = createCookOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: empty,
    makeId: (() => { let i = 0; return () => `cook-race-${++i}`; })(),
    onAcknowledged: (row) => { if (row.mutationId === 'cook-race-1') firstAcknowledged(); },
    send: async (request) => {
      sent.push(request.mutationId);
      if (request.mutationId === 'cook-race-1') {
        firstSendStarted();
        await new Promise((resolve) => { releaseFirstSend = resolve; });
        return { ok: true, history: { events: [event], reactions: [] } };
      }
      return { ok: true, history: { events: [secondEvent, event], reactions: [] } };
    },
  });
  await manager.init();
  await manager.mutate('cook.record', { event });
  await firstStarted;
  const second = manager.mutate('cook.record', { event: secondEvent });
  releaseFirstSend();
  await firstAck;
  const beforePersistence = { sent: [...sent], pending: manager.pending().length };
  releaseSecondEnqueue();
  await second;
  await manager.drain();
  const durable = await repo.listOutbox('kay', 'our-home', 'cook');

  assert.deepEqual(beforePersistence, { sent: ['cook-race-1'], pending: 1 });
  assert.deepEqual(sent, ['cook-race-1', 'cook-race-2']);
  assert.deepEqual(durable, []);
  repo.close();
});

test('discard waits for an in-flight accepted cook mutation to reconcile', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  let releaseSend;
  let sendStarted;
  const sendHeld = new Promise((resolve) => { releaseSend = resolve; });
  const sendObserved = new Promise((resolve) => { sendStarted = resolve; });
  const manager = createCookOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: empty, isOnline: () => online,
    send: async () => {
      sendStarted();
      await sendHeld;
      return { ok: true, history: { events: [event], reactions: [] } };
    },
  });
  await manager.init();
  await manager.mutate('cook.record', { event });
  const [pending] = manager.pending();
  online = true;
  const draining = manager.drain();
  await sendObserved;
  const discarded = manager.discard(pending.sequence);
  releaseSend();

  assert.equal(await draining, true);
  assert.equal(await discarded, false);
  assert.deepEqual(manager.current().events.map(({ id }) => id), ['e1']);
  assert.deepEqual((await repo.getCookHistory('kay', 'our-home')).events.map(({ id }) => id), ['e1']);
  assert.equal(manager.pending().length, 0);
  repo.close();
});

test('failed cook authority persistence cannot poison later optimistic rebuilds', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const failedRepo = {
    ...repo,
    putCookHistory: async () => { throw new Error('idb_failed'); },
  };
  const manager = createCookOutbox({
    repo: failedRepo, authSub: 'kay', householdId: 'our-home', initial: empty, isOnline: () => false,
  });
  await manager.init();
  await assert.rejects(manager.setAuthority({ events: [event], reactions: [] }), /idb_failed/);
  const second = { ...event, id: 'e2', planEntryId: 'p2' };
  await manager.mutate('cook.record', { event: second });

  assert.deepEqual(manager.current().events.map(({ id }) => id), ['e2']);
  assert.equal(await repo.getCookHistory('kay', 'our-home'), null);
  repo.close();
});

test('failed cook acknowledgement persistence becomes retry-only and replays to convergence', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  let failAcknowledgement = true;
  const statuses = [];
  const sent = [];
  const failedRepo = {
    ...repo,
    acknowledgeCooks: async (...args) => {
      if (failAcknowledgement) { failAcknowledgement = false; throw new Error('ack_failed'); }
      return repo.acknowledgeCooks(...args);
    },
  };
  const manager = createCookOutbox({
    repo: failedRepo, authSub: 'kay', householdId: 'our-home', initial: empty,
    isOnline: () => online,
    send: async ({ mutationId }) => { sent.push(mutationId); return { ok: true, history: { events: [event], reactions: [] } }; },
    onStatus: (status) => statuses.push(status),
  });
  await manager.init();
  await manager.mutate('cook.record', { event });
  const [pending] = manager.pending();
  online = true;
  assert.equal(await manager.drain(), false);
  assert.deepEqual(statuses.at(-1), { status: 'blocked', pending: 1, sequence: pending.sequence, discardable: false });
  assert.equal(await manager.discard(pending.sequence), false);
  assert.equal(await manager.retry(pending.sequence), true);

  assert.deepEqual(sent, [pending.mutationId, pending.mutationId]);
  assert.deepEqual(manager.current().events.map(({ id }) => id), ['e1']);
  assert.deepEqual((await repo.getCookHistory('kay', 'our-home')).events.map(({ id }) => id), ['e1']);
  assert.equal(manager.pending().length, 0);
  repo.close();
});

test('accepted cook mutation remains retry-only after acknowledgement failure and restart', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  let online = false;
  const failedRepo = { ...repo, acknowledgeCooks: async () => { throw new Error('ack_failed'); } };
  const first = createCookOutbox({
    repo: failedRepo, authSub: 'kay', householdId: 'our-home', initial: empty, isOnline: () => online,
    send: async () => ({ ok: true, history: { events: [event], reactions: [] } }),
  });
  await first.init();
  await first.mutate('cook.record', { event });
  online = true;
  assert.equal(await first.drain(), false);

  const statuses = [];
  const restarted = createCookOutbox({
    repo, authSub: 'kay', householdId: 'our-home', initial: empty, isOnline: () => true,
    send: async () => ({ ok: false, status: 401, error: 'authentication_required' }),
    onStatus: (status) => statuses.push(status),
  });
  await restarted.init();
  const [pending] = restarted.pending();
  assert.equal(await restarted.drain(), false);
  assert.deepEqual(statuses.at(-1), { status: 'blocked', pending: 1, sequence: pending.sequence, discardable: false });
  assert.equal(await restarted.discard(pending.sequence), false);
  assert.deepEqual(restarted.current().events.map(({ id }) => id), ['e1']);
  assert.equal(restarted.pending().length, 1);
  repo.close();
});
