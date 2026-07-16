import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTheme } from '../docs/js/lib/theme.js';

function fakeStorage(initial = {}) {
  const map = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
  };
}

function fakeDocument() {
  const attrs = {};
  return {
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: (k) => attrs[k] ?? null,
    },
  };
}

const THEMES = ['light', 'dark', 'sepia', 'forest', 'ocean', 'summer'];

test('createTheme reads stored value via injected storage', () => {
  const storage = fakeStorage({ cb_theme_v2: 'dark' });
  const t = createTheme({ storage, document: fakeDocument() });
  assert.equal(t.getStored(), 'dark');
});

test('createTheme returns null when storage is empty', () => {
  const t = createTheme({ storage: fakeStorage(), document: fakeDocument() });
  assert.equal(t.getStored(), null);
});

test('createTheme normalizes only valid values (6 themes)', () => {
  const storage = fakeStorage({ cb_theme_v2: 'pink' });
  const t = createTheme({ storage, document: fakeDocument() });
  assert.equal(t.getStored(), null);
});

for (const name of THEMES) {
  test(`createTheme round-trips '${name}' (write, read, apply)`, () => {
    const storage = fakeStorage();
    const doc = fakeDocument();
    const t = createTheme({ storage, document: doc });
    t.set(name);
    assert.equal(storage.getItem('cb_theme_v2'), name);
    assert.equal(t.getStored(), name);
    t.apply(name);
    assert.equal(doc.documentElement.getAttribute('data-theme'), name);
  });
}

test('createTheme silently ignores invalid value on apply', () => {
  const doc = fakeDocument();
  const t = createTheme({ storage: fakeStorage(), document: doc });
  t.apply('neon');
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
});

test('createTheme silently ignores invalid value on set', () => {
  const storage = fakeStorage();
  const t = createTheme({ storage, document: fakeDocument() });
  t.set('neon');
  assert.equal(storage.getItem('cb_theme_v2'), null);
});

test('createTheme does not throw when given undefined storage (SSR-safe)', () => {
  const t = createTheme({ storage: undefined, document: fakeDocument() });
  assert.equal(t.getStored(), null);
  assert.doesNotThrow(() => t.apply('light'));
  assert.doesNotThrow(() => t.set('dark'));
});
