import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { openOfflineDb, cacheKeys } from '../docs/js/lib/offline-db.js';

const dbName = () => `cookbook-test-${Date.now()}-${Math.random()}`;
const workspace = (revision = 0) => ({
  householdId: 'our-home', revision, plan: [], cart: [], pantry: [], shoppingChecked: {},
  manualItems: [], recentMutations: [], updatedAt: revision,
});

test('opens with meta, cache, and ordered unique outbox stores', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  assert.deepEqual([...repo.db.objectStoreNames], ['cache', 'meta', 'outbox']);
  const first = await repo.enqueue({ schemaVersion: 1, mutationId: 'same', authSub: 'cook-1', householdId: 'our-home', op: 'pantry.add', payload: { name: 'flour' } });
  assert.equal(first.sequence, 1);
  assert.equal(first.schemaVersion, 2);
  await assert.rejects(() => repo.enqueue({ mutationId: 'same', authSub: 'cook-1', householdId: 'our-home', op: 'pantry.add', payload: {} }));
  repo.close();
});

test('membership, canonical recipes, and workspace caches are partitioned by subject and household', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  await repo.putMembership('cook-1', { household: { id: 'our-home' }, member: { id: 'm1' } });
  await repo.putRecipes('cook-1', 'our-home', [{ id: 'r1', recipe: { name: 'Soup' } }]);
  await repo.putWorkspace('cook-1', 'our-home', workspace(3));
  assert.equal((await repo.getMembership('cook-1')).household.id, 'our-home');
  assert.equal((await repo.getRecipes('cook-1', 'our-home'))[0].id, 'r1');
  assert.equal((await repo.getWorkspace('cook-1', 'our-home')).revision, 3);
  assert.equal(await repo.getWorkspace('cook-2', 'our-home'), null);
  assert.equal(await repo.getRecipes('cook-1', 'other-home'), null);
  assert.equal(cacheKeys.workspace('cook-1', 'our-home'), 'workspace:cook-1:our-home');
  repo.close();
});

test('malformed cache record is rejected without deleting valid neighbors', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  await repo.putWorkspace('cook-1', 'our-home', workspace(1));
  await repo.rawPut('cache', { key: cacheKeys.workspace('cook-2', 'our-home'), kind: 'workspace', value: { revision: 'bad' } });
  assert.equal(await repo.getWorkspace('cook-2', 'our-home'), null);
  assert.equal((await repo.getWorkspace('cook-1', 'our-home')).revision, 1);
  repo.close();
});

test('acknowledgement atomically updates authority and deletes only its outbox row', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  await repo.putWorkspace('cook-1', 'our-home', workspace(0));
  await repo.enqueue({ mutationId: 'm1', authSub: 'cook-1', householdId: 'our-home', op: 'pantry.add', payload: { name: 'flour' } });
  await repo.enqueue({ mutationId: 'm2', authSub: 'cook-1', householdId: 'our-home', op: 'pantry.add', payload: { name: 'salt' } });
  await repo.acknowledge('cook-1', 'our-home', 'm1', { ...workspace(1), pantry: ['flour'] });
  assert.equal((await repo.getWorkspace('cook-1', 'our-home')).revision, 1);
  assert.deepEqual((await repo.listOutbox('cook-1', 'our-home')).map((row) => row.mutationId), ['m2']);
  repo.close();
});

test('v2 upgrade backfills v1 cache and outbox records without losing queued intent', async () => {
  const name = dbName();
  const seeded = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('cache', { keyPath: 'key' });
      const outbox = db.createObjectStore('outbox', { keyPath: 'sequence', autoIncrement: true });
      outbox.createIndex('mutationId', 'mutationId', { unique: true });
      outbox.createIndex('scopeOrder', ['authSub', 'householdId', 'status', 'sequence']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = seeded.transaction(['cache', 'outbox'], 'readwrite');
  tx.objectStore('cache').put({ key: cacheKeys.workspace('kay', 'our-home'), schemaVersion: 1, authSub: 'kay', householdId: 'our-home', kind: 'workspace', value: workspace(0), cachedAt: 1 });
  tx.objectStore('outbox').add({ schemaVersion: 1, mutationId: 'old-mutation', authSub: 'kay', householdId: 'our-home', scope: 'workspace', op: 'pantry.add', payload: { name: 'salt' }, status: 'pending', sequence: 1 });
  await new Promise((resolve) => { tx.oncomplete = resolve; });
  seeded.close();

  const repo = await openOfflineDb({ indexedDB, name });
  assert.equal(repo.db.version, 2);
  assert.equal((await repo.getWorkspace('kay', 'our-home')).revision, 0);
  assert.equal((await repo.listOutbox('kay', 'our-home'))[0].mutationId, 'old-mutation');
  const upgraded = indexedDB.open(name, 3);
  await new Promise((resolve, reject) => { upgraded.onsuccess = resolve; upgraded.onerror = () => reject(upgraded.error); });
  assert.throws(() => repo.db.transaction('cache', 'readonly'));
  upgraded.result.close();
});

test('duplicate acknowledgement from another tab converges without rejecting', async () => {
  const repo = await openOfflineDb({ indexedDB, name: dbName() });
  await repo.enqueue({ mutationId: 'shared', authSub: 'kay', householdId: 'our-home', op: 'pantry.add', payload: { name: 'salt' } });
  await repo.acknowledge('kay', 'our-home', 'shared', { ...workspace(1), pantry: ['salt'] });
  const duplicate = await repo.acknowledge('kay', 'our-home', 'shared', { ...workspace(2), pantry: ['salt'] });
  assert.equal(duplicate, false);
  assert.equal((await repo.getWorkspace('kay', 'our-home')).revision, 2);
  repo.close();
});
