// test/e2e-render.test.js — jsdom-based end-to-end render test.
//
// Executes the SOURCE docs/js/app.js boot against a real DOM (jsdom) and
// asserts the page actually renders. This catches the regression where
// app.js called controller factories that returned `render` functions but
// never called them or registered them with the panels router — so the
// recipe grid never rendered and the GIS sign-in button never mounted.
//
// No build required: we import the SOURCE app.js (not the gitignored bundle).
// jsdom's `runScripts: 'outside-only'` loads the HTML DOM but does NOT execute
// the page's <script> tags — so the bundle never runs; only our manual
// `import('../docs/js/app.js')` runs the boot. That isolates the test to the
// source wiring.
//
// Run via: node --test test/e2e-render.test.js (or `npm test` for everything).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Save the original property descriptor for each global we override. Some
// Node globals (notably `navigator`) are getter-only properties — plain
// assignment throws in strict mode (ES modules), so we use Object.defineProperty
// for both install and restore.
const GLOBAL_KEYS = [
  'document', 'window', 'localStorage', 'navigator', 'atob', 'btoa',
  'HTMLElement', 'Node', 'Event', 'CustomEvent', 'crypto',
];
const savedDescriptors = {};

function installGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

before(async () => {
  // Load the real index.html into jsdom. `outside-only` gives us a working
  // DOM (document, window, etc.) WITHOUT executing the page's inline scripts
  // (the theme IIFE and the COOKBOOK_GOOGLE_CLIENT_ID assignment) or the
  // bundle's <script type="module">. That means window.COOKBOOK_GOOGLE_CLIENT_ID
  // is undefined in this test → initGoogleSignIn calls onError async and
  // returns early without appending the GIS <script>. renderAuth() still
  // mounts #g-signin-btn BEFORE calling initGoogleSignIn, so the button is
  // present. Good — we test the source wiring, not the network.
  const html = readFileSync(
    fileURLToPath(new URL('../docs/index.html', import.meta.url)),
    'utf8'
  );
  const dom = new JSDOM(html, {
    url: 'https://cookbook.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  // app.js + the controllers read document/window/localStorage/navigator/crypto
  // (and a few DOM constructors) as globals. Install jsdom's versions onto
  // globalThis BEFORE importing app.js so the boot sees them.
  const overrides = {
    document: dom.window.document,
    window: dom.window,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    atob: dom.window.atob,
    btoa: dom.window.btoa,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    // Node 20+ exposes Web Crypto as globalThis.crypto; jsdom does not provide
    // it, so point at node's webcrypto. The app reads crypto for any future
    // token handling; harmless if unused on this boot path.
    crypto: webcrypto,
  };
  for (const k of GLOBAL_KEYS) {
    savedDescriptors[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    installGlobal(k, overrides[k]);
  }

  // Importing app.js runs the boot top-to-bottom:
  //   init() (store.js) → load() (empty localStorage) → seed() (SEED_RECIPES)
  //   → initPanels/initRecipes/.../initSettings → panels.register(...)
  //   → settings.renderAuth() (mounts #g-signin-btn)
  //   → panels.showPanel('recipes') → recipes.render() → #recipe-grid populated.
  await import('../docs/js/app.js');
});

after(() => {
  // Belt-and-suspenders: node --test runs each test file in its own process,
  // so these globals never leak to other test files. Restore the original
  // descriptors anyway.
  for (const k of GLOBAL_KEYS) {
    const desc = savedDescriptors[k];
    if (desc) {
      Object.defineProperty(globalThis, k, desc);
    } else {
      // Was absent before — delete. (defineProperty with undefined would throw.)
      delete globalThis[k];
    }
  }
});

test('recipe grid renders on boot (seed recipes)', () => {
  const grid = globalThis.document.getElementById('recipe-grid');
  assert.ok(grid, '#recipe-grid exists in the DOM');
  assert.ok(
    grid.children.length > 0,
    'recipe grid populated — render wiring works (recipes.render registered + showPanel("recipes") called it)'
  );
});

test('GIS sign-in button mounts on boot', () => {
  const btn = globalThis.document.getElementById('g-signin-btn');
  assert.ok(
    btn,
    '#g-signin-btn mounted by settings.renderAuth() before initGoogleSignIn runs'
  );
});

test('panel router marked the recipes panel active on boot', () => {
  const panel = globalThis.document.getElementById('panel-recipes');
  assert.ok(panel, '#panel-recipes exists');
  assert.ok(
    panel.classList.contains('active'),
    'recipes panel has .active after panels.showPanel("recipes")'
  );
});

test('recipe count label reflects seeded library', () => {
  const countEl = globalThis.document.getElementById('recipe-count');
  assert.ok(countEl, '#recipe-count exists');
  // SEED_RECIPES has multiple entries; the label should be non-empty and
  // mention "recipe"/"recipes".
  assert.match(countEl.textContent, /recipe/i, 'recipe-count label populated');
});