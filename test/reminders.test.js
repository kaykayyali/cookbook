import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initReminders } from '../docs/js/controllers/reminders.js';

function setup(seed = null) {
  const dom = new JSDOM('<input id="weekly-plan-reminder" type="checkbox"><input id="post-cook-reminder" type="checkbox">');
  const values = new Map(seed ? [['cb_reminders_v1', JSON.stringify(seed)]] : []);
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const notifications = [];
  const controller = initReminders({
    document: dom.window.document, storage,
    notify: (title, options) => notifications.push({ title, options }),
    permission: () => 'granted',
  });
  return { dom, values, notifications, controller };
}

test('weekly-plan and post-cook reminders default off and persist independently', () => {
  const { dom, values, controller } = setup();
  assert.deepEqual(controller.current(), { weeklyPlan: false, postCook: false });
  const weekly = dom.window.document.getElementById('weekly-plan-reminder');
  weekly.checked = true;
  weekly.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(JSON.parse(values.get('cb_reminders_v1')), { weeklyPlan: true, postCook: false });
});

test('post-cook reminder stays silent unless explicitly enabled', () => {
  const off = setup();
  off.controller.notifyPostCook('Soup');
  assert.equal(off.notifications.length, 0);
  const on = setup({ weeklyPlan: false, postCook: true });
  on.controller.notifyPostCook('Soup');
  assert.match(on.notifications[0].title, /Soup/);
});

test('weekly reminder only fires when enabled and the plan is empty', () => {
  const { controller, notifications } = setup({ weeklyPlan: true, postCook: false });
  controller.maybeWeeklyPlanReminder([]);
  assert.equal(notifications.length, 1);
  controller.maybeWeeklyPlanReminder([{ id: 'meal' }]);
  assert.equal(notifications.length, 1);
});
