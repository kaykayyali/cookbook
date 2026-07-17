import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { dismissToast, toast } from '../docs/js/lib/dom.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('expired action toast destroys button focus and callback authority', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="toast"></div></body>');
  globalThis.document = dom.window.document;
  let calls = 0;
  toast('Removed.', { actionLabel: 'Undo', onAction: () => { calls += 1; }, duration: 5 });
  const stale = dom.window.document.querySelector('[data-toast-action]');
  stale.focus();
  await wait(20);
  assert.equal(dom.window.document.querySelector('[data-toast-action]'), null);
  assert.notEqual(dom.window.document.activeElement, stale);
  stale.click();
  assert.equal(calls, 0, 'a retained reference cannot execute an expired action');
});

test('explicit toast lifecycle cleanup revokes the active action idempotently', () => {
  const dom = new JSDOM('<!doctype html><body><div id="toast"></div></body>');
  globalThis.document = dom.window.document;
  let calls = 0;
  const cleanup = toast('Undoable', { actionLabel: 'Undo', onAction: () => { calls += 1; } });
  const stale = dom.window.document.querySelector('[data-toast-action]');
  assert.equal(cleanup(), true);
  assert.equal(cleanup(), false);
  assert.equal(dismissToast(), false);
  stale.click();
  assert.equal(calls, 0);
});

test('replacing an action toast revokes the old listener before publishing the new action', () => {
  const dom = new JSDOM('<!doctype html><body><div id="toast"></div></body>');
  globalThis.document = dom.window.document;
  const calls = [];
  toast('First', { actionLabel: 'Undo first', onAction: () => calls.push('first'), duration: 1000 });
  const stale = dom.window.document.querySelector('[data-toast-action]');
  toast('Second', { actionLabel: 'Undo second', onAction: () => calls.push('second'), duration: 1000 });
  stale.click();
  assert.deepEqual(calls, []);
  dom.window.document.querySelector('[data-toast-action]').click();
  assert.deepEqual(calls, ['second']);
});
