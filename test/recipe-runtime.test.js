import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { openOfflineDb } from '../docs/js/lib/offline-db.js';
import { initRecipeRuntime } from '../docs/js/lib/recipe-runtime.js';

test('recipe synchronization failures are visible and discardable', async () => {
  const dom = new JSDOM(`<div id="recipe-sync-status" hidden><span data-recipe-sync-message></span><button data-action="retry-recipe-sync" hidden>Retry</button><button data-action="discard-recipe-sync" hidden>Discard</button></div>`);
  const repo = await openOfflineDb({ indexedDB, name: `recipe-runtime-${Date.now()}` });
  const state = { household: { household: { id: 'home' } }, recipes: [] };
  const runtime = await initRecipeRuntime({
    state, repo, authSub: 'cook', document: dom.window.document, window: dom.window,
    send: async () => ({ ok: false, status: 409, error: 'conflict' }),
  });
  await runtime.mutate('recipe.create', { id: 'r1', item: { id: 'r1', name: 'Soup' } });
  const banner = dom.window.document.getElementById('recipe-sync-status');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /attention/i);
  banner.querySelector('[data-action="discard-recipe-sync"]').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.recipes.length, 0);
  assert.equal(banner.hidden, true);
  repo.close();
});
