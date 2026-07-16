import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createThemeRecommendation } from '../docs/js/lib/theme-recommendation.js';

function setup(initial = {}, current = 'light', subject = 'kaysser') {
  const values = { ...initial };
  const listeners = {};
  const banner = {
    hidden: true,
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  const calls = [];
  const controller = createThemeRecommendation({
    subject,
    storage: {
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => { values[key] = String(value); },
    },
    document: { getElementById: (id) => id === 'summer-theme-recommendation' ? banner : null },
    theme: {
      getStored: () => current,
      set: (name) => calls.push(['set', name]),
      apply: (name) => calls.push(['apply', name]),
    },
  });
  return { controller, banner, listeners, values, calls };
}

test('Summer recommendation shows once per household member and marks itself shown immediately', () => {
  const { controller, banner, values } = setup();
  assert.equal(controller.maybeShow(), true);
  assert.equal(banner.hidden, false);
  assert.equal(values['cb_summer_theme_recommendation_v1:kaysser'], '1');
  banner.hidden = true;
  assert.equal(controller.maybeShow(), false);
  assert.equal(setup(values, 'light', 'kaysser').controller.maybeShow(), false,
    'persisted state suppresses a fresh controller on a later app load');
  assert.equal(setup(values, 'light', 'gloria').controller.maybeShow(), true,
    'the other household member keeps an independent one-time recommendation');
});

test('Summer recommendation stays quiet when Summer is already selected', () => {
  const { controller, banner } = setup({}, 'summer');
  assert.equal(controller.maybeShow(), false);
  assert.equal(banner.hidden, true);
});

test('trying Summer stores and applies it, while dismissal only hides the recommendation', () => {
  const { controller, banner, listeners, calls } = setup();
  controller.maybeShow();
  listeners.click({ target: { closest: (selector) => selector === '[data-action="try-summer-theme"]' ? {} : null } });
  assert.deepEqual(calls, [['set', 'summer'], ['apply', 'summer']]);
  assert.equal(banner.hidden, true);

  banner.hidden = false;
  listeners.click({ target: { closest: (selector) => selector === '[data-action="dismiss-summer-theme"]' ? {} : null } });
  assert.equal(banner.hidden, true);
});
