// test/controllers/fab.test.js — FAB toggle + dropdown action dispatch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

let mod;
try { mod = await import('../../docs/js/controllers/fab.js'); } catch (e) { mod = {}; }

function makeDom() {
  const ids = ['fab-new', 'fab-dropdown', 'fab-stack'];
  const initialHidden = new Set(['fab-dropdown']);
  const elements = {};
  for (const id of ids) {
    elements[id] = {
      attrs: initialHidden.has(id) ? { hidden: '' } : { 'aria-expanded': 'false' },
      _setAttribute: { 'aria-expanded': 'false' },
      listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; this._setAttribute[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; delete this._setAttribute[k]; },
      getAttribute(k) { return this.attrs[k]; },
      hasAttribute(k) { return k in this.attrs; },
      addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
      removeEventListener(evt) { delete this.listeners[evt]; },
      click() { for (const fn of (this.listeners.click || [])) fn(); },
      classList: { _set: new Set(), add(){}, remove(){}, contains(){return false}, toggle(){} },
    };
  }
  const document = {
    getElementById: (sel) => elements[sel] || null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { elements, document };
}

test('fab.js exports initFab', () => {
  assert.equal(typeof mod.initFab, 'function');
});

test('initFab returns { toggle, open, close, handleAction }', () => {
  if (!mod.initFab) return;
  const { document } = makeDom();
  const ctrl = mod.initFab({ document });
  assert.equal(typeof ctrl.toggle, 'function');
  assert.equal(typeof ctrl.open, 'function');
  assert.equal(typeof ctrl.close, 'function');
  assert.equal(typeof ctrl.handleAction, 'function');
});

test('toggle() opens the dropdown when closed', () => {
  if (!mod.initFab) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initFab({ document });
  ctrl.toggle();
  assert.equal(elements['fab-dropdown'].hasAttribute('hidden'), false);
  assert.equal(elements['fab-new'].getAttribute('aria-expanded'), 'true');
});

test('toggle() closes the dropdown when open', () => {
  if (!mod.initFab) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initFab({ document });
  ctrl.toggle();
  ctrl.toggle();
  assert.equal(elements['fab-dropdown'].hasAttribute('hidden'), true);
  assert.equal(elements['fab-new'].getAttribute('aria-expanded'), 'false');
});

test('open() shows the dropdown; close() hides it', () => {
  if (!mod.initFab) return;
  const { document, elements } = makeDom();
  const ctrl = mod.initFab({ document });
  ctrl.open();
  assert.equal(elements['fab-dropdown'].hasAttribute('hidden'), false);
  ctrl.close();
  assert.equal(elements['fab-dropdown'].hasAttribute('hidden'), true);
});

test('handleAction("manual") calls openDrawer with null and closes the dropdown', () => {
  if (!mod.initFab) return;
  const { document } = makeDom();
  let openedWith = null;
  const ctrl = mod.initFab({
    document,
    openDrawer: (id) => { openedWith = id; },
    extract: { open: () => {} },
  });
  ctrl.open();
  const e = { stopPropagation: () => {} };
  ctrl.handleAction('manual', e);
  assert.equal(openedWith, null);
});

test('handleAction("url") calls extract.open when signed in', () => {
  if (!mod.initFab) return;
  const { document } = makeDom();
  let extracted = false;
  let drawerCalled = false;
  const ctrl = mod.initFab({
    document,
    openDrawer: () => { drawerCalled = true; },
    extract: { open: () => { extracted = true; } },
    getToken: () => 'token',
  });
  const e = { stopPropagation: () => {} };
  ctrl.handleAction('url', e);
  assert.equal(extracted, true, 'should call extract.open when signed in');
  assert.equal(drawerCalled, false);
});

test('handleAction("url") when signed out sets pendingOpenUrlModal and clicks the sign-in button', async () => {
  if (!mod.initFab) return;
  const { document, elements } = makeDom();
  let clicked = false;
  const fakeButton = { click: () => { clicked = true; } };
  elements['g-signin-btn-stub'] = { querySelector: () => fakeButton, firstElementChild: null };
  const state = { pendingOpenUrlModal: false };
  let switchedPanel = null;
  const ctrl = mod.initFab({
    document,
    state,
    openDrawer: () => {},
    extract: { open: () => {} },
    getToken: () => null,
    showPanel: (id) => { switchedPanel = id; },
    gSigninBtnId: 'g-signin-btn-stub',
  });
  const e = { stopPropagation: () => {} };
  ctrl.handleAction('url', e);
  assert.equal(switchedPanel, 'settings');
  assert.equal(state.pendingOpenUrlModal, true);
  // Wait for setTimeout
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(clicked, true, 'should click the g-signin-btn');
});
