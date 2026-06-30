import { test } from 'node:test';
import assert from 'node:assert/strict';

// We exercise theme.js without jsdom — it must accept an injected storage +
// document shim so we don't need a DOM. theme.js exports a factory for tests.
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

test('createTheme reads stored value via injected storage', () => {
  const storage = fakeStorage({ cb_theme: 'dark' });
  const t = createTheme({ storage, document: fakeDocument() });
  assert.equal(t.getStored(), 'dark');
});

test('createTheme returns null when storage is empty', () => {
  const t = createTheme({ storage: fakeStorage(), document: fakeDocument() });
  assert.equal(t.getStored(), null);
});

test('createTheme normalizes only valid values to dark/light', () => {
  const storage = fakeStorage({ cb_theme: 'pink' });
  const t = createTheme({ storage, document: fakeDocument() });
  assert.equal(t.getStored(), null);
});

test('createTheme.apply writes data-theme attribute on documentElement', () => {
  const doc = fakeDocument();
  const t = createTheme({ storage: fakeStorage(), document: doc });
  t.apply('dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
});

test('createTheme.set writes through to storage', () => {
  const storage = fakeStorage();
  const t = createTheme({ storage, document: fakeDocument() });
  t.set('light');
  assert.equal(storage.getItem('cb_theme'), 'light');
});

test('createTheme does not throw when given undefined storage (SSR-safe)', () => {
  const t = createTheme({ storage: undefined, document: fakeDocument() });
  assert.equal(t.getStored(), null);
  assert.doesNotThrow(() => t.apply('light'));
  assert.doesNotThrow(() => t.set('dark'));
});