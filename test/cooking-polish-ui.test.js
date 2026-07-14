import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');

test('cooking mode overlay exists with large step display and minimal chrome', () => {
  assert.match(html, /id="cooking-mode-overlay"/);
  assert.match(html, /id="cooking-mode-step"/);
  assert.match(html, /id="cook-prev"/);
  assert.match(html, /id="cook-next"/);
  assert.match(html, /data-action="close"/);
  assert.match(html, /cooking-mode-container/);
});

test('cooking mode supports opt-in wake lock with visible toggle', () => {
  assert.match(html, /id="cook-wake-toggle"/);
  assert.match(html, /data-action="toggle-wake"/);
  assert.match(html, /aria-pressed/);
});

test('cooking mode step count is accessible', () => {
  assert.match(html, /id="cook-step-count"/);
  assert.match(html, /aria-live="polite"/);
});

test('cooking mode ingredient context is available', () => {
  assert.match(html, /id="cooking-mode-ingredients"/);
});

test('reminders are opt-in and configurable', () => {
  assert.match(html, /reminder/i);
  assert.match(html, /opt.?in|optional|toggle|setting/i);
});