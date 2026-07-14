import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');

test('FAB dropdown exposes a Capture from image action', () => {
  assert.match(html, /data-fab-action="image"/);
  assert.match(html, /Capture from image/i);
});

test('image capture overlay provides file input and multi-page ordering', () => {
  assert.match(html, /id="image-capture-overlay"/);
  assert.match(html, /id="image-capture-input"/);
  assert.match(html, /accept="image\//);
  assert.match(html, /multiple/);
  assert.match(html, /id="image-capture-preview"/);
  assert.match(html, /id="image-capture-submit"/);
});

test('image capture UI states review before publish and never auto-publishes', () => {
  assert.match(html, /id="image-capture-status"/);
  assert.match(html, /review/i);
  assert.match(html, /draft/i);
  assert.doesNotMatch(html, /auto.?publish/i);
});

test('cooking mode is reachable from recipe detail and initialized in the signed-in shell', () => {
  assert.match(html, /id="dm-cook-mode-btn"/);
  const shell = readFileSync(new URL('../docs/js/lib/authenticated-ui.js', import.meta.url), 'utf8');
  assert.match(shell, /initCookingMode/);
  assert.match(shell, /onCookMode/);
});

test('image capture copy mentions multi-page ordering and uncertain fields', () => {
  assert.match(html, /multi.?page|multiple pages|reorder/i);
  assert.match(html, /confidence|uncertain/i);
});