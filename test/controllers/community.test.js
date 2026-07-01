// test/controllers/community.test.js — community feed: sign-in gate + auth refresh.

import { test } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: () => null };
}

let mod;
try { mod = await import('../../docs/js/controllers/community.js'); } catch (e) { mod = {}; }

function makeDom() {
  const grid = { innerHTML: '', addEventListener: () => {} };
  const buttonSlot = { innerHTML: '' };
  const document = {
    getElementById: (sel) => {
      if (sel === 'community-grid') return grid;
      if (sel === 'g-signin-btn') return buttonSlot;
      return null;
    },
  };
  return { grid, buttonSlot, document };
}

test('community.js exports initCommunity', () => {
  assert.equal(typeof mod.initCommunity, 'function');
});

test('initCommunity returns the documented public API', () => {
  if (!mod.initCommunity) return;
  const panels = { register: () => {} };
  const ctrl = mod.initCommunity({ state: {}, panels });
  assert.equal(typeof ctrl.render, 'function');
  assert.equal(typeof ctrl.loadFirst, 'function');
  assert.equal(typeof ctrl.loadMore, 'function');
  assert.equal(typeof ctrl.refresh, 'function');
  assert.equal(typeof ctrl.saveToLocal, 'function');
  assert.equal(typeof ctrl.deleteShared, 'function');
  assert.equal(typeof ctrl.share, 'function');
});

test('render() with no token writes the sign-in empty state with a g-signin-btn slot', () => {
  if (!mod.initCommunity) return;
  const { grid, document } = makeDom();
  // No clientId configured → initGoogleSignIn returns via onError branch, no async work.
  const prevWindow = globalThis.window;
  globalThis.window = {};
  const panels = { register: () => {} };
  try {
    const ctrl = mod.initCommunity({ state: {}, panels, document });
    ctrl.render();
  } finally {
    globalThis.window = prevWindow;
  }
  assert.match(grid.innerHTML, /Sign in to see the Community/);
  assert.match(grid.innerHTML, /id="g-signin-btn"/);
});
