export const LEGACY_SOUNDS_KEY = 'cb_interface_sounds_v1';
export const SOUNDS_KEY = 'cb_interface_sounds_v2';
export const HAPTICS_KEY = 'cb_interface_haptics_v1';

export const FEEDBACK_EVENTS = Object.freeze({
  select: Object.freeze({ sound: Object.freeze([[920, 24, 0, 'triangle', 0.012]]), haptic: Object.freeze([8]) }),
  'toggle-on': Object.freeze({ sound: Object.freeze([[760, 30, 0, 'square', 0.010]]), haptic: Object.freeze([12]) }),
  'toggle-off': Object.freeze({ sound: Object.freeze([[520, 30, 0, 'triangle', 0.010]]), haptic: Object.freeze([12]) }),
  commit: Object.freeze({ sound: Object.freeze([[430, 42, 0, 'triangle', 0.014]]), haptic: Object.freeze([16]) }),
  success: Object.freeze({ sound: Object.freeze([[660, 28, 0, 'triangle', 0.012], [880, 34, 38, 'triangle', 0.010]]), haptic: Object.freeze([14, 34, 18]) }),
  destructive: Object.freeze({ sound: Object.freeze([[190, 48, 0, 'triangle', 0.014]]), haptic: Object.freeze([20, 24, 12]) }),
  blocked: Object.freeze({ sound: Object.freeze([[300, 48, 0, 'triangle', 0.009], [240, 34, 18, 'triangle', 0.007]]), haptic: null }),
});

function readPreference(storage, key, fallback = true) {
  try {
    const value = storage?.getItem?.(key);
    return value == null ? fallback : value !== 'off';
  } catch { return fallback; }
}

function writePreference(storage, key, value) {
  try { storage?.setItem?.(key, value ? 'on' : 'off'); }
  catch { /* Device-local progressive enhancement. */ }
}

function visible(document) {
  return !document || document.visibilityState == null || document.visibilityState === 'visible';
}

export function createSoundAdapter({
  AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
  storage = globalThis.localStorage,
  document = globalThis.document,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  minInterval = 36,
} = {}) {
  let context = null;
  let lastPlayedAt = -Infinity;
  const active = new Set();
  let migrated = false;

  function migrate() {
    if (migrated) return;
    migrated = true;
    try {
      if (storage?.getItem?.(SOUNDS_KEY) == null) {
        const legacy = storage?.getItem?.(LEGACY_SOUNDS_KEY);
        if (legacy === 'on' || legacy === 'off') storage?.setItem?.(SOUNDS_KEY, legacy);
      }
    } catch { /* Storage can be blocked in private contexts. */ }
  }

  function enabled() {
    migrate();
    return readPreference(storage, SOUNDS_KEY, true);
  }

  function stopActive() {
    for (const oscillator of active) {
      try { oscillator.stop?.(); } catch { /* Already stopped. */ }
      try { oscillator.disconnect?.(); } catch { /* Optional cleanup. */ }
    }
    active.clear();
  }

  function play(type, { fromUserGesture = false } = {}) {
    const cue = FEEDBACK_EVENTS[type];
    const playedAt = now();
    if (!cue || !AudioContext || !enabled() || !visible(document) || (!context && !fromUserGesture)
        || playedAt - lastPlayedAt < minInterval) return false;
    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') void context.resume?.().catch?.(() => {});
      stopActive();
      const start = context.currentTime;
      for (const [frequency, durationMs, delayMs, oscillatorType, peak] of cue.sound) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const cueStart = start + (delayMs / 1000);
        const cueEnd = cueStart + (durationMs / 1000);
        oscillator.type = oscillatorType;
        oscillator.frequency.setValueAtTime(frequency, cueStart);
        if (type === 'blocked' && oscillator.frequency.exponentialRampToValueAtTime) {
          oscillator.frequency.exponentialRampToValueAtTime(Math.max(120, frequency * 0.8), cueEnd);
        }
        gain.gain.setValueAtTime(0.0001, cueStart);
        gain.gain.linearRampToValueAtTime?.(peak, cueStart + 0.004);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.01), cueEnd);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          active.delete(oscillator);
          try { oscillator.disconnect?.(); gain.disconnect?.(); } catch { /* Optional cleanup. */ }
        };
        active.add(oscillator);
        oscillator.start(cueStart);
        oscillator.stop(cueEnd);
      }
      lastPlayedAt = playedAt;
      return true;
    } catch {
      stopActive();
      return false;
    }
  }

  return {
    enabled,
    setEnabled(value) { migrate(); writePreference(storage, SOUNDS_KEY, Boolean(value)); },
    play,
    destroy() {
      stopActive();
      if (context && context.state !== 'closed') {
        try { void context.close?.().catch?.(() => {}); } catch { /* Optional cleanup. */ }
      }
      context = null;
      lastPlayedAt = -Infinity;
    },
  };
}

export function createHapticAdapter({
  navigator = globalThis.navigator,
  document = globalThis.document,
  storage = globalThis.localStorage,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  minInterval = 44,
} = {}) {
  let lastPulseAt = -Infinity;
  const supported = () => typeof navigator?.vibrate === 'function';
  const enabled = () => readPreference(storage, HAPTICS_KEY, true);
  return {
    supported,
    enabled,
    setEnabled(value) { writePreference(storage, HAPTICS_KEY, Boolean(value)); },
    pulse(type, { fromUserGesture = false } = {}) {
      const pattern = FEEDBACK_EVENTS[type]?.haptic;
      const pulseAt = now();
      if (!pattern || !supported() || !enabled() || !visible(document) || !fromUserGesture
          || navigator?.userActivation?.isActive === false || pulseAt - lastPulseAt < minInterval) return false;
      try {
        const accepted = navigator.vibrate([...pattern]);
        if (accepted === false) return false;
        lastPulseAt = pulseAt;
        return true;
      } catch { return false; }
    },
    destroy() {
      try { if (supported()) navigator.vibrate(0); } catch { /* Rejection is a silent no-op. */ }
      lastPulseAt = -Infinity;
    },
  };
}

function semanticControl(target) {
  const control = target?.closest?.('[data-feedback]');
  if (!control || control.disabled || control.getAttribute?.('aria-disabled') === 'true') return null;
  return FEEDBACK_EVENTS[control.dataset.feedback] ? control : null;
}

function dispatchObserved(document, type, target) {
  const CustomEvent = document?.defaultView?.CustomEvent || globalThis.CustomEvent;
  if (!document?.dispatchEvent || typeof CustomEvent !== 'function') return;
  document.dispatchEvent(new CustomEvent('cookbook:feedback', { detail: { type, targetId: target?.id || null } }));
}

export function createInteractionFeedback({
  document = globalThis.document,
  storage = globalThis.localStorage,
  navigator = globalThis.navigator,
  AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
  now,
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  cancelSchedule = (id) => globalThis.clearTimeout(id),
} = {}) {
  const sounds = createSoundAdapter({ AudioContext, storage, document, now });
  const haptics = createHapticAdapter({ navigator, storage, document, now });
  const pressed = new Set();
  const outcomeTimers = new Map();
  let initialized = false;

  function release(control) {
    if (!control) return;
    control.classList?.remove('is-feedback-pressed');
    pressed.delete(control);
  }
  function releaseAll() {
    for (const control of pressed) release(control);
  }
  function handlePress(event) {
    const control = semanticControl(event.target);
    if (!control) return;
    control.classList.add('is-feedback-pressed');
    pressed.add(control);
  }
  function handleRelease() { releaseAll(); }
  function emit(type, { target = null, sourceEvent = null, fromUserGesture = Boolean(sourceEvent?.isTrusted) } = {}) {
    if (!FEEDBACK_EVENTS[type]) return false;
    sounds.play(type, { fromUserGesture });
    haptics.pulse(type, { fromUserGesture });
    if (target?.classList) {
      const className = `has-feedback-${type}`;
      if (outcomeTimers.has(target)) cancelSchedule(outcomeTimers.get(target));
      for (const eventType of Object.keys(FEEDBACK_EVENTS)) target.classList.remove(`has-feedback-${eventType}`);
      target.classList.add(className);
      outcomeTimers.set(target, schedule(() => {
        target.classList.remove(className);
        outcomeTimers.delete(target);
      }, 140));
    }
    dispatchObserved(document, type, target);
    return true;
  }
  function handleClick(event) {
    const control = semanticControl(event.target);
    if (control) emit(control.dataset.feedback, { target: control, sourceEvent: event });
  }
  function handleKeyDown(event) {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) handlePress(event);
  }
  function handleKeyUp(event) {
    if (event.key === ' ' || event.key === 'Enter') handleRelease(event);
  }

  const listeners = [
    ['pointerdown', handlePress], ['pointerup', handleRelease], ['pointercancel', handleRelease],
    ['click', handleClick], ['keydown', handleKeyDown], ['keyup', handleKeyUp],
    ['visibilitychange', releaseAll],
  ];

  return {
    sounds,
    haptics,
    emit,
    init() {
      if (!initialized && document?.addEventListener) {
        for (const [type, listener] of listeners) document.addEventListener(type, listener);
        initialized = true;
      }
      return this;
    },
    destroy() {
      if (initialized) for (const [type, listener] of listeners) document?.removeEventListener?.(type, listener);
      initialized = false;
      releaseAll();
      for (const [target, timer] of outcomeTimers) {
        cancelSchedule(timer);
        for (const type of Object.keys(FEEDBACK_EVENTS)) target.classList?.remove(`has-feedback-${type}`);
      }
      outcomeTimers.clear();
      sounds.destroy();
      haptics.destroy();
    },
  };
}

export const interactionFeedback = createInteractionFeedback();
