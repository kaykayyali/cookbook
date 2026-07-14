const KEY = 'cb_reminders_v1';
const WEEKLY_SENT_KEY = 'cb_weekly_reminder_date_v1';
const DEFAULTS = Object.freeze({ weeklyPlan: false, postCook: false });

function read(storage) {
  try {
    const value = JSON.parse(storage?.getItem?.(KEY) || 'null');
    return { weeklyPlan: value?.weeklyPlan === true, postCook: value?.postCook === true };
  } catch { return { ...DEFAULTS }; }
}

export function initReminders({
  document = globalThis.document,
  storage = globalThis.localStorage,
  notify = (title, options) => { if (typeof Notification !== 'undefined') return new Notification(title, options); },
  permission = () => globalThis.Notification?.permission || 'denied',
  requestPermission = () => globalThis.Notification?.requestPermission?.(),
  today = () => new Date().toISOString().slice(0, 10),
} = {}) {
  let settings = read(storage);
  const persist = () => storage?.setItem?.(KEY, JSON.stringify(settings));
  const weekly = document?.getElementById?.('weekly-plan-reminder');
  const postCook = document?.getElementById?.('post-cook-reminder');
  if (weekly) weekly.checked = settings.weeklyPlan;
  if (postCook) postCook.checked = settings.postCook;

  function wire(input, key) {
    input?.addEventListener?.('change', async () => {
      settings = { ...settings, [key]: input.checked === true };
      persist();
      if (input.checked && permission() === 'default') await requestPermission();
    });
  }
  wire(weekly, 'weeklyPlan');
  wire(postCook, 'postCook');

  function send(title, body) {
    if (permission() === 'granted') notify(title, { body, tag: `cookbook-${title}` });
  }
  function notifyPostCook(recipeName) {
    if (settings.postCook) send(`How was ${recipeName || 'dinner'}?`, 'Add your rating and a shared memory when you’re ready.');
  }
  function maybeWeeklyPlanReminder(plan = []) {
    if (!settings.weeklyPlan || plan.length) return false;
    const date = today();
    if (storage?.getItem?.(WEEKLY_SENT_KEY) === date) return false;
    send('Plan our week', 'Pick a few dinners together when you have a quiet minute.');
    storage?.setItem?.(WEEKLY_SENT_KEY, date);
    return true;
  }
  return { current: () => ({ ...settings }), notifyPostCook, maybeWeeklyPlanReminder };
}
