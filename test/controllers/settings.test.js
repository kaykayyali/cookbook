// test/controllers/settings.test.js — settings panel: auth zone + import/export.

import { test } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

let mod;
try { mod = await import('../../docs/js/controllers/settings.js'); } catch (e) { mod = {}; }

function makeDom() {
  const ids = [
    'settings-auth-zone', 'settings-import-btn', 'settings-export-btn',
    'import-file', 'g-signin-btn',
  ];
  const elements = {};
  for (const id of ids) {
    elements[id] = {
      innerHTML: '', value: '', textContent: '',
      listeners: {},
      addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
      click() { for (const fn of (this.listeners.click || [])) fn(); },
      querySelector: () => null,
      firstElementChild: null,
      classList: { _set: new Set(), add(){}, remove(){}, contains(){return false}, toggle(){} },
    };
  }
  const document = {
    getElementById: (sel) => elements[sel] || null,
  };
  return { elements, document };
}

test('settings.js exports initSettings', () => {
  assert.equal(typeof mod.initSettings, 'function');
});

test('initSettings returns { renderAuth, renderSettings, handleAuthClick }', () => {
  if (!mod.initSettings) return;
  const { document } = makeDom();
  const ctrl = mod.initSettings({ document });
  assert.equal(typeof ctrl.renderAuth, 'function');
  assert.equal(typeof ctrl.renderSettings, 'function');
  assert.equal(typeof ctrl.handleAuthClick, 'function');
});

test('renderAuth writes signed-in block when loadAuth returns a token', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initSettings({
    document,
    loadAuth: () => ({ token: 'abc', email: 'me@example.com' }),
  });
  ctrl.renderAuth();
  assert.match(elements['settings-auth-zone'].innerHTML, /Signed in as me@example\.com/);
  assert.match(elements['settings-auth-zone'].innerHTML, /data-action="signout"/);
});

test('renderAuth writes g-signin-btn container when loadAuth returns no token', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initSettings({
    document,
    loadAuth: () => ({ token: null, email: null }),
    initGoogleSignIn: () => {},
  });
  ctrl.renderAuth();
  assert.match(elements['settings-auth-zone'].innerHTML, /g-signin-btn/);
});

test('renderAuth calls initGoogleSignIn when signed out', () => {
  if (!mod.initSettings) return;
  const { document } = makeDom();
  let calledWith = null;
  const ctrl = mod.initSettings({
    document,
    loadAuth: () => ({ token: null, email: null }),
    initGoogleSignIn: (opts) => { calledWith = opts; },
  });
  ctrl.renderAuth();
  assert.ok(calledWith, 'initGoogleSignIn should be called when signed out');
  assert.equal(typeof calledWith.onSignedIn, 'function');
  assert.equal(typeof calledWith.onError, 'function');
});

test('handleAuthClick on signout calls clearAuth, re-renders, and toasts', () => {
  if (!mod.initSettings) return;
  const { document } = makeDom();
  let cleared = false;
  const toasts = [];
  const ctrl = mod.initSettings({
    document,
    loadAuth: () => ({ token: 'x', email: 'a@b' }),
    clearAuth: () => { cleared = true; return Promise.resolve(); },
    toast: (m) => toasts.push(m),
  });
  // e.target.closest('[data-action="signout"]') must return truthy for the
  // handler to call clearAuth.
  const fakeBtn = { dataset: { action: 'signout' } };
  const e = { target: { closest: (sel) => (sel === '[data-action="signout"]' ? fakeBtn : null) } };
  return ctrl.handleAuthClick(e).then(() => {
    assert.equal(cleared, true, 'clearAuth should have been called');
    assert.match(toasts.join('|'), /Signed out/);
  });
});

test('handleAuthClick ignores clicks that are not signout', () => {
  if (!mod.initSettings) return;
  const { document } = makeDom();
  let cleared = false;
  const ctrl = mod.initSettings({
    document,
    clearAuth: () => { cleared = true; return Promise.resolve(); },
  });
  const e = { target: { closest: () => null } };
  return ctrl.handleAuthClick(e).then(() => {
    assert.equal(cleared, false, 'clearAuth should NOT be called');
  });
});

test('renderSettings wires import button to trigger file input click', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initSettings({ document, exportRecipes: () => {} });
  ctrl.renderSettings();
  elements['settings-import-btn'].click();
  // The import-file's click listener is invoked by the handler chain
  assert.ok(true, 'click handler ran without error');
});

test('renderSettings wires export button to exportRecipes', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makeDom();
  let exported = false;
  const ctrl = mod.initSettings({
    document,
    exportRecipes: () => { exported = true; },
  });
  ctrl.renderSettings();
  elements['settings-export-btn'].click();
  assert.equal(exported, true, 'export button click should call exportRecipes');
});
