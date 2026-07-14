import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { createRecipeOutbox } from '../docs/js/lib/recipe-outbox.js';

const dbName = () => `recipe-outbox-${Date.now()}-${Math.random()}`;
const recipe = { id: 'local-r1', _id: 'local-r1', name: 'Offline soup', recipeIngredient: ['tomato'] };

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
