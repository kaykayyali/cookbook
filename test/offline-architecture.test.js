import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = readFileSync(new URL('../docs/js/lib/store.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../docs/js/lib/workspace-runtime.js', import.meta.url), 'utf8');

test('shared household state never uses localStorage as a competing authority', () => {
  const source = `${store}\n${runtime}`;
  for (const key of ['pantry', 'cart', 'shoppingChecked']) {
    assert.doesNotMatch(source, new RegExp(`localStorage\\.(?:getItem|setItem)\\(STORAGE_KEYS\\.${key}`));
  }
});
