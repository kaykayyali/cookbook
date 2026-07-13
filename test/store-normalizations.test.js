import { test } from 'node:test';
import assert from 'node:assert/strict';

test('ingredient normalization cache persists independently of active cart selections', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  const { state, save, load } = await import('../docs/js/lib/store.js');
  state.pantry = [];
  state.cart = [];
  state.normalizations = {
    r1: {
      version: 1,
      raw: ['2 eggs'],
      ingredients: [{ raw: '2 eggs', name: 'egg', quantity: 2, unit: 'count', kind: 'indivisible', confidence: .95 }],
    },
  };
  save();
  state.normalizations = {};
  load();
  assert.equal(state.normalizations.r1.version, 1);
  assert.equal(state.normalizations.r1.ingredients[0].name, 'egg');
});
