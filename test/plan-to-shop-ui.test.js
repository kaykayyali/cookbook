import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const cart = readFileSync(new URL('../docs/js/controllers/cart.js', import.meta.url), 'utf8');

test('shopping panel exposes filtering, manual add, and explicit plan date-range generation', () => {
  for (const id of ['shopping-filter', 'shopping-manual-input', 'shopping-manual-add', 'plan-shop-start', 'plan-shop-end', 'plan-shop-generate']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(cart, /generatePlanRange\(start\.value, end\.value\)/);
  assert.match(cart, /addManual\(input\.value\)/);
});

test('plan-to-shop copy states exclusions and deterministic merge behavior', () => {
  assert.match(html, /recipe dinners/i);
  assert.match(html, /keeps manual items/i);
});
