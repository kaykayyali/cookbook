import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createClickSound, CLICK_SOUND_KEY } from '../docs/js/lib/click-sound.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('enabled app buttons play one delegated click while disabled controls stay silent', () => {
  const dom = new JSDOM(`<button id="enabled"><span>Save</span></button>
    <button id="disabled" disabled>Disabled</button>
    <span id="aria-disabled" role="button" aria-disabled="true">Unavailable</span>`);
  let played = 0;
  const sounds = createClickSound({
    document: dom.window.document, storage: storage(), play: () => { played += 1; },
  });
  sounds.init();
  dom.window.document.querySelector('#enabled span').click();
  dom.window.document.getElementById('disabled').click();
  dom.window.document.getElementById('aria-disabled').click();
  assert.equal(played, 1);
});

test('interface sounds default on and persist as a device-local preference', () => {
  const store = storage();
  const sounds = createClickSound({ document: null, storage: store, play: () => {} });
  assert.equal(sounds.enabled(), true);
  sounds.setEnabled(false);
  assert.equal(store.getItem(CLICK_SOUND_KEY), 'off');
  assert.equal(sounds.enabled(), false);
  sounds.setEnabled(true);
  assert.equal(store.getItem(CLICK_SOUND_KEY), 'on');
});
