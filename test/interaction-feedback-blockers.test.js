import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  FEEDBACK_EVENTS,
  HAPTICS_KEY,
  LEGACY_HAPTICS_KEY,
  LEGACY_SOUNDS_KEY,
  SOUNDS_KEY,
  createHapticAdapter,
  createInteractionFeedback,
  createSoundAdapter,
} from '../docs/js/lib/interaction-feedback.js';
import { initSettings } from '../docs/js/controllers/settings.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function audioHarness() {
  const calls = { contexts: 0, starts: 0, stops: 0, oscillatorDisconnects: 0, gainDisconnects: 0 };
  class AudioContext {
    constructor() { calls.contexts += 1; this.currentTime = 2; this.destination = {}; this.state = 'running'; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createOscillator() {
      return {
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, start() { calls.starts += 1; }, stop() { calls.stops += 1; },
        disconnect() { calls.oscillatorDisconnects += 1; }, onended: null,
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {}, disconnect() { calls.gainDisconnects += 1; },
      };
    }
  }
  return { AudioContext, calls };
}

test('malformed v2 preferences migrate valid legacy off values instead of re-enabling cues', () => {
  const store = storage({
    [SOUNDS_KEY]: 'definitely-not-a-setting',
    [LEGACY_SOUNDS_KEY]: 'off',
    [HAPTICS_KEY]: '{broken',
    [LEGACY_HAPTICS_KEY]: 'off',
  });
  const sound = createSoundAdapter({ storage: store, AudioContext: null, document: null });
  const haptic = createHapticAdapter({ storage: store, navigator: {}, document: null });
  assert.equal(sound.enabled(), false);
  assert.equal(haptic.enabled(), false);
  assert.equal(store.getItem(SOUNDS_KEY), 'off');
  assert.equal(store.getItem(HAPTICS_KEY), 'off');
});

test('sound rate limiting is semantic so an initiating commit and immediate outcome both play', () => {
  const { AudioContext, calls } = audioHarness();
  const sound = createSoundAdapter({ AudioContext, storage: storage(), document: { visibilityState: 'visible' }, now: () => 100, minInterval: 40 });
  assert.equal(sound.play('commit', { fromUserGesture: true }), true);
  assert.equal(sound.play('success'), true);
  assert.equal(sound.play('success'), false, 'same-type burst remains controlled');
  assert.equal(calls.starts, 3, 'commit plus two-note success both start');
});

test('partial audio graph failures stop and disconnect every node already created', () => {
  const calls = { oscillatorStops: 0, oscillatorDisconnects: 0, gainDisconnects: 0 };
  const oscillator = {
    frequency: { setValueAtTime() {} }, connect() {}, start() {},
    stop() { calls.oscillatorStops += 1; }, disconnect() { calls.oscillatorDisconnects += 1; },
  };
  const gain = {
    gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() { throw new Error('destination refused'); }, disconnect() { calls.gainDisconnects += 1; },
  };
  class AudioContext {
    constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
    createOscillator() { return oscillator; }
    createGain() { return gain; }
    close() { return Promise.resolve(); }
  }
  const sound = createSoundAdapter({ AudioContext, storage: storage(), document: { visibilityState: 'visible' } });
  assert.equal(sound.play('commit', { fromUserGesture: true }), false);
  assert.ok(calls.oscillatorStops >= 1);
  assert.ok(calls.oscillatorDisconnects >= 1);
  assert.ok(calls.gainDisconnects >= 1);
});

test('haptics are touch-origin only while carried touch context reaches an async success', () => {
  const calls = [];
  const navigator = { userActivation: { isActive: true }, vibrate: (pattern) => { calls.push(pattern); return true; } };
  let time = 0;
  const adapter = createHapticAdapter({ navigator, document: { visibilityState: 'visible' }, storage: storage(), now: () => time, minInterval: 40 });
  const touch = { trusted: true, modality: 'touch', touchOrigin: true };
  for (const modality of ['keyboard', 'mouse', 'programmatic']) {
    time += 50;
    assert.equal(adapter.pulse('commit', { interaction: { trusted: true, modality, touchOrigin: false } }), false);
  }
  time += 50;
  assert.equal(adapter.pulse('commit', { interaction: touch }), true);
  navigator.userActivation.isActive = false;
  assert.equal(adapter.pulse('success', { interaction: { ...touch, deferred: true } }), true);
  assert.deepEqual(calls, [FEEDBACK_EVENTS.commit.haptic, FEEDBACK_EVENTS.success.haptic]);
});

test('hidden and originless cleanup never calls vibrate, including vibrate zero', () => {
  const calls = [];
  const document = { visibilityState: 'visible' };
  const navigator = { userActivation: { isActive: true }, vibrate: (pattern) => { calls.push(pattern); return true; } };
  const adapter = createHapticAdapter({ navigator, document, storage: storage(), now: () => 10 });
  adapter.destroy();
  assert.deepEqual(calls, [], 'originless destroy must not call vibrate(0)');
  const touch = { trusted: true, modality: 'touch', touchOrigin: true };
  assert.equal(adapter.pulse('commit', { interaction: touch }), true);
  assert.equal(adapter.cancel(), false, 'originless cancellation cannot reuse stale touch authority');
  adapter.destroy();
  assert.deepEqual(calls, [FEEDBACK_EVENTS.commit.haptic], 'visible originless cleanup must not call vibrate(0)');
  assert.equal(adapter.pulse('commit', { interaction: touch }), true);
  document.visibilityState = 'hidden';
  adapter.destroy({ interaction: { ...touch, deferred: true } });
  assert.deepEqual(calls, [FEEDBACK_EVENTS.commit.haptic, FEEDBACK_EVENTS.commit.haptic], 'hidden cleanup must not call vibrate(0)');
});

test('capture-phase integration observes stopPropagation controls exactly once', () => {
  const dom = new JSDOM('<button id="fab" data-feedback="toggle-on">Open</button>');
  const emitted = [];
  dom.window.document.addEventListener('cookbook:feedback', (event) => emitted.push(event.detail.type));
  const button = dom.window.document.getElementById('fab');
  let system;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    system.emit('toggle-on', { target: button, sourceEvent: event });
  });
  system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'off' }),
    navigator: {}, AudioContext: null,
  }).init();
  button.click();
  assert.deepEqual(emitted, ['toggle-on']);
  system.destroy();
});

test('nested actions never inherit a card select cue when their own feedback is intentionally absent', () => {
  const dom = new JSDOM('<article class="recipe-card" data-feedback="select" role="button"><button data-action="delete">Delete</button></article>');
  const emitted = [];
  dom.window.document.addEventListener('cookbook:feedback', (event) => emitted.push(event.detail.type));
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'off' }),
    navigator: {}, AudioContext: null,
  }).init();
  dom.window.document.querySelector('[data-action="delete"]').click();
  assert.deepEqual(emitted, [], 'a cancelled destructive action stays silent');
  system.destroy();
});

test('adapter and observer exceptions are isolated from visual feedback and one another', () => {
  const dom = new JSDOM('<button id="save">Save</button>');
  const button = dom.window.document.getElementById('save');
  let schedules = 0;
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage(), navigator: {}, AudioContext: null,
    now: () => { throw new Error('clock unavailable'); },
    schedule: () => {
      schedules += 1;
      if (schedules === 1) return 7;
      throw new Error('scheduler unavailable');
    },
    cancelSchedule: () => { throw new Error('scheduler cancellation unavailable'); },
  });
  dom.window.document.dispatchEvent = () => { throw new Error('observer unavailable'); };
  assert.doesNotThrow(() => system.emit('commit', { target: button }));
  assert.equal(button.classList.contains('has-feedback-commit'), true);
  assert.doesNotThrow(() => system.emit('success', { target: button }));
  assert.equal(button.classList.contains('has-feedback-success'), false, 'throwing replacement scheduler fails clean immediately');
  assert.doesNotThrow(() => system.destroy());
});

test('one hundred same-type events stay bounded while distinct outcome cues remain reachable', () => {
  const { AudioContext, calls } = audioHarness();
  let time = 100;
  const system = createInteractionFeedback({
    document: null, storage: storage({ [HAPTICS_KEY]: 'off' }), navigator: {}, AudioContext,
    now: () => time,
  });
  for (let index = 0; index < 100; index += 1) system.emit('commit', { interaction: { trusted: true, modality: 'mouse' } });
  assert.equal(calls.starts, 1);
  system.emit('success', { interaction: { trusted: true, modality: 'mouse', deferred: true } });
  assert.equal(calls.starts, 3);
  time += 50;
  system.emit('commit', { interaction: { trusted: true, modality: 'mouse' } });
  assert.equal(calls.starts, 4);
  system.destroy();
});

test('throwing clocks keep 100-event audio and haptic bursts bounded without suppressing distinct outcomes', () => {
  const { AudioContext, calls: audio } = audioHarness();
  const hapticCalls = [];
  const navigator = {
    userActivation: { isActive: true },
    vibrate(pattern) { hapticCalls.push(pattern); return true; },
  };
  const system = createInteractionFeedback({
    document: { visibilityState: 'visible' },
    storage: storage(),
    navigator,
    AudioContext,
    now: () => { throw new Error('hostile clock'); },
  });
  const mouse = { trusted: true, modality: 'mouse', touchOrigin: false };
  const touch = { trusted: true, modality: 'touch', touchOrigin: true };
  for (let index = 0; index < 100; index += 1) {
    system.sounds.play('commit', { interaction: mouse });
    system.haptics.pulse('commit', { interaction: touch });
  }
  assert.equal(audio.starts, 1, 'throwing clock must not disable same-type audio throttling');
  assert.equal(hapticCalls.length, 1, 'throwing clock must not disable same-type haptic throttling');
  assert.equal(system.sounds.play('success', { interaction: { ...mouse, deferred: true } }), true);
  assert.equal(system.haptics.pulse('success', { interaction: { ...touch, deferred: true } }), true);
  assert.equal(audio.starts, 3, 'commit then two-note success remains audible');
  assert.deepEqual(hapticCalls, [FEEDBACK_EVENTS.commit.haptic, FEEDBACK_EVENTS.success.haptic]);
  system.destroy();
});

test('scheduler failure removes outcome classes immediately and destroy remains exhaustive', () => {
  const dom = new JSDOM('<button id="save">Save</button>');
  const button = dom.window.document.getElementById('save');
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'off' }),
    navigator: {}, AudioContext: null,
    schedule: () => { throw new Error('scheduler unavailable'); },
  });
  assert.doesNotThrow(() => system.emit('commit', { target: button }));
  assert.equal(button.classList.contains('has-feedback-commit'), false, 'failed scheduling fails clean instead of stranding a class');
  assert.doesNotThrow(() => system.destroy());
  for (const type of Object.keys(FEEDBACK_EVENTS)) assert.equal(button.classList.contains(`has-feedback-${type}`), false);
});

test('stale timer callbacks cannot delete replacement cleanup ownership when cancellation throws', () => {
  const dom = new JSDOM('<button id="save">Save</button>');
  const button = dom.window.document.getElementById('save');
  const callbacks = [];
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'off' }),
    navigator: {}, AudioContext: null,
    schedule: (callback) => { callbacks.push(callback); return callbacks.length; },
    cancelSchedule: () => { throw new Error('cannot cancel'); },
  });
  system.emit('commit', { target: button });
  system.emit('success', { target: button });
  callbacks[0]();
  assert.equal(button.classList.contains('has-feedback-success'), true, 'old callback leaves the replacement class alone');
  system.destroy();
  assert.equal(button.classList.contains('has-feedback-success'), false, 'replacement remains owned by destroy');
});

test('throwing vibrate property access is a fail-open unsupported capability and settings still render and persist', () => {
  const store = storage();
  const navigator = {};
  Object.defineProperty(navigator, 'vibrate', { get() { throw new Error('hostile getter'); } });
  const haptics = createHapticAdapter({ navigator, storage: store, document: { visibilityState: 'visible' }, now: () => 1 });
  assert.equal(haptics.supported(), false);
  assert.equal(haptics.pulse('commit', { interaction: { trusted: true, modality: 'touch', touchOrigin: true } }), false);
  assert.equal(haptics.cancel({ trusted: true, modality: 'touch', touchOrigin: true }), false);

  const dom = new JSDOM(`<!doctype html><body>
    <button id="settings-import-btn"></button><button id="settings-export-btn"></button><input id="import-file" />
    <div id="settings-auth-zone"></div><div id="settings-theme-zone"></div>
    <input id="feedback-sounds-toggle" type="checkbox" />
    <label id="feedback-haptics-setting"><input id="feedback-haptics-toggle" type="checkbox" /></label>
  </body>`);
  const feedback = {
    sounds: { enabled: () => true, setEnabled() {} },
    haptics,
    emit() {},
    contextFromEvent() { return null; },
  };
  const settings = initSettings({
    state: {}, document: dom.window.document, feedback,
    loadAuth: () => ({ token: 'test', email: 'kay@example.test' }),
    exportRecipes() {}, theme: { set() {}, apply() {} }, getStoredTheme: () => 'light',
  });
  assert.doesNotThrow(() => settings.renderSettings());
  assert.equal(dom.window.document.getElementById('feedback-haptics-setting').hidden, true);
  assert.equal(dom.window.document.getElementById('feedback-haptics-toggle').disabled, true);
  assert.doesNotThrow(() => haptics.setEnabled(false));
  assert.equal(store.getItem(HAPTICS_KEY), 'off');
  assert.doesNotThrow(() => haptics.destroy());
});

test('throwing AudioContext state and close release the old context and allow reinitialization', () => {
  const calls = { contexts: 0, closes: 0, starts: 0 };
  class HostileAudioContext {
    constructor() {
      calls.contexts += 1;
      this.currentTime = 0;
      this.destination = {};
      this.instance = calls.contexts;
    }
    get state() {
      if (this.instance === 1) throw new Error('hostile state getter');
      return 'running';
    }
    close() { calls.closes += 1; if (this.instance === 1) throw new Error('hostile close'); }
    createOscillator() {
      return {
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, disconnect() {}, start() { calls.starts += 1; }, stop() {}, onended: null,
      };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
  }
  const sound = createSoundAdapter({ AudioContext: HostileAudioContext, storage: storage(), document: { visibilityState: 'visible' }, now: () => 1 });
  assert.equal(sound.play('commit', { fromUserGesture: true }), false);
  assert.equal(sound.play('commit', { fromUserGesture: true }), true, 'a fresh context is created after hostile state access');
  assert.equal(calls.contexts, 2);
  assert.equal(calls.closes, 1, 'the hostile context close was attempted without retaining ownership');
  assert.equal(calls.starts, 1);
  assert.doesNotThrow(() => sound.destroy());
});

test('partial listener registration failure rolls back transactionally and permits clean reinit', () => {
  const installed = [];
  let registrations = 0;
  let fail = true;
  const document = {
    visibilityState: 'visible',
    addEventListener(type, listener, capture) {
      registrations += 1;
      if (fail && registrations === 4) throw new Error('listener rejected');
      installed.push({ type, listener, capture });
    },
    removeEventListener(type, listener, capture) {
      const index = installed.findIndex((entry) => entry.type === type && entry.listener === listener && entry.capture === capture);
      if (index >= 0) installed.splice(index, 1);
    },
  };
  const system = createInteractionFeedback({ document, storage: storage(), navigator: {}, AudioContext: null });
  assert.doesNotThrow(() => system.init(), 'authenticated startup must fail open');
  assert.equal(installed.length, 0, 'every listener installed before failure is removed');
  fail = false;
  assert.doesNotThrow(() => system.init());
  assert.equal(installed.length, 7, 'a later init can complete from a consistent state');
  assert.doesNotThrow(() => system.destroy());
  assert.equal(installed.length, 0);
  assert.doesNotThrow(() => system.destroy(), 'destroy is idempotent after rollback and success');
});

test('one thousand hostile-clock events remain bounded across audio and haptic channels', () => {
  const { AudioContext, calls: audio } = audioHarness();
  const hapticCalls = [];
  const navigator = { userActivation: { isActive: true }, vibrate(pattern) { hapticCalls.push(pattern); return true; } };
  const sound = createSoundAdapter({ AudioContext, storage: storage(), document: { visibilityState: 'visible' }, now: () => Number.NaN });
  const haptic = createHapticAdapter({ navigator, storage: storage(), document: { visibilityState: 'visible' }, now: () => Number.NaN });
  const mouse = { trusted: true, modality: 'mouse', touchOrigin: false };
  const touch = { trusted: true, modality: 'touch', touchOrigin: true };
  for (let index = 0; index < 1_000; index += 1) {
    sound.play('select', { interaction: mouse });
    haptic.pulse('select', { interaction: touch });
  }
  assert.equal(audio.starts, 1);
  assert.deepEqual(hapticCalls, [FEEDBACK_EVENTS.select.haptic]);
  assert.equal(sound.play('commit', { interaction: mouse }), true);
  assert.equal(sound.play('success', { interaction: { ...mouse, deferred: true } }), true);
  assert.equal(haptic.pulse('commit', { interaction: touch }), true);
  assert.equal(haptic.pulse('success', { interaction: { ...touch, deferred: true } }), true);
  assert.equal(audio.starts, 4, 'select + commit + two-note success survive the 1000-event matrix');
  assert.deepEqual(hapticCalls, [FEEDBACK_EVENTS.select.haptic, FEEDBACK_EVENTS.commit.haptic, FEEDBACK_EVENTS.success.haptic]);
  sound.destroy();
  haptic.destroy();
});

test('settings off cancels active audio and only a permitted visible touch haptic', () => {
  const { AudioContext, calls: audio } = audioHarness();
  const sound = createSoundAdapter({ AudioContext, storage: storage(), document: { visibilityState: 'visible' }, now: () => 10 });
  assert.equal(sound.play('commit', { fromUserGesture: true }), true);
  sound.setEnabled(false);
  assert.ok(audio.stops >= 1);
  assert.ok(audio.oscillatorDisconnects >= 1);
  assert.ok(audio.gainDisconnects >= 1);

  const calls = [];
  const document = { visibilityState: 'visible' };
  const navigator = { userActivation: { isActive: true }, vibrate: (pattern) => { calls.push(pattern); return true; } };
  const store = storage();
  const haptic = createHapticAdapter({ navigator, document, storage: store, now: () => 10 });
  const touch = { trusted: true, modality: 'touch', touchOrigin: true };
  assert.equal(haptic.pulse('commit', { interaction: touch }), true);
  haptic.setEnabled(false, { interaction: { ...touch, deferred: true } });
  assert.deepEqual(calls, [FEEDBACK_EVENTS.commit.haptic, 0]);

  haptic.setEnabled(true);
  assert.equal(haptic.pulse('success', { interaction: touch }), true);
  document.visibilityState = 'hidden';
  haptic.setEnabled(false, { interaction: { ...touch, deferred: true } });
  assert.deepEqual(calls, [FEEDBACK_EVENTS.commit.haptic, 0, FEEDBACK_EVENTS.success.haptic], 'hidden settings cleanup never calls vibrate(0)');
});

test('destroy and reinit do not duplicate centralized listeners', () => {
  const dom = new JSDOM('<button id="save" data-feedback="commit">Save</button>');
  const events = [];
  dom.window.document.addEventListener('cookbook:feedback', (event) => events.push(event.detail.type));
  const system = createInteractionFeedback({
    document: dom.window.document,
    storage: storage({ [SOUNDS_KEY]: 'off', [HAPTICS_KEY]: 'off' }),
    navigator: {}, AudioContext: null,
  });
  system.init();
  system.init();
  dom.window.document.getElementById('save').click();
  system.destroy();
  system.init();
  dom.window.document.getElementById('save').click();
  system.destroy();
  assert.deepEqual(events, ['commit', 'commit']);
});
