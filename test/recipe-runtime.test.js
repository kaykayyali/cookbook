import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { initRecipeRuntime } from '../docs/js/lib/recipe-runtime.js';
import { createPantryRecipeDiscovery } from '../docs/js/lib/pantry-recipe-discovery.js';
import {
  applyReviewedIngredientCorrection,
  ingredientEvidence,
} from '../docs/js/lib/ingredient-corrections.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function eventTarget({ online = true } = {}) {
  const listeners = new Map();
  return {
    navigator: { onLine: online },
    addEventListener(type, listener) {
      const values = listeners.get(type) || new Set(); values.add(listener); listeners.set(type, values);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const listener of listeners.get(type) || []) listener(); },
    count(type) { return listeners.get(type)?.size || 0; },
  };
}

function fakeBroadcastFactory() {
  const channels = new Set();
  return class FakeBroadcastChannel {
    constructor() { this.listeners = new Set(); this.closed = false; channels.add(this); }
    addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener); }
    postMessage(data) {
      for (const channel of channels) if (channel !== this && !channel.closed) {
        for (const listener of channel.listeners) listener({ data });
      }
    }
    close() { this.closed = true; channels.delete(this); }
  };
}

test('production reviewed correction rebuilds a warmed Pantry index once across optimistic and authoritative publication', async () => {
  const repo = await openOfflineDb({ indexedDB, name: `recipe-correction-index-${Date.now()}` });
  const window = eventTarget();
  const document = eventTarget(); document.hidden = false; document.getElementById = () => null;
  const base = { id: 'r1', _id: 'r1', name: 'Mystery Pesto', recipeIngredient: ['2 mystery leaves'], _updatedAt: 1 };
  const state = { household: { household: { id: 'home' } }, recipes: [base] };
  const response = deferred();
  const runtime = await initRecipeRuntime({
    state, repo, authSub: 'cook', document, window, BroadcastChannel: null,
    schedule: () => ({ unref() {} }), clearSchedule() {},
    send: async () => response.promise,
  });
  let builds = 0;
  const discover = createPantryRecipeDiscovery({ onIndexBuild: () => { builds += 1; } });
  const render = () => discover({
    recipes: state.recipes,
    recipeAuthorityVersion: state.recipeAuthorityVersion,
    pantry: [{ name: 'basil' }], ingredientName: 'basil',
  });
  assert.deepEqual(render(), []);
  assert.equal(builds, 1);

  const ingredientId = ingredientEvidence(base)[0].id;
  const correction = {
    name: 'basil', amountState: 'numeric', amount: '2',
    measurementFamily: 'count', sourceUnit: 'count', countLabel: 'leaf',
  };
  assert.equal(await runtime.mutate('recipe.ingredient.review', { id: 'r1', ingredientId, correction }), true);
  assert.equal(render().length, 1, 'optimistic correction is discoverable immediately');
  assert.equal(builds, 2);
  const versionAfterOptimistic = state.recipeAuthorityVersion;

  const authoritative = applyReviewedIngredientCorrection(base, {
    ingredientId, correction, reviewer: { sub: 'cook', name: 'Cook' }, reviewedAt: 10,
  });
  assert.equal(authoritative.ok, true, authoritative.error);
  response.resolve({ ok: true, recipes: [{
    ...authoritative.recipe, _updatedAt: 10,
    _serverReceipt: { mutationId: 'review-accepted', committedAt: 11 },
  }] });
  assert.equal(await runtime.drain(), true);
  assert.equal(state.recipes[0].ingredientNormalizations[0].reviewedBy.sub, 'cook');
  assert.deepEqual(state.recipes[0]._serverReceipt,
    { mutationId: 'review-accepted', committedAt: 11 },
    'metadata-only acknowledgement still publishes arbitrary server authority');
  assert.equal(state.recipeAuthorityVersion, versionAfterOptimistic,
    'acknowledgement metadata does not invalidate the discovery generation again');
  assert.equal(render().length, 1);
  assert.equal(builds, 2, 'one reviewed correction causes one discovery rebuild');
  render();
  assert.equal(builds, 2, 'unchanged rerenders reuse the corrected index');
  runtime.destroy(); repo.close();
});

test('recipe synchronization failures are visible and discardable', async () => {
  const dom = new JSDOM(`<div id="recipe-sync-status" hidden><span data-recipe-sync-message></span><button data-action="retry-recipe-sync" hidden>Retry</button><button data-action="discard-recipe-sync" hidden>Discard</button></div>`);
  const repo = await openOfflineDb({ indexedDB, name: `recipe-runtime-${Date.now()}` });
  const state = { household: { household: { id: 'home' } }, recipes: [] };
  const runtime = await initRecipeRuntime({
    state, repo, authSub: 'cook', document: dom.window.document, window: dom.window,
    send: async () => ({ ok: false, status: 409, error: 'conflict' }),
  });
  await runtime.mutate('recipe.create', { id: 'r1', item: { id: 'r1', name: 'Soup' } });
  await runtime.drain();
  const banner = dom.window.document.getElementById('recipe-sync-status');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /attention/i);
  banner.querySelector('[data-action="discard-recipe-sync"]').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.recipes.length, 0);
  assert.equal(banner.hidden, true);
  repo.close();
});

test('persisted recipe work drains immediately on an already-online restart', async () => {
  const dom = new JSDOM(`<div id="recipe-sync-status" hidden><span data-recipe-sync-message></span><button data-action="retry-recipe-sync" hidden>Retry</button><button data-action="discard-recipe-sync" hidden>Discard</button></div>`, { url: 'https://example.test' });
  const repo = await openOfflineDb({ indexedDB, name: `recipe-runtime-restart-${Date.now()}` });
  const state = { household: { household: { id: 'home' } }, recipes: [] };
  await repo.enqueue({
    mutationId: 'persisted-r1', authSub: 'cook', householdId: 'home', scope: 'recipe',
    op: 'recipe.create', payload: { id: 'r1', item: { id: 'r1', name: 'Soup' } }, createdAt: Date.now(),
  });
  let sends = 0;
  const runtime = await initRecipeRuntime({
    state, repo, authSub: 'cook', document: dom.window.document, window: dom.window,
    send: async () => { sends += 1; return { ok: true, recipes: [{ id: 'r1', name: 'Soup' }] }; },
  });
  for (let i = 0; i < 20 && runtime.pending().length; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(sends, 1);
  assert.equal(runtime.pending().length, 0);
  assert.deepEqual(state.recipes.map(({ id }) => id), ['r1']);
  runtime.destroy?.();
  repo.close();
});

test('two live recipe runtimes converge through untrusted broadcast-triggered authority refresh', async () => {
  const repoA = await openOfflineDb({ indexedDB, name: `recipe-live-a-${Date.now()}` });
  const repoB = await openOfflineDb({ indexedDB, name: `recipe-live-b-${Date.now()}` });
  const BroadcastChannel = fakeBroadcastFactory();
  let authority = [{ id: 'r1', _id: 'r1', name: 'Soup' }];
  const makeRuntime = async (repo) => {
    const state = { household: { household: { id: 'home' } }, recipes: structuredClone(authority) };
    const runtime = await initRecipeRuntime({
      state, repo, authSub: 'cook',
      document: { hidden: false, getElementById: () => null, addEventListener() {}, removeEventListener() {} },
      window: eventTarget(), BroadcastChannel, schedule: () => ({ unref() {} }), clearSchedule() {},
      refreshAuthority: async () => ({ ok: true, recipes: structuredClone(authority) }),
      send: async (request) => {
        authority = request.op === 'recipe.delete' ? [] : [structuredClone(request.payload.item)];
        return { ok: true, recipes: structuredClone(authority) };
      },
    });
    return { runtime, state };
  };
  const first = await makeRuntime(repoA);
  const second = await makeRuntime(repoB);
  await first.runtime.mutate('recipe.update', { id: 'r1', item: { id: 'r1', _id: 'r1', name: 'Renamed Soup' } });
  await first.runtime.drain();
  for (let attempt = 0; attempt < 20 && second.runtime.current()[0]?.name !== 'Renamed Soup'; attempt += 1) await new Promise(setImmediate);
  assert.equal(second.runtime.current()[0]?.name, 'Renamed Soup');
  await first.runtime.mutate('recipe.delete', { id: 'r1' });
  await first.runtime.drain();
  for (let attempt = 0; attempt < 20 && second.runtime.current().length; attempt += 1) await new Promise(setImmediate);
  assert.deepEqual(second.runtime.current(), []);
  first.runtime.destroy(); second.runtime.destroy(); repoA.close(); repoB.close();
});

test('a newer refresh signal invalidates an older response and queues one non-overlapping fetch', async () => {
  const repo = await openOfflineDb({ indexedDB, name: `recipe-stale-signal-${Date.now()}` });
  const window = eventTarget();
  const document = eventTarget(); document.hidden = false; document.getElementById = () => null;
  const firstResponse = deferred(); const secondResponse = deferred();
  let fetches = 0;
  const runtime = await initRecipeRuntime({
    state: { household: { household: { id: 'home' } }, recipes: [{ id: 'r1', _id: 'r1', name: 'Initial' }] },
    repo, authSub: 'cook', document, window, BroadcastChannel: null,
    schedule: () => ({ unref() {} }), clearSchedule() {},
    refreshAuthority: async () => (++fetches === 1 ? firstResponse.promise : secondResponse.promise),
  });
  const first = runtime.refreshNow();
  for (let attempt = 0; attempt < 20 && fetches < 1; attempt += 1) await new Promise(setImmediate);
  window.dispatch('focus');
  firstResponse.resolve({ ok: true, recipes: [{ id: 'r1', _id: 'r1', name: 'Stale' }] });
  assert.equal(await first, false);
  for (let attempt = 0; attempt < 20 && fetches < 2; attempt += 1) await new Promise(setImmediate);
  assert.equal(fetches, 2);
  assert.equal(runtime.current()[0].name, 'Initial', 'stale authority was never published');
  secondResponse.resolve({ ok: true, recipes: [{ id: 'r1', _id: 'r1', name: 'Fresh' }] });
  for (let attempt = 0; attempt < 20 && runtime.current()[0]?.name !== 'Fresh'; attempt += 1) await new Promise(setImmediate);
  assert.equal(runtime.current()[0].name, 'Fresh');
  runtime.destroy(); repo.close();
});

test('recipe reconnect and polling refresh authority without overlap and contain failures', async () => {
  const repo = await openOfflineDb({ indexedDB, name: `recipe-reconnect-${Date.now()}` });
  const window = eventTarget({ online: false });
  const document = eventTarget(); document.hidden = false; document.getElementById = () => null;
  const held = deferred();
  let interval; let fetches = 0; let fail = true;
  const runtime = await initRecipeRuntime({
    state: { household: { household: { id: 'home' } }, recipes: [] },
    repo, authSub: 'cook', document, window, BroadcastChannel: null,
    schedule: (fn, ms) => { interval = { fn, ms, unref() {} }; return interval; }, clearSchedule() {},
    refreshAuthority: async () => {
      fetches += 1;
      if (fail) { fail = false; throw new Error('temporary failure'); }
      return held.promise;
    },
  });
  assert.equal(await runtime.refreshNow(), false);
  window.navigator.onLine = true;
  window.dispatch('online');
  for (let attempt = 0; attempt < 20 && fetches < 2; attempt += 1) await new Promise(setImmediate);
  interval.fn(); interval.fn();
  assert.equal(fetches, 2, 'online and polling share the same in-flight refresh');
  held.resolve({ ok: true, recipes: [{ id: 'remote', _id: 'remote', name: 'Remote Soup' }] });
  for (let attempt = 0; attempt < 20 && runtime.current().length === 0; attempt += 1) await new Promise(setImmediate);
  assert.equal(runtime.current()[0]?.name, 'Remote Soup');
  const beforeDestroy = fetches;
  runtime.destroy();
  interval.fn();
  await new Promise(setImmediate);
  assert.equal(fetches, beforeDestroy, 'destroyed polling callback is inert');
  repo.close();
});

test('recipe refresh is single-flight, preserves pending intent, ignores stale responses, contains failures, and cleans up', async () => {
  const repo = await openOfflineDb({ indexedDB, name: `recipe-refresh-${Date.now()}` });
  const window = eventTarget({ online: false });
  const document = eventTarget(); document.hidden = false; document.getElementById = () => null;
  const held = deferred();
  let fetches = 0; let interval; let cleared = 0;
  const state = { household: { household: { id: 'home' } }, recipes: [{ id: 'r1', _id: 'r1', name: 'Old' }] };
  const runtime = await initRecipeRuntime({
    state, repo, authSub: 'cook', document, window,
    schedule: (fn, ms) => { interval = { fn, ms, unref() {} }; return interval; },
    clearSchedule: (value) => { assert.equal(value, interval); cleared += 1; },
    BroadcastChannel: null,
    refreshAuthority: async () => { fetches += 1; return held.promise; },
    send: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(interval.ms, 15_000);
  const first = runtime.refreshNow();
  assert.equal(runtime.refreshNow(), first, 'overlapping refresh calls share one promise');
  await runtime.mutate('recipe.delete', { id: 'r1' });
  held.resolve({ ok: true, recipes: [{ id: 'r1', _id: 'r1', name: 'Stale resurrection' }] });
  assert.equal(await first, false, 'a response started before newer local intent is stale');
  assert.deepEqual(runtime.current(), [], 'pending delete remains optimistic');
  assert.equal(fetches, 1);
  runtime.destroy();
  assert.equal(cleared, 1);
  assert.equal(window.count('online') + window.count('focus') + document.count('visibilitychange'), 0);
  assert.equal(await runtime.refreshNow(), false);
  repo.close();
});
