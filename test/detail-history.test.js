import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { historyHTML, initDetail } from '../docs/js/controllers/detail.js';

test('recipe detail history separates shared Occasion from personal star ratings and Review', () => {
  const html = historyHTML([
    { id: 'e1', recipeId: 'r1', cookedAt: Date.UTC(2026, 6, 14), occasion: 'Anniversary dinner' },
  ], [
    { cookEventId: 'e1', memberSub: 'kay', taste: 5, complexity: 2, review: 'Make again' },
    { cookEventId: 'e1', memberSub: 'gloria', taste: 4, complexity: 3, review: 'Less salt' },
  ], 'kay');
  assert.match(html, /Occasion/i);
  assert.match(html, /Anniversary dinner/);
  assert.match(html, /Review/i);
  assert.match(html, /Make again/);
  assert.match(html, /data-rating="taste"/);
  assert.match(html, /data-rating="complexity"/);
  assert.match(html, /role="radiogroup" aria-label="Taste"/);
  assert.match(html, /role="radiogroup" aria-label="Complexity"/);
  assert.match(html, /data-action="save-review"/);
  assert.match(html, /data-action="save-occasion"/);
  assert.doesNotMatch(html, /Loved it|Not for us|Shared memory/);
  assert.match(html, /data-action="edit-history"/);
  assert.match(html, /data-action="delete-history"/);
});

test('recipe detail history is honest before the first cook', () => {
  assert.match(historyHTML([], [], 'kay'), /not cooked yet/i);
});

test('history renders whichever independent ratings are available', () => {
  const tasteOnly = historyHTML(
    [{ id: 'e1', recipeId: 'r1', cookedAt: 1 }],
    [{ cookEventId: 'e1', memberSub: 'kay', taste: 4, complexity: null, review: '' }],
    'kay',
  );
  assert.match(tasteOnly, /Taste ★★★★☆/);
  assert.doesNotMatch(tasteOnly, /Complexity ★/);
});

test('star radiogroups use one tab stop and support Arrow and End keys', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="detail-modal"></div><div id="detail-overlay"></div>
    <div id="dm-history"></div><div class="detail-body"></div>
  </body>`, { url: 'https://cookbook.test/', pretendToBeVisual: true });
  const document = dom.window.document;
  const state = { recipes: [{ _id: 'r1', name: 'Soup' }], pantry: [], auth: { sub: 'kay' } };
  initDetail({
    state, document,
    getHistory: () => [{ id: 'e1', recipeId: 'r1', cookedAt: Date.UTC(2026, 6, 14) }],
    getReactions: () => [],
  }).open('r1');
  const stars = [...document.querySelectorAll('[data-rating="taste"][data-value]')];
  assert.deepEqual(stars.map((star) => star.tabIndex), [0, -1, -1, -1, -1]);
  stars[0].focus();
  stars[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(document.activeElement, stars[1]);
  assert.equal(stars[1].getAttribute('aria-checked'), 'true');
  stars[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(document.activeElement, stars[4]);
  assert.equal(stars[4].getAttribute('aria-checked'), 'true');
});

test('Save my review accepts Taste-only and Review-only feedback', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="detail-modal"></div><div id="detail-overlay"></div>
    <div id="dm-history"></div><div class="detail-body"></div>
  </body>`, { url: 'https://cookbook.test/', pretendToBeVisual: true });
  const document = dom.window.document;
  const saved = [];
  const state = { recipes: [{ _id: 'r1', name: 'Soup' }], pantry: [], auth: { sub: 'kay' } };
  const detail = initDetail({
    state, document,
    getHistory: () => [{ id: 'e1', recipeId: 'r1', cookedAt: Date.UTC(2026, 6, 14) }],
    getReactions: () => [],
    notify: () => {},
    onReact: async (_eventId, feedback) => { saved.push(feedback); return true; },
  });
  detail.open('r1');
  document.querySelector('[data-rating="taste"][data-value="4"]').click();
  document.querySelector('[data-action="save-review"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saved[0], { taste: 4, complexity: null, review: '' });

  document.querySelector('[data-review]').value = 'Lovely with lemon';
  document.querySelector('[data-action="save-review"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saved[1], { taste: null, complexity: null, review: 'Lovely with lemon' });
});
