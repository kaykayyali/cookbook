import { test } from 'node:test';
import assert from 'node:assert/strict';

test('v2 normalization audit and shopping check state persist independently of cart selections', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  const { state, save, load } = await import('../docs/js/lib/store.js');
  state.pantry = [];
  state.cart = [];
  state.normalizations = { r1: { version: 2, raw: ['2 eggs'], ingredients: [{ raw: '2 eggs', name: 'egg', displayName: 'Eggs', countLabel: '', category: 'dairy-eggs', quantity: 2, unit: 'count', kind: 'indivisible', confidence: .95 }] } };
  state.normalizationAudit = { signature: 'set-v2' };
  state.shoppingChecked = { egg: true };
  save();
  state.normalizations = {};
  state.normalizationAudit = {};
  state.shoppingChecked = {};
  load();
  assert.equal(state.normalizations.r1.version, 2);
  assert.equal(state.normalizationAudit.signature, 'set-v2');
  assert.deepEqual(state.shoppingChecked, { egg: true });
  assert.equal(values.has('cb_ingredient_normalizations_v2'), true);
  assert.equal(values.has('cb_ingredient_normalizations_v1'), false);
});
