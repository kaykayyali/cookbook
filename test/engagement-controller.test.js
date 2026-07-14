import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initEngagement, suggestionsHTML } from '../docs/js/controllers/engagement.js';

const recipe = { id: 'r1', _id: 'r1', name: 'Soup', recipeIngredient: ['tomato'], totalTime: '20 min' };

test('engagement loads shared events and renders explainable suggestion lanes', async () => {
  const state = { recipes: [recipe], cookEvents: [], cookReactions: [], auth: { sub: 'kay' } };
  const controller = initEngagement({
    state, document: { getElementById: () => null },
    fetchHistory: async () => ({ ok: true, events: [{ id: 'e0', recipeId: 'r1', cookedAt: 10 }], reactions: [] }),
  });
  assert.equal(await controller.load(), true);
  assert.equal(state.cookEvents.length, 1);
  assert.match(suggestionsHTML(controller.picks()), /Reliable favorite|Something different|Quick option/);
});

test('mark cooked preserves plan linkage then refreshes authoritative workspace', async () => {
  const calls = [];
  let refreshed = 0;
  const state = { recipes: [recipe], cookEvents: [], cookReactions: [], auth: { sub: 'kay' } };
  const controller = initEngagement({
    state, document: { getElementById: () => null },
    sendCook: async (payload) => { calls.push(payload); return { ok: true, event: { id: payload.eventId, recipeId: payload.recipeId, cookedAt: payload.cookedAt } }; },
    refreshWorkspace: async () => { refreshed += 1; },
    notify: () => {},
  });
  const result = await controller.markPlan({ id: 'plan-1', recipeId: 'r1', targetServings: 3 });
  assert.equal(result, true);
  assert.equal(calls[0].planEntryId, 'plan-1');
  assert.deepEqual(calls[0].participants, ['kay']);
  assert.equal(refreshed, 1);
});

test('each member reaction replaces only that member reaction locally', async () => {
  const state = {
    recipes: [recipe], cookEvents: [{ id: 'e1', recipeId: 'r1' }],
    cookReactions: [{ cookEventId: 'e1', memberSub: 'gloria', reaction: 'good' }], auth: { sub: 'kay' },
  };
  const controller = initEngagement({
    state, document: { getElementById: () => null },
    sendReaction: async () => ({ ok: true, reaction: { cookEventId: 'e1', memberSub: 'kay', reaction: 'loved' } }),
  });
  assert.equal(await controller.react('e1', 'loved'), true);
  assert.equal(state.cookReactions.length, 2);
  assert.equal(state.cookReactions.find((item) => item.memberSub === 'gloria').reaction, 'good');
});

test('shared history can be corrected or deleted without touching another event', async () => {
  const state = {
    recipes: [recipe], auth: { sub: 'kay' }, cookReactions: [],
    cookEvents: [
      { id: 'e1', recipeId: 'r1', revision: 1, cookedAt: 10, participants: ['kay'], cookSub: 'kay', servings: 2 },
      { id: 'e2', recipeId: 'r1', revision: 1, cookedAt: 20 },
    ],
  };
  const controller = initEngagement({
    state, document: { getElementById: () => null }, notify: () => {},
    sendCorrection: async (change) => ({ ok: true, event: { ...state.cookEvents[0], ...change, revision: 2 } }),
    sendDeletion: async () => ({ ok: true, event: { ...state.cookEvents[0], revision: 3, deletedAt: 30 } }),
  });
  assert.equal(await controller.correct('e1', { notes: 'Crispier next time' }), true);
  assert.equal(state.cookEvents[0].notes, 'Crispier next time');
  assert.equal(await controller.remove('e1'), true);
  assert.deepEqual(state.cookEvents.map((event) => event.id), ['e2']);
});
