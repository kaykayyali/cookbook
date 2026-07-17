import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSyncStatusPresenter } from '../docs/js/lib/sync-status.js';

function setup() {
  const dom = new JSDOM(`<div id="sync" hidden>
    <span data-message></span>
    <button data-retry hidden>Retry</button>
    <button data-discard hidden>Discard</button>
  </div>`);
  const scheduled = [];
  const presenter = createSyncStatusPresenter({
    banner: dom.window.document.getElementById('sync'),
    messageSelector: '[data-message]', retrySelector: '[data-retry]', discardSelector: '[data-discard]',
    schedule: (fn, ms) => { const task = { fn, ms, cancelled: false }; scheduled.push(task); return task; },
    cancel: (task) => { task.cancelled = true; }, delayMs: 2_000, noun: 'change',
  });
  return { dom, presenter, scheduled };
}

test('normal pending and syncing states stay silent until one debounced timeout', () => {
  const { dom, presenter, scheduled } = setup();
  const banner = dom.window.document.getElementById('sync');
  presenter.update({ status: 'pending', pending: 1 });
  presenter.update({ status: 'syncing', pending: 3 });
  assert.equal(banner.hidden, true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 2_000);
  scheduled[0].fn();
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /still syncing 3 saved changes/i);
  presenter.update({ status: 'synced', pending: 0 });
  assert.equal(banner.hidden, true);
});

test('failures show immediately with recovery controls while brief offline states are debounced', () => {
  const { dom, presenter, scheduled } = setup();
  const banner = dom.window.document.getElementById('sync');
  presenter.update({ status: 'offline', pending: 2 });
  assert.equal(banner.hidden, true);
  assert.equal(scheduled.length, 1);
  presenter.update({ status: 'failed', pending: 2 });
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /needs attention/i);
  assert.equal(banner.querySelector('[data-retry]').hidden, false);
  assert.equal(banner.querySelector('[data-discard]').hidden, false);
});

test('uncertain failures expose Retry without an unsafe Discard action', () => {
  const { dom, presenter, scheduled } = setup();
  const banner = dom.window.document.getElementById('sync');
  presenter.update({ status: 'offline', pending: 1, sequence: 3, discardable: false });
  scheduled[0].fn();
  assert.equal(banner.querySelector('[data-retry]').hidden, false);
  assert.equal(banner.querySelector('[data-discard]').hidden, true);
  presenter.update({ status: 'blocked', pending: 1, sequence: 3, discardable: false });
  assert.equal(banner.querySelector('[data-retry]').hidden, false);
  assert.equal(banner.querySelector('[data-discard]').hidden, true);
});
