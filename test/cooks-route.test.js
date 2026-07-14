import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestDelete, onRequestGet, onRequestPost, onRequestPatch } from '../functions/api/cooks.js';

function memoryStore() {
  const events = new Map();
  const reactions = new Map();
  return {
    events, reactions,
    getEvent: async (id) => events.get(id) || null,
    hasRecipe: async (id) => id === 'r1',
    listMemberSubs: async () => ['kay', 'gloria'],
    getWorkspace: async () => ({ revision: 0, plan: [] }),
    commitCook: async ({ event }) => { events.set(event.id, event); return event; },
    commitCorrection: async ({ event }) => { events.set(event.id, event); return event; },
    commitDeletion: async ({ event }) => { events.set(event.id, event); return event; },
    saveReaction: async (reaction) => { reactions.set(`${reaction.cookEventId}:${reaction.memberSub}`, reaction); return reaction; },
    listEvents: async () => [...events.values()],
    listReactions: async () => [...reactions.values()],
  };
}
const context = (store, method, body, data = {}) => ({
  request: new Request('https://cookbook.test/api/cooks', { method, body: body && JSON.stringify(body), headers: body ? { 'content-type': 'application/json' } : {} }),
  env: { DB: {} },
  data: { household: { household: { id: 'our-home' } }, auth: { sub: 'kay' }, cookStore: store, ...data },
});

test('cook routes fail closed without resolved household membership', async () => {
  const response = await onRequestGet(context(memoryStore(), 'GET', null, { household: null }));
  assert.equal(response.status, 403);
});

test('mark cooked is idempotent and shared history returns the event', async () => {
  const store = memoryStore();
  const payload = { eventId: 'event-1', recipeId: 'r1', cookedAt: 1000, participants: ['kay', 'gloria'], servings: 2 };
  const first = await onRequestPost(context(store, 'POST', payload));
  const second = await onRequestPost(context(store, 'POST', payload));
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const history = await (await onRequestGet(context(store, 'GET'))).json();
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].createdBySub, 'kay');
});

test('reaction route ignores spoofed member identity and updates only the caller', async () => {
  const store = memoryStore();
  await onRequestPost(context(store, 'POST', { eventId: 'event-1', recipeId: 'r1', cookedAt: 1000, participants: ['kay'], servings: 2 }));
  const response = await onRequestPatch(context(store, 'PATCH', {
    eventId: 'event-1', reaction: { memberSub: 'gloria', reaction: 'loved', note: 'Again please' },
  }));
  assert.equal(response.status, 200);
  assert.equal([...store.reactions.values()][0].memberSub, 'kay');
});

test('either household member can correct history with revision CAS', async () => {
  const store = memoryStore();
  await onRequestPost(context(store, 'POST', { eventId: 'event-1', recipeId: 'r1', cookedAt: 1000, participants: ['kay'], servings: 2 }));
  const response = await onRequestPatch(context(store, 'PATCH', {
    action: 'correct', eventId: 'event-1', eventRevision: 1, cookedAt: 1200,
    participants: ['kay', 'gloria'], cookSub: 'gloria', servings: 4, notes: 'Corrected',
  }, { auth: { sub: 'gloria' } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).event.revision, 2);
  const stale = await onRequestPatch(context(store, 'PATCH', {
    action: 'correct', eventId: 'event-1', eventRevision: 1, cookedAt: 1200,
    participants: ['kay'], servings: 2,
  }));
  assert.equal(stale.status, 409);
});

test('history deletion is soft and repeated deletion is idempotent', async () => {
  const store = memoryStore();
  await onRequestPost(context(store, 'POST', { eventId: 'event-1', recipeId: 'r1', cookedAt: 1000, participants: ['kay'], servings: 2 }));
  const first = await onRequestDelete(context(store, 'DELETE', { eventId: 'event-1', eventRevision: 1 }));
  assert.equal(first.status, 200);
  const event = (await first.json()).event;
  assert.equal(event.deletedAt > 0, true);
  const repeated = await onRequestDelete(context(store, 'DELETE', { eventId: 'event-1', eventRevision: event.revision }));
  assert.equal(repeated.status, 200);
});
