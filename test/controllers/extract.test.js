// test/controllers/extract.test.js — URL extraction modal + API call.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage so getToken() (which reads from it) doesn't throw in
// tests that don't override getToken.
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

let mod;
try { mod = await import('../../docs/js/controllers/extract.js'); } catch (e) { mod = {}; }

function makeDom() {
  const ids = [
    'url-overlay', 'url-input', 'url-extract-btn', 'url-status',
    'url-signedout', 'url-signedin', 'url-close-btn', 'url-signin-hint-btn',
    'g-signin-btn',
  ];
  const elements = {};
  for (const id of ids) {
    elements[id] = {
      value: '', textContent: '', innerHTML: '', style: { display: '' },
      disabled: false, focused: false,
      focus(){ this.focused = true; },
      addEventListener: () => {},
      querySelector: () => null,
      firstElementChild: null,
      classList: { _set: new Set(), add(c){this._set.add(c)}, remove(c){this._set.delete(c)}, contains(c){return this._set.has(c)}, toggle(c,on){on??=!this._set.has(c);on?this._set.add(c):this._set.delete(c);return on;}, },
    };
  }
  const document = {
    getElementById: (sel) => elements[sel] || null,
    body: { style: { overflow: '' } },
  };
  return { elements, document };
}

test('extract.js exports initExtract', () => {
  assert.equal(typeof mod.initExtract, 'function');
});

test('initExtract returns { open, close, submit }', () => {
  if (!mod.initExtract) return;
  const { document } = makeDom();
  const state = { pendingOpenAfterSave: false };
  const ctrl = mod.initExtract({ state, document });
  assert.equal(typeof ctrl.open, 'function');
  assert.equal(typeof ctrl.close, 'function');
  assert.equal(typeof ctrl.submit, 'function');
});

test('open() adds .open to url-overlay and locks body scroll', () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  const state = {};
  const ctrl = mod.initExtract({ state, document });
  ctrl.open();
  assert.equal(elements['url-overlay'].classList.contains('open'), true);
  assert.equal(document.body.style.overflow, 'hidden');
});

test('open() shows the signed-out block when getToken() returns null', () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  const state = {};
  const ctrl = mod.initExtract({
    state, document,
    getToken: () => null,
  });
  ctrl.open();
  assert.equal(elements['url-signedout'].style.display, '');
  assert.equal(elements['url-signedin'].style.display, 'none');
});

test('open() shows the signed-in block when getToken() returns a token', () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  const state = {};
  const ctrl = mod.initExtract({
    state, document,
    getToken: () => 'fake-token',
  });
  ctrl.open();
  assert.equal(elements['url-signedin'].style.display, '');
  assert.equal(elements['url-signedout'].style.display, 'none');
});

test('open() focuses the URL input for a signed-in user', () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initExtract({ state: {}, document, getToken: () => 'fake-token' });

  ctrl.open();

  assert.equal(elements['url-input'].focused, true);
});

test('paste() reads and trims the clipboard URL into the focused input', async () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initExtract({
    state: {}, document,
    clipboard: { readText: async () => '  https://example.com/recipe  ' },
  });

  await ctrl.paste();

  assert.equal(elements['url-input'].value, 'https://example.com/recipe');
  assert.equal(elements['url-input'].focused, true);
});

test('open() resets url-input value and url-status text', () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  elements['url-input'].value = 'leftover';
  elements['url-status'].textContent = 'leftover';
  const state = {};
  const ctrl = mod.initExtract({ state, document });
  ctrl.open();
  assert.equal(elements['url-input'].value, '');
  assert.equal(elements['url-status'].textContent, '');
});

test('close() removes .open from url-overlay', () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  const state = {};
  const ctrl = mod.initExtract({ state, document });
  ctrl.open();
  ctrl.close();
  assert.equal(elements['url-overlay'].classList.contains('open'), false);
});

test('submit() with empty input is a no-op (no fetch)', async () => {
  if (!mod.initExtract) return;
  const { document } = makeDom();
  let fetched = false;
  const state = {};
  const ctrl = mod.initExtract({
    state, document,
    authFetch: () => { fetched = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
  });
  await ctrl.submit();
  assert.equal(fetched, false, 'empty url should not trigger fetch');
});

test('submit() calls authFetch(/extract) with the URL', async () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  elements['url-input'].value = 'https://example.com/recipe';
  let captured = null;
  const state = {};
  const ctrl = mod.initExtract({
    state, document,
    authFetch: (path, opts) => {
      captured = { path, body: JSON.parse(opts.body) };
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recipe: { name: 'X', recipeIngredient: [] } }) });
    },
  });
  await ctrl.submit();
  assert.equal(captured.path, '/extract');
  assert.equal(captured.body.url, 'https://example.com/recipe');
});

test('submit() on success forwards the durable import draft to the review drawer', async () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  elements['url-input'].value = 'https://example.com/r';
  let openedWith = null;
  let openedOptions = null;
  const state = { pendingOpenAfterSave: false };
  const ctrl = mod.initExtract({
    state, document,
    authFetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ recipe: { name: 'Pasta', recipeIngredient: [] }, importDraftId: 'draft-url-1' }),
    }),
    openPrefilled: (recipe, options) => { openedWith = recipe; openedOptions = options; },
  });
  await ctrl.submit();
  assert.equal(state.pendingOpenAfterSave, true);
  assert.equal(elements['url-overlay'].classList.contains('open'), false);
  assert.equal(openedWith?.name, 'Pasta');
  assert.deepEqual(openedOptions, { importDraftId: 'draft-url-1' });
});

test('submit() on error surfaces the error in url-status', async () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  elements['url-input'].value = 'https://example.com/r';
  const state = {};
  const ctrl = mod.initExtract({
    state, document,
    authFetch: () => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'site blocked' }),
    }),
  });
  await ctrl.submit();
  assert.equal(elements['url-status'].textContent, 'site blocked');
});

test('submit() handles a Cloudflare HTML 502 without exposing a JSON parse error', async () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  elements['url-input'].value = 'https://example.com/r';
  const ctrl = mod.initExtract({
    state: {}, document,
    authFetch: () => Promise.resolve({
      ok: false,
      status: 502,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/html; charset=UTF-8' : null },
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    }),
  });

  await ctrl.submit();

  assert.equal(elements['url-status'].textContent, 'Server error (502) — try again in a minute');
});

test('submit() re-enables the extract button after the call', async () => {
  if (!mod.initExtract) return;
  const { document, elements } = makeDom();
  elements['url-input'].value = 'https://example.com/r';
  const state = {};
  const ctrl = mod.initExtract({
    state, document,
    authFetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ recipe: { name: 'X', recipeIngredient: [] } }),
    }),
    openPrefilled: () => {},
  });
  await ctrl.submit();
  assert.equal(elements['url-extract-btn'].disabled, false);
});
