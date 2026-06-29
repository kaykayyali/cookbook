import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../functions/_lib/whitelist.js';

test('isAllowed matches a listed email case-insensitively', () => {
  assert.equal(isAllowed('You@Example.com', 'you@example.com,Friend@example.com'), true);
  assert.equal(isAllowed('friend@EXAMPLE.com', 'you@example.com,Friend@example.com'), true);
});

test('isAllowed trims whitespace around entries and the input', () => {
  assert.equal(isAllowed(' you@example.com ', ' you@example.com , friend@example.com '), true);
});

test('isAllowed denies emails not on the list', () => {
  assert.equal(isAllowed('stranger@example.com', 'you@example.com'), false);
});

test('isAllowed denies when the list is empty or missing', () => {
  assert.equal(isAllowed('you@example.com', ''), false);
  assert.equal(isAllowed('you@example.com', undefined), false);
  assert.equal(isAllowed('you@example.com', null), false);
});

test('isAllowed denies malformed input', () => {
  assert.equal(isAllowed('', 'you@example.com'), false);
  assert.equal(isAllowed(null, 'you@example.com'), false);
});