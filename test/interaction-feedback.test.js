import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  FEEDBACK_EVENTS,
  HAPTICS_KEY,
  LEGACY_SOUNDS_KEY,
  SOUNDS_KEY,
  createHapticAdapter,
  createInteractionFeedback,
  createSoundAdapter,
} from '../docs/js/lib/interaction-feedback.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function audioHarness() {
  const calls = { contexts: 0, starts: [], stops: 0, closes: 0, resumes: 0 };
  class AudioContext {
    constructor() { calls.contexts += 1; this.currentTime = 2; this.destination = {}; this.state = 'running'; }
    resume() { calls.resumes += 1; this.state = 'running'; return Promise.resolve(); }
    close() { calls.closes += 1; this.state = 'closed'; return Promise.resolve(); }
    createOscillator() {
      const oscillator = {
        type: '', frequency: { value: 0, setValueAtTime(value) { oscillator.frequency.value = value; }, exponentialRampToValueAtTime(value) { oscillator.frequency.value = value; }, linearRampToValueAtTime(value) { oscillator.frequency.value = value; } },
        connect() {}, disconnect() {},
        start(time) { calls.starts.push({ time, type: oscillator.type, frequency: oscillator.frequency.value }); },
        stop() { calls.stops += 1; }, onended: null,
      };
      return oscillator;
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  return { AudioContext, calls };
}

test('semantic registry defines distinct selection, toggles, commit, success, destructive, and blocked cues', () => {
  assert.deepEqual(Object.keys(FEEDBACK_EVENTS), ['select', 'toggle-on', 'toggle-off', 'commit', 'success', 'destructive', 'blocked']);
  assert.equal(new Set(Object.values(FEEDBACK_EVENTS).map((event) => JSON.stringify(event.sound))).size, 7);
  assert.deepEqual(FEEDBACK_EVENTS.success.haptic, [14, 34, 18]);
  assert.deepEqual(FEEDBACK_EVENTS.destructive.haptic, [20, 24, 12]);
  assert.equal(FEEDBACK_EVENTS.blocked.haptic, null);
});

test('sound preference migrates the legacy device-local value and remains independent', () => {
  const store = storage({ [LEGACY_SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'on' });
  const sound = createSoundAdapter({ storage: store, AudioContext: null, document: null });
  assert.equal(sound.enabled(), false);
  assert.equal(store.getItem(SOUNDS_KEY), 'off');
  sound.setEnabled(true);
  assert.equal(store.getItem(SOUNDS_KEY), 'on');
  assert.equal(store.getItem(HAPTICS_KEY), 'on');
});

test('sound adapter reuses one context, rate-limits rapid input, stops overlap, and cleans up', () => {
  const { AudioContext, calls } = audioHarness();
  let time = 100;
  const sound = createSoundAdapter({ AudioContext, storage: storage(), document: { visibilityState: 'visible' }, now: () => time, minInterval: 40 });
  assert.equal(sound.play('select', { fromUserGesture: true }), true);
  assert.equal(sound.play('select', { fromUserGesture: true }), false, 'same-frame input is rate-limited');
  time += 50;
  assert.equal(sound.play('commit', { fromUserGesture: true }), true);
  assert.equal(calls.contexts, 1, 'one lazy AudioContext is reused');
  assert.ok(calls.starts.length >= 2);
  assert.ok(calls.stops >= 2, 'active oscillators are stopped before overlap grows');
  sound.destroy();
  assert.equal(calls.closes, 1);
});

test('sound adapter waits for a user gesture before lazy context creation', () => {
  const { AudioContext, calls } = audioHarness();
  const sound = createSoundAdapter({ AudioContext, storage: storage(), document: { visibilityState: 'visible' } });
  assert.equal(sound.play('blocked'), false);
  assert.equal(calls.contexts, 0);
  assert.equal(sound.play('select', { fromUserGesture: true }), true);
  assert.equal(calls.contexts, 1);
});

test('sound adapter silently rejects unsupported, disabled, and background playback', () => {
  const store = storage({ [SOUNDS_KEY]: 'off' });
  const unsupported = createSoundAdapter({ AudioContext: null, storage: store, document: { visibilityState: 'visible' } });
  assert.equal(unsupported.play('select'), false);
  const { AudioContext, calls } = audioHarness();
  const hidden = createSoundAdapter({ AudioContext, storage: storage(), document: { visibilityState: 'hidden' } });
  assert.equal(hidden.play('select'), false);
  assert.equal(calls.contexts, 0);
  class BlockedAudioContext { constructor() { throw new Error('not allowed'); } }
  const blocked = createSoundAdapter({ AudioContext: BlockedAudioContext, storage: storage(), document: { visibilityState: 'visible' } });
  assert.doesNotThrow(() => blocked.play('select', { fromUserGesture: true }));
  assert.equal(blocked.play('select', { fromUserGesture: true }), false);
});

test('haptics require support, visibility, activation and an enabled local preference', () => {
  let time = 10;
  const calls = [];
  const navigator = { userActivation: { isActive: true }, vibrate: (pattern) => { calls.push(pattern); return true; } };
  const document = { visibilityState: 'visible' };
  const adapter = createHapticAdapter({ navigator, document, storage: storage(), now: () => time, minInterval: 40 });
  assert.equal(adapter.supported(), true);
  assert.equal(adapter.pulse('commit', { fromUserGesture: true }), true);
  assert.deepEqual(calls, [FEEDBACK_EVENTS.commit.haptic]);
  assert.equal(adapter.pulse('commit', { fromUserGesture: true }), false, 'rapid pulse is rate-limited');
  time += 50;
  navigator.userActivation.isActive = false;
  assert.equal(adapter.pulse('success', { fromUserGesture: true }), false);
  navigator.userActivation.isActive = true;
  document.visibilityState = 'hidden';
  assert.equal(adapter.pulse('success', { fromUserGesture: true }), false);
  document.visibilityState = 'visible';
  adapter.setEnabled(false);
  assert.equal(adapter.pulse('commit', { fromUserGesture: true }), false);
});

test('unsupported or rejected vibration is a silent no-op', () => {
  const unsupported = createHapticAdapter({ navigator: {}, document: { visibilityState: 'visible' }, storage: storage() });
  assert.equal(unsupported.supported(), false);
  assert.equal(unsupported.pulse('commit', { fromUserGesture: true }), false);
  const rejected = createHapticAdapter({ navigator: { userActivation: { isActive: true }, vibrate() { throw new Error('blocked'); } }, document: { visibilityState: 'visible' }, storage: storage() });
  assert.doesNotThrow(() => rejected.pulse('commit', { fromUserGesture: true }));
  assert.equal(rejected.pulse('commit', { fromUserGesture: true }), false);
  const refused = createHapticAdapter({ navigator: { userActivation: { isActive: true }, vibrate: () => false }, document: { visibilityState: 'visible' }, storage: storage() });
  assert.equal(refused.pulse('commit', { fromUserGesture: true }), false);
});

test('registry delegates only explicit semantic controls and clears visual press state on cleanup', () => {
  const dom = new JSDOM('<button id="save" data-feedback="commit">Save</button><button id="other" data-feedback="select">Other</button><button id="plain">Plain</button><button id="off" data-feedback="toggle-off" disabled>Off</button>');
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
  const emitted = [];
  dom.window.document.addEventListener('cookbook:feedback', (event) => emitted.push(event.detail.type));
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'off' }),
    navigator: {},
    AudioContext: null,
  }).init();
  const save = dom.window.document.getElementById('save');
  save.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(save.classList.contains('is-feedback-pressed'), true);
  dom.window.document.getElementById('other').dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true }));
  assert.equal(save.classList.contains('is-feedback-pressed'), false, 'release on another control cannot strand press state');
  save.click();
  dom.window.document.getElementById('plain').click();
  dom.window.document.getElementById('off').click();
  assert.deepEqual(emitted, ['commit']);
  system.destroy();
  assert.equal(save.classList.contains('is-feedback-pressed'), false);
  save.click();
  assert.deepEqual(emitted, ['commit']);
});

test('a newer outcome replaces the prior visual class and cleans up once', () => {
  const dom = new JSDOM('<button id="save">Save</button>');
  const tasks = [];
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'off' }),
    navigator: {},
    AudioContext: null,
    schedule: (callback) => { const task = { callback, cancelled: false }; tasks.push(task); return task; },
    cancelSchedule: (task) => { task.cancelled = true; },
  });
  const save = dom.window.document.getElementById('save');
  system.emit('commit', { target: save });
  system.emit('blocked', { target: save });
  assert.equal(save.classList.contains('has-feedback-commit'), false);
  assert.equal(save.classList.contains('has-feedback-blocked'), true);
  assert.equal(tasks[0].cancelled, true);
  tasks[1].callback();
  assert.equal(save.classList.contains('has-feedback-blocked'), false);
});

test('synthetic clicks remain observable but cannot trigger haptics', () => {
  const dom = new JSDOM('<button data-feedback="commit">Save</button>');
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
  const calls = [];
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off' }),
    navigator: { vibrate: (pattern) => { calls.push(pattern); return true; } },
    AudioContext: null,
  }).init();
  dom.window.document.querySelector('button').click();
  assert.deepEqual(calls, []);
  system.destroy();
});

test('programmatic outcomes stay observable but never vibrate without a user gesture', () => {
  const dom = new JSDOM('<main></main>');
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
  const haptics = [];
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off' }),
    navigator: { userActivation: { isActive: true }, vibrate: (pattern) => { haptics.push(pattern); return true; } },
    AudioContext: null,
  }).init();
  assert.equal(system.emit('success'), true);
  assert.deepEqual(haptics, []);
  assert.deepEqual(system.emit('unknown'), false);
  system.destroy();
});
