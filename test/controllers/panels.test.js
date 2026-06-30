// test/controllers/panels.test.js — behaviour tests for the panel router.

import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod;
try {
  mod = await import('../../docs/js/controllers/panels.js');
} catch (e) {
  mod = {};
}

// ── Minimal DOM stub ────────────────────────────────────────────────────────
// Mirrors the slice of the DOM API the panels controller touches: classList
// toggle, dataset, body.dataset assignment, and querySelectorAll returning
// arrays of "elements" with add/remove/contains classList methods.
function makeElement(id, classes = [], dataAttrs = {}) {
  const el = {
    id,
    classList: {
      _set: new Set(classes),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) {
        if (on === undefined) on = !this._set.has(c);
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      },
    },
    dataset: { ...dataAttrs },
  };
  return el;
}

function makeDom(panels = ['recipes', 'pantry', 'cart', 'settings']) {
  const body = { dataset: {} };
  const panelEls = panels.map((p) => makeElement(`panel-${p}`, []));
  const navEls = panels.map((p) => makeElement('nav', [], { panel: p }));
  const document = {
    body,
    querySelectorAll(sel) {
      if (sel === '.panel') return panelEls;
      if (sel === '.nav-item[data-panel]') return navEls;
      return [];
    },
  };
  return { document, panelEls, navEls, body };
}

test('panels.js exports initPanels', () => {
  assert.equal(typeof mod.initPanels, 'function', 'initPanels must be a function export');
});

test('initPanels returns { showPanel, register, renderActive }', () => {
  if (!mod.initPanels) return;
  const { document } = makeDom();
  const ctrl = mod.initPanels({ state: {}, document });
  assert.equal(typeof ctrl.showPanel, 'function');
  assert.equal(typeof ctrl.register, 'function');
  assert.equal(typeof ctrl.renderActive, 'function');
});

test('showPanel toggles .active on the matching panel and strips it from siblings', () => {
  if (!mod.initPanels) return;
  const { document, panelEls } = makeDom();
  const ctrl = mod.initPanels({ state: {}, document });
  ctrl.showPanel('pantry');
  assert.equal(panelEls[0].classList.contains('active'), false, 'recipes should not be active');
  assert.equal(panelEls[1].classList.contains('active'), true, 'pantry should be active');
  assert.equal(panelEls[2].classList.contains('active'), false, 'cart should not be active');
  assert.equal(panelEls[3].classList.contains('active'), false, 'settings should not be active');
});

test('showPanel toggles .active on the matching nav-item', () => {
  if (!mod.initPanels) return;
  const { document, navEls } = makeDom();
  const ctrl = mod.initPanels({ state: {}, document });
  ctrl.showPanel('cart');
  assert.equal(navEls[2].classList.contains('active'), true, 'cart nav-item should be active');
  assert.equal(navEls[0].classList.contains('active'), false);
});

test('showPanel mirrors the active panel on body.dataset.panel', () => {
  if (!mod.initPanels) return;
  const { document, body } = makeDom();
  const ctrl = mod.initPanels({ state: {}, document });
  ctrl.showPanel('settings');
  assert.equal(body.dataset.panel, 'settings');
});

test('register + showPanel fires the registered renderer once', () => {
  if (!mod.initPanels) return;
  const { document } = makeDom();
  const ctrl = mod.initPanels({ state: {}, document });
  const calls = [];
  ctrl.register('pantry', () => calls.push('pantry'));
  ctrl.showPanel('pantry');
  ctrl.showPanel('cart');   // no render fn for cart → no error
  ctrl.showPanel('pantry'); // showPanel re-fires the renderer
  assert.deepEqual(calls, ['pantry', 'pantry']);
});

test('register replaces an existing handler for the same panel', () => {
  if (!mod.initPanels) return;
  const { document } = makeDom();
  const ctrl = mod.initPanels({ state: {}, document });
  let n = 0;
  ctrl.register('x', () => n++);
  ctrl.register('x', () => n += 10);
  ctrl.showPanel('x');
  assert.equal(n, 10, 'second register must replace the first');
});

test('renderActive re-fires the renderer for the current panel', () => {
  if (!mod.initPanels) return;
  const { document } = makeDom();
  const ctrl = mod.initPanels({ state: {}, document });
  let n = 0;
  ctrl.register('pantry', () => n++);
  ctrl.showPanel('pantry');
  ctrl.renderActive();
  assert.equal(n, 2, 'renderActive should re-fire pantry renderer');
});
