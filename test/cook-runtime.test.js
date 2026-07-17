import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { initCookRuntime } from '../docs/js/lib/cook-runtime.js';

const dbName = () => `cook-runtime-${Date.now()}-${Math.random()}`;

test('offline cook deletion restores the linked plan entry prior status', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const event = {
    id: 'e1', recipeId: 'r1', planEntryId: 'p1', priorPlanStatus: 'active',
    cookedAt: 1000, participants: ['kay'], cookSub: 'kay', servings: 2, revision: 1,
  };
  const state = {
    household: { household: { id: 'our-home' } },
    cookEvents: [event], cookReactions: [],
    plan: [{ id: 'p1', recipeId: 'r1', status: 'cooked' }],
  };
  const manager = await initCookRuntime({
    state, repo, authSub: 'kay',
    document: { getElementById: () => null },
    window: { navigator: { onLine: false }, addEventListener: () => {} },
  });
  await manager.mutate('cook.delete', { eventId: 'e1', eventRevision: 1, event });
  assert.equal(state.plan[0].status, 'active');
  repo.close();
});

test('history fetched before an acknowledged delete cannot resurrect the event or cooked plan state', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const event = {
    id: 'e1', recipeId: 'r1', planEntryId: 'p1', priorPlanStatus: 'skipped',
    cookedAt: 1000, participants: ['kay'], cookSub: 'kay', servings: 2, revision: 1,
  };
  const state = {
    household: { household: { id: 'our-home' } },
    cookEvents: [event], cookReactions: [],
    plan: [{ id: 'p1', recipeId: 'r1', status: 'cooked' }],
  };
  const manager = await initCookRuntime({
    state, repo, authSub: 'kay',
    document: { getElementById: () => null },
    window: { navigator: { onLine: true }, addEventListener: () => {} },
    send: async () => ({
      ok: true, history: { events: [], reactions: [] }, event: { ...event, deletedAt: 2000 },
    }),
  });
  const fetchVersion = manager.version();
  await manager.mutate('cook.delete', { eventId: 'e1', eventRevision: 1, event });
  assert.equal(await manager.drain(), true);
  assert.equal(state.plan[0].status, 'skipped');

  assert.equal(await manager.setAuthority(
    { events: [event], reactions: [] },
    { mutationVersion: fetchVersion },
  ), false);
  assert.equal(state.cookEvents.length, 0);
  assert.equal(state.plan[0].status, 'skipped');
  repo.close();
});

test('history fetched while a delete is pending cannot resurrect it after acknowledgement', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const event = {
    id: 'e1', recipeId: 'r1', planEntryId: 'p1', priorPlanStatus: 'skipped',
    cookedAt: 1000, participants: ['kay'], cookSub: 'kay', servings: 2, revision: 1,
  };
  const state = {
    household: { household: { id: 'our-home' } }, cookEvents: [event], cookReactions: [],
    plan: [{ id: 'p1', recipeId: 'r1', status: 'cooked' }],
  };
  let online = false;
  const manager = await initCookRuntime({
    state, repo, authSub: 'kay', document: { getElementById: () => null },
    window: { navigator: { get onLine() { return online; } }, addEventListener: () => {} },
    send: async () => ({
      ok: true, history: { events: [], reactions: [] }, event: { ...event, deletedAt: 2000 },
    }),
  });
  await manager.mutate('cook.delete', { eventId: 'e1', eventRevision: 1, event });
  const fetchVersion = manager.version();
  online = true;
  assert.equal(await manager.drain(), true);

  assert.equal(await manager.setAuthority(
    { events: [event], reactions: [] },
    { mutationVersion: fetchVersion },
  ), false);
  assert.equal(state.cookEvents.length, 0);
  assert.equal(state.plan[0].status, 'skipped');
  repo.close();
});

test('history resolving during acknowledgement cannot overwrite the acknowledged deletion', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  const event = {
    id: 'e1', recipeId: 'r1', planEntryId: 'p1', priorPlanStatus: 'skipped',
    cookedAt: 1000, participants: ['kay'], cookSub: 'kay', servings: 2, revision: 1,
  };
  const state = {
    household: { household: { id: 'our-home' } }, cookEvents: [event], cookReactions: [],
    plan: [{ id: 'p1', recipeId: 'r1', status: 'cooked' }],
  };
  let online = false;
  let releaseAcknowledgement;
  let acknowledgementStarted;
  const acknowledgementHeld = new Promise((resolve) => { releaseAcknowledgement = resolve; });
  const acknowledgementObserved = new Promise((resolve) => { acknowledgementStarted = resolve; });
  const heldRepo = {
    ...repo,
    async acknowledgeCooks(...args) {
      acknowledgementStarted();
      await acknowledgementHeld;
      return repo.acknowledgeCooks(...args);
    },
  };
  const manager = await initCookRuntime({
    state, repo: heldRepo, authSub: 'kay', document: { getElementById: () => null },
    window: { navigator: { get onLine() { return online; } }, addEventListener: () => {} },
    send: async () => ({
      ok: true, history: { events: [], reactions: [] }, event: { ...event, deletedAt: 2000 },
    }),
  });
  await manager.mutate('cook.delete', { eventId: 'e1', eventRevision: 1, event });
  const fetchVersion = manager.version();
  online = true;
  const draining = manager.drain();
  await acknowledgementObserved;
  const staleRefresh = manager.setAuthority(
    { events: [event], reactions: [] },
    { mutationVersion: fetchVersion },
  );
  await Promise.resolve();
  releaseAcknowledgement();

  assert.equal(await draining, true);
  assert.equal(await staleRefresh, false);
  assert.equal(state.cookEvents.length, 0);
  assert.equal(state.plan[0].status, 'skipped');
  assert.deepEqual(await repo.getCookHistory('kay', 'our-home'), { events: [], reactions: [] });
  repo.close();
});
