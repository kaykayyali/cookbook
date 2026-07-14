import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyHTML } from '../docs/js/controllers/detail.js';

test('recipe detail history exposes member-attributed reactions, memories, correction, and deletion', () => {
  const html = historyHTML([
    { id: 'e1', recipeId: 'r1', cookedAt: Date.UTC(2026, 6, 14), notes: 'Crispy edges' },
  ], [
    { cookEventId: 'e1', memberSub: 'kay', reaction: 'loved', note: 'Make again' },
    { cookEventId: 'e1', memberSub: 'gloria', reaction: 'good', note: 'Less salt' },
  ], 'kay');
  assert.match(html, /Crispy edges/);
  assert.match(html, /You.*Loved/i);
  assert.match(html, /Partner.*Good/i);
  assert.match(html, /shared memory/i);
  assert.match(html, /data-action="save-reaction"/);
  assert.match(html, /data-action="edit-history"/);
  assert.match(html, /data-action="delete-history"/);
});

test('recipe detail history is honest before the first cook', () => {
  assert.match(historyHTML([], [], 'kay'), /not cooked yet/i);
});
