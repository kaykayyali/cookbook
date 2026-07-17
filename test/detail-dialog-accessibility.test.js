import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initDetail } from '../docs/js/controllers/detail.js';

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="opener">Open recipe</button>
    <div id="detail-overlay"></div>
    <div id="detail-modal" role="dialog" aria-label="Recipe detail">
      <button id="detail-close-btn">Close</button>
      <div class="detail-body"></div>
      <div id="dm-eyebrow"></div><div id="dm-title"></div><div id="dm-meta"></div><div id="dm-author-badge"></div>
      <div id="dm-ingredients"></div><div id="dm-pantry-note"></div><div id="dm-steps"></div>
      <div id="dm-nutrition"><div id="dm-nutrition-grid"></div></div><div id="dm-history"></div>
      <button id="dm-mark-cooked-btn">Mark cooked</button><button id="dm-cook-mode-btn">Cook mode</button>
      <button id="dm-add-all-btn">Add</button><button id="dm-edit-btn">Edit</button><button id="dm-schema-btn">Schema</button>
    </div>
  </body>`, { url: 'https://cookbook.test/', pretendToBeVisual: true });
  const recipe = { _id: 'r1', name: 'Soup', recipeIngredient: ['1 onion'], recipeInstructions: [] };
  const detail = initDetail({ state: { recipes: [recipe], pantry: [], cart: [], normalizations: {} }, document: dom.window.document });
  return { dom, detail };
}

test('recipe detail is modal, focuses inside, traps Tab, closes on Escape, and restores its opener', () => {
  const { dom, detail } = fixture();
  const { document, KeyboardEvent } = dom.window;
  const opener = document.getElementById('opener');
  const modal = document.getElementById('detail-modal');
  const close = document.getElementById('detail-close-btn');
  const last = document.getElementById('dm-schema-btn');
  opener.focus();
  detail.open('r1');
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement, close, 'focus enters at the close control');

  close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, last, 'Shift+Tab wraps to the final control');
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, close, 'Tab wraps to the first control');
  close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(modal.classList.contains('open'), false);
  assert.equal(document.activeElement, opener, 'closing restores the exact opener');
});
