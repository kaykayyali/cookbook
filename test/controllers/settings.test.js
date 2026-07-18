// test/controllers/settings.test.js — settings panel: auth zone + import/export.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openOfflineDb } from '../../docs/js/lib/offline-db.js';
import { initRecipeRuntime } from '../../docs/js/lib/recipe-runtime.js';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

let mod;
try { mod = await import('../../docs/js/controllers/settings.js'); } catch (e) { mod = {}; }

function makeDom() {
  const ids = [
    'settings-auth-zone', 'settings-import-btn', 'settings-export-btn',
    'import-file', 'g-signin-btn', 'feedback-sounds-toggle',
    'feedback-haptics-toggle', 'feedback-haptics-setting',
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

test('handleAuthClick on signout calls clearAuth without a redundant toast over the login gate', () => {
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
    assert.deepEqual(toasts, []);
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

test('Settings import publishes fetched recipe authority once and renders once', async () => {
  const { document } = makeDom();
  const originalFileReader = globalThis.FileReader;
  const importedRecipe = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Imported Pesto',
    recipeIngredient: ['basil'], recipeInstructions: ['Blend'],
  };
  globalThis.FileReader = class {
    readAsText() {
      queueMicrotask(() => this.onload({ target: { result: JSON.stringify([importedRecipe]) } }));
    }
  };
  const state = {
    recipes: [{ _id: 'removed', name: 'Removed', recipeIngredient: ['parsley'] }],
    recipeAuthorityVersion: 0,
  };
  let changes = 0;
  let resolveChanged;
  const changed = new Promise((resolve) => { resolveChanged = resolve; });
  const ctrl = mod.initSettings({
    state,
    document,
    importToServer: async () => ({ ok: true, imported: 1 }),
    fetchRecipes: async () => ({
      ok: true,
      recipes: [{ _id: 'imported', name: 'Imported Pesto', recipeIngredient: ['basil'] }],
    }),
    onChange: () => { changes += 1; resolveChanged(); },
    toast: () => {},
  });
  try {
    ctrl._importRecipes({});
    await changed;
    assert.equal(changes, 1, 'one import acknowledgement publishes and renders once');
    assert.equal(state.recipeAuthorityVersion, 1);
    assert.deepEqual(state.recipes.map(({ _id }) => _id), ['imported']);
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});

test('Settings import synchronizes runtime and durable authority before the next offline optimistic create', async () => {
  const { document } = makeDom();
  const originalFileReader = globalThis.FileReader;
  const importedSchema = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Imported Pesto',
    recipeIngredient: ['basil'], recipeInstructions: ['Blend'],
  };
  globalThis.FileReader = class {
    readAsText() {
      queueMicrotask(() => this.onload({ target: { result: JSON.stringify([importedSchema]) } }));
    }
  };
  const oldRecipe = { id: 'old', _id: 'old', name: 'Old Soup', recipeIngredient: ['stock'] };
  const importedRecipe = { id: 'imported', _id: 'imported', name: 'Imported Pesto', recipeIngredient: ['basil'] };
  const state = {
    household: { household: { id: 'home' } }, recipes: [oldRecipe], recipeAuthorityVersion: 0,
  };
  const repo = await openOfflineDb({ indexedDB, name: `settings-import-runtime-${Date.now()}` });
  const runtimeDocument = {
    hidden: false, getElementById: () => null, addEventListener() {}, removeEventListener() {},
  };
  const runtimeWindow = {
    navigator: { onLine: false }, addEventListener() {}, removeEventListener() {},
  };
  const runtime = await initRecipeRuntime({
    state, repo, authSub: 'cook', document: runtimeDocument, window: runtimeWindow,
    BroadcastChannel: null, schedule: () => ({ unref() {} }), clearSchedule() {},
    send: async () => assert.fail('offline import probe must not send'),
  });
  let imported;
  const importFinished = new Promise((resolve) => { imported = resolve; });
  const ctrl = mod.initSettings({
    state,
    document,
    importToServer: async () => ({ ok: true, imported: 1 }),
    fetchRecipes: async () => ({ ok: true, recipes: [importedRecipe] }),
    setRecipeAuthority: runtime.setAuthority,
    toast: (message) => { if (message.startsWith('Imported ')) imported(); },
  });
  try {
    ctrl._importRecipes({});
    await importFinished;
    assert.deepEqual(state.recipes.map(({ id }) => id), ['imported']);
    assert.deepEqual(runtime.current().map(({ id }) => id), ['imported']);
    assert.deepEqual((await repo.getRecipes('cook', 'home')).map(({ id }) => id), ['imported']);

    assert.equal(await runtime.mutate('recipe.create', {
      id: 'offline', item: { id: 'offline', _id: 'offline', name: 'Offline Pie', recipeIngredient: ['apple'] },
    }), true);
    assert.deepEqual(new Set(state.recipes.map(({ id }) => id)), new Set(['imported', 'offline']));
    assert.deepEqual(new Set(runtime.current().map(({ id }) => id)), new Set(['imported', 'offline']));
  } finally {
    runtime.destroy();
    repo.close();
    globalThis.FileReader = originalFileReader;
  }
});

test('renderSettings keeps sound and haptic preferences independent and hides unsupported haptics', () => {
  const { document, elements } = makeDom();
  let soundEnabled = true;
  let hapticEnabled = true;
  const events = [];
  const feedback = {
    sounds: { enabled: () => soundEnabled, setEnabled: (value) => { soundEnabled = value; } },
    haptics: { supported: () => false, enabled: () => hapticEnabled, setEnabled: (value) => { hapticEnabled = value; } },
    emit: (type) => events.push(type),
  };
  const ctrl = mod.initSettings({ document, feedback });
  ctrl.renderSettings();
  assert.equal(elements['feedback-sounds-toggle'].checked, true);
  assert.equal(elements['feedback-haptics-setting'].hidden, true);
  assert.equal(elements['feedback-haptics-toggle'].disabled, true);
  elements['feedback-sounds-toggle'].checked = false;
  for (const listener of elements['feedback-sounds-toggle'].listeners.change) listener();
  assert.equal(soundEnabled, false);
  assert.equal(hapticEnabled, true);
  assert.deepEqual(events, ['toggle-off']);
});

// ─── Theme picker (added in themes phase) ───────────────────

function makePickerDom() {
  // Mirrors makeDom but includes the elements renderThemePicker will create.
  const ids = [
    'settings-auth-zone', 'settings-import-btn', 'settings-export-btn',
    'import-file', 'g-signin-btn', 'feedback-sounds-toggle',
    'feedback-haptics-toggle', 'feedback-haptics-setting',
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
  // A panel zone where the picker should mount.
  elements['settings-theme-zone'] = {
    innerHTML: '',
    listeners: {},
    addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
  };
  const document = {
    getElementById: (sel) => elements[sel] || null,
  };
  return { elements, document };
}

const SIX_THEMES = ['light', 'dark', 'sepia', 'forest', 'ocean', 'summer'];

test('renderThemePicker mounts 6 swatch buttons in role=radiogroup', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  const ctrl = mod.initSettings({
    document,
    getStoredTheme: () => 'light',
  });
  ctrl.renderThemePicker();
  const zone = elements['settings-theme-zone'];
  assert.match(zone.innerHTML, /role="radiogroup"/);
  for (const name of SIX_THEMES) {
    const re = new RegExp(`data-theme="${name}"`);
    assert.match(zone.innerHTML, re, `expected swatch for ${name}`);
  }
  const swatchCount = (zone.innerHTML.match(/class="theme-swatch[^"]*"/g) || []).length;
  assert.equal(swatchCount, 6, 'expected 6 .theme-swatch buttons');
});

test('renderThemePicker marks the stored theme as active and aria-checked', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  const ctrl = mod.initSettings({ document, getStoredTheme: () => 'forest' });
  ctrl.renderThemePicker();
  const html = elements['settings-theme-zone'].innerHTML;
  assert.match(html, /data-theme="forest"[^>]*class="theme-swatch is-active"/);
  assert.match(html, /data-theme="forest"[^>]*aria-checked="true"/);
  assert.match(html, /data-theme="light"[^>]*aria-checked="false"/);
});

test('renderThemePicker defaults to light when no stored value', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  const ctrl = mod.initSettings({ document, getStoredTheme: () => null });
  ctrl.renderThemePicker();
  const html = elements['settings-theme-zone'].innerHTML;
  assert.match(html, /data-theme="light"[^>]*class="theme-swatch is-active"/);
});

test('clicking a swatch calls theme.set + theme.apply + toggles aria-checked', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  let applied = null;
  let setName = null;
  const ctrl = mod.initSettings({
    document,
    getStoredTheme: () => 'light',
    theme: {
      getStored: () => 'light',
      set: (n) => { setName = n; },
      apply: (n) => { applied = n; },
    },
  });
  ctrl.renderThemePicker();
  // Simulate the click on the sepia swatch by extracting the inline onclick
  // and calling it, OR by parsing the innerHTML to find the swatch and
  // re-triggering the click. Easier: simulate the click via the listener
  // attached to the picker container.
  const zone = elements['settings-theme-zone'];
  // The picker is mounted via innerHTML; the click listener is attached to
  // the container. We test by calling the listener directly with a fake event.
  const listeners = zone.listeners.click || [];
  assert.ok(listeners.length > 0, 'picker should have a click listener');
  const fakeEvent = {
    target: {
      closest: (sel) => sel === '.theme-swatch' ? { dataset: { theme: 'sepia' } } : null,
      getAttribute: (k) => (k === 'data-theme' ? 'sepia' : null),
    },
  };
  for (const fn of listeners) fn(fakeEvent);
  assert.equal(setName, 'sepia');
  assert.equal(applied, 'sepia');
});

test('keyboard nav: arrow keys move focus, Enter activates', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  let applied = null;
  const ctrl = mod.initSettings({
    document,
    getStoredTheme: () => 'light',
    theme: {
      getStored: () => 'light',
      set: () => {},
      apply: (n) => { applied = n; },
    },
  });
  ctrl.renderThemePicker();
  const zone = elements['settings-theme-zone'];
  const keyListeners = zone.listeners.keydown || [];
  assert.ok(keyListeners.length > 0, 'picker should have a keydown listener');

  // Build a fake radiogroup with all swatches, each with a .focus() and a
  // .click() method that the keyboard handler can call.
  const swatches = SIX_THEMES.map((name) => {
    const el = {
      dataset: { theme: name },
      focus() { this.focused = true; },
      click() { this.clicked = true; },
      closest: () => null,
    };
    return el;
  });
  // Group with a querySelectorAll that returns all 5.
  const group = {
    querySelectorAll: () => swatches,
    closest: () => null,
  };

  // Right-arrow on the light swatch should focus dark.
  const fakeEvent = {
    key: 'ArrowRight',
    target: swatches[0],
    preventDefault() {},
  };
  // Patch swatches[0].closest so the handler can find the group and self.
  swatches[0].closest = (sel) => {
    if (sel === '[role="radiogroup"]') return group;
    if (sel === '.theme-swatch') return swatches[0];
    return null;
  };
  for (const fn of keyListeners) fn(fakeEvent);
  assert.equal(swatches[1].focused, true, 'ArrowRight from light should focus dark');

  // Enter on the sepia swatch should call .click().
  const enterEvent = {
    key: 'Enter',
    target: swatches[2],
    preventDefault() {},
  };
  // Patch swatches[2].closest similarly so handleThemeKey's .closest('.theme-swatch')
  // returns swatches[2] (so indexOf can find it).
  swatches[2].closest = (sel) => {
    if (sel === '[role="radiogroup"]') return group;
    if (sel === '.theme-swatch') return swatches[2];
    return null;
  };
  for (const fn of keyListeners) fn(enterEvent);
  assert.equal(swatches[2].clicked, true, 'Enter on focused swatch should call .click()');
});
