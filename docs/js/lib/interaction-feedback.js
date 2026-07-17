export const LEGACY_SOUNDS_KEY = 'cb_interface_sounds_v1';
export const SOUNDS_KEY = 'cb_interface_sounds_v2';
export const LEGACY_HAPTICS_KEY = 'cb_interface_haptics_v1';
export const HAPTICS_KEY = 'cb_interface_haptics_v2';

export const FEEDBACK_EVENTS = Object.freeze({
  select: Object.freeze({ sound: Object.freeze([[920, 24, 0, 'triangle', 0.012]]), haptic: Object.freeze([8]) }),
  'toggle-on': Object.freeze({ sound: Object.freeze([[760, 30, 0, 'square', 0.010]]), haptic: Object.freeze([12]) }),
  'toggle-off': Object.freeze({ sound: Object.freeze([[520, 30, 0, 'triangle', 0.010]]), haptic: Object.freeze([12]) }),
  commit: Object.freeze({ sound: Object.freeze([[430, 42, 0, 'triangle', 0.014]]), haptic: Object.freeze([16]) }),
  success: Object.freeze({ sound: Object.freeze([[660, 28, 0, 'triangle', 0.012], [880, 34, 38, 'triangle', 0.010]]), haptic: Object.freeze([14, 34, 18]) }),
  destructive: Object.freeze({ sound: Object.freeze([[190, 48, 0, 'triangle', 0.014]]), haptic: Object.freeze([20, 24, 12]) }),
  blocked: Object.freeze({ sound: Object.freeze([[300, 48, 0, 'triangle', 0.009], [240, 34, 18, 'triangle', 0.007]]), haptic: null }),
});

const VALID_PREFERENCES = new Set(['on', 'off']);

function readMigratedPreference(storage, key, legacyKey, fallback = true) {
  try {
    const current = storage?.getItem?.(key);
    if (VALID_PREFERENCES.has(current)) return current === 'on';
    const legacy = storage?.getItem?.(legacyKey);
    if (VALID_PREFERENCES.has(legacy)) {
      storage?.setItem?.(key, legacy);
      return legacy === 'on';
    }
    return fallback;
  } catch { return fallback; }
}

function writePreference(storage, key, value) {
  try { storage?.setItem?.(key, value ? 'on' : 'off'); }
  catch { /* Device-local progressive enhancement. */ }
}

function visible(document) {
  try { return !document || document.visibilityState == null || document.visibilityState === 'visible'; }
  catch { return false; }
}

function safeNow(now) {
  try {
    const value = Number(now?.());
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

export function createSoundAdapter({
  AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
  storage = globalThis.localStorage,
  document = globalThis.document,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  minInterval = 36,
} = {}) {
  let context = null;
  const lastPlayedByType = new Map();
  const active = new Set();

  function enabled() {
    return readMigratedPreference(storage, SOUNDS_KEY, LEGACY_SOUNDS_KEY, true);
  }

  function cleanNode(record, { stop = true } = {}) {
    if (!record) return;
    if (stop) try { record.oscillator?.stop?.(); } catch { /* Already stopped. */ }
    try { record.oscillator?.disconnect?.(); } catch { /* Optional cleanup. */ }
    try { record.gain?.disconnect?.(); } catch { /* Optional cleanup. */ }
    active.delete(record);
  }

  function stopActive() {
    for (const record of [...active]) cleanNode(record);
  }

  function play(type, { fromUserGesture = false, interaction = null } = {}) {
    const cue = FEEDBACK_EVENTS[type];
    const gesture = fromUserGesture || Boolean(interaction?.trusted && interaction?.modality !== 'programmatic');
    if (!cue || !AudioContext || !enabled() || !visible(document) || (!context && !gesture)) return false;
    const playedAt = safeNow(now);
    const lastPlayedAt = lastPlayedByType.get(type);
    if (playedAt != null && lastPlayedAt != null && playedAt - lastPlayedAt < minInterval) return false;

    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') {
        try {
          const resumed = context.resume?.();
          resumed?.catch?.(() => {});
        } catch { /* A blocked resume does not break visual/observer feedback. */ }
      }
      stopActive();
      const start = context.currentTime;
      for (const [frequency, durationMs, delayMs, oscillatorType, peak] of cue.sound) {
        const record = { oscillator: null, gain: null };
        try {
          record.oscillator = context.createOscillator();
          active.add(record);
          record.gain = context.createGain();
          const cueStart = start + (delayMs / 1000);
          const cueEnd = cueStart + (durationMs / 1000);
          record.oscillator.type = oscillatorType;
          record.oscillator.frequency.setValueAtTime(frequency, cueStart);
          if (type === 'blocked' && record.oscillator.frequency.exponentialRampToValueAtTime) {
            record.oscillator.frequency.exponentialRampToValueAtTime(Math.max(120, frequency * 0.8), cueEnd);
          }
          record.gain.gain.setValueAtTime(0.0001, cueStart);
          record.gain.gain.linearRampToValueAtTime?.(peak, cueStart + 0.004);
          record.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.01), cueEnd);
          record.oscillator.connect(record.gain);
          record.gain.connect(context.destination);
          record.oscillator.onended = () => cleanNode(record, { stop: false });
          record.oscillator.start(cueStart);
          record.oscillator.stop(cueEnd);
        } catch (error) {
          cleanNode(record);
          throw error;
        }
      }
      if (playedAt != null) lastPlayedByType.set(type, playedAt);
      return true;
    } catch {
      stopActive();
      return false;
    }
  }

  return {
    enabled,
    setEnabled(value) {
      writePreference(storage, SOUNDS_KEY, Boolean(value));
      if (!value) stopActive();
    },
    play,
    destroy() {
      stopActive();
      if (context && context.state !== 'closed') {
        try {
          const closed = context.close?.();
          closed?.catch?.(() => {});
        } catch { /* Optional cleanup. */ }
      }
      context = null;
      lastPlayedByType.clear();
    },
  };
}

function touchInteraction(interaction, navigator, { allowDeferred = true } = {}) {
  const permitted = Boolean(interaction?.trusted && interaction?.touchOrigin && interaction?.modality === 'touch');
  if (!permitted) return false;
  if (allowDeferred && interaction?.deferred) return true;
  try { return navigator?.userActivation?.isActive !== false; }
  catch { return false; }
}

export function createHapticAdapter({
  navigator = globalThis.navigator,
  document = globalThis.document,
  storage = globalThis.localStorage,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  minInterval = 44,
} = {}) {
  const lastPulseByType = new Map();
  let activeUntil = -Infinity;
  const supported = () => typeof navigator?.vibrate === 'function';
  const enabled = () => readMigratedPreference(storage, HAPTICS_KEY, LEGACY_HAPTICS_KEY, true);

  function pulse(type, { interaction = null, fromUserGesture = false } = {}) {
    // fromUserGesture remains a low-level compatibility alias; production passes explicit modality.
    const origin = interaction || (fromUserGesture
      ? { trusted: true, modality: 'touch', touchOrigin: true }
      : null);
    const pattern = FEEDBACK_EVENTS[type]?.haptic;
    if (!pattern || !supported() || !enabled() || !visible(document)
        || !touchInteraction(origin, navigator)) return false;
    const pulseAt = safeNow(now);
    const lastPulseAt = lastPulseByType.get(type);
    if (pulseAt != null && lastPulseAt != null && pulseAt - lastPulseAt < minInterval) return false;
    try {
      const accepted = navigator.vibrate([...pattern]);
      if (accepted === false) return false;
      if (pulseAt != null) {
        lastPulseByType.set(type, pulseAt);
        activeUntil = pulseAt + pattern.reduce((total, duration) => total + duration, 0);
      }
      return true;
    } catch { return false; }
  }

  function cancel(interaction = null) {
    const cancelAt = safeNow(now);
    if (cancelAt == null || cancelAt >= activeUntil) return false;
    if (!supported() || !visible(document) || !touchInteraction(interaction, navigator)) return false;
    try {
      const accepted = navigator.vibrate(0);
      if (accepted === false) return false;
      activeUntil = -Infinity;
      return true;
    } catch { return false; }
  }

  return {
    supported,
    enabled,
    setEnabled(value, { interaction = null } = {}) {
      if (!value) cancel(interaction);
      writePreference(storage, HAPTICS_KEY, Boolean(value));
    },
    pulse,
    cancel,
    destroy({ interaction = null } = {}) {
      cancel(interaction);
      lastPulseByType.clear();
      activeUntil = -Infinity;
    },
  };
}

function semanticControl(target) {
  const control = target?.closest?.('[data-feedback]');
  if (!control || control.disabled || control.getAttribute?.('aria-disabled') === 'true') return null;
  return FEEDBACK_EVENTS[control.dataset.feedback] ? control : null;
}

function dispatchObserved(document, type, target, interaction) {
  try {
    const CustomEvent = document?.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (!document?.dispatchEvent || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent('cookbook:feedback', {
      detail: {
        type,
        targetId: target?.id || null,
        modality: interaction?.modality || 'programmatic',
        touchOrigin: Boolean(interaction?.touchOrigin),
      },
    }));
  } catch { /* Observers are optional and never own the primary action. */ }
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
  const recentInteractions = new WeakMap();
  const emittedByEvent = new WeakMap();
  let initialized = false;

  function release(control) {
    if (!control) return;
    try { control.classList?.remove('is-feedback-pressed'); } catch { /* Optional visual channel. */ }
    pressed.delete(control);
  }
  function releaseAll() {
    for (const control of [...pressed]) release(control);
  }

  function eventInteraction(event, target = event?.target) {
    const control = semanticControl(target) || target?.closest?.('[data-action], button, [role="button"]') || target;
    const remembered = control && recentInteractions.get(control);
    let modality = 'programmatic';
    let touchOrigin = false;
    if (event?.pointerType === 'touch') { modality = 'touch'; touchOrigin = true; }
    else if (event?.pointerType) modality = 'mouse';
    else if (event?.type?.startsWith?.('key') || event?.detail === 0) modality = 'keyboard';
    else if (event?.isTrusted) modality = remembered?.modality || 'mouse';
    const trusted = Boolean(event?.isTrusted);
    const inheritedTouch = Boolean(trusted && !event?.pointerType && event?.detail !== 0
      && !event?.type?.startsWith?.('key') && remembered?.touchOrigin);
    const interaction = {
      trusted,
      modality: touchOrigin || inheritedTouch ? 'touch' : modality,
      touchOrigin: touchOrigin || inheritedTouch,
      deferred: false,
    };
    if (control && trusted) recentInteractions.set(control, interaction);
    return interaction;
  }

  function contextFromEvent(event, target = event?.target) {
    return eventInteraction(event, target);
  }

  function handlePress(event) {
    const control = semanticControl(event.target);
    if (!control) return;
    const interaction = eventInteraction(event, control);
    if (interaction.trusted) recentInteractions.set(control, interaction);
    try { control.classList.add('is-feedback-pressed'); } catch { return; }
    pressed.add(control);
  }
  function handleRelease() { releaseAll(); }

  function emit(type, {
    target = null,
    sourceEvent = null,
    interaction = sourceEvent ? contextFromEvent(sourceEvent, target || sourceEvent.target) : null,
    fromUserGesture = Boolean(sourceEvent?.isTrusted),
  } = {}) {
    if (!FEEDBACK_EVENTS[type]) return false;
    if (sourceEvent && (typeof sourceEvent === 'object' || typeof sourceEvent === 'function')) {
      let emitted = emittedByEvent.get(sourceEvent);
      if (!emitted) {
        emitted = new Set();
        emittedByEvent.set(sourceEvent, emitted);
      }
      if (emitted.has(type)) return false;
      emitted.add(type);
    }
    const context = interaction || (fromUserGesture
      ? { trusted: true, modality: 'mouse', touchOrigin: false, deferred: false }
      : { trusted: false, modality: 'programmatic', touchOrigin: false, deferred: true });
    try { sounds.play(type, { fromUserGesture: Boolean(context.trusted), interaction: context }); } catch { /* Isolated channel. */ }
    try { haptics.pulse(type, { interaction: context }); } catch { /* Isolated channel. */ }
    if (target?.classList) {
      try {
        const className = `has-feedback-${type}`;
        if (outcomeTimers.has(target)) {
          try { cancelSchedule(outcomeTimers.get(target)); } catch { /* Optional scheduler. */ }
        }
        for (const eventType of Object.keys(FEEDBACK_EVENTS)) target.classList.remove(`has-feedback-${eventType}`);
        target.classList.add(className);
        try {
          outcomeTimers.set(target, schedule(() => {
            try { target.classList.remove(className); } catch { /* Detached target. */ }
            outcomeTimers.delete(target);
          }, 140));
        } catch { /* Visual class remains harmless until destroy/re-render. */ }
      } catch { /* Optional visual channel. */ }
    }
    dispatchObserved(document, type, target, context);
    return true;
  }

  function handleClick(event) {
    const control = semanticControl(event.target);
    if (!control) return;
    const interaction = contextFromEvent(event, control);
    emit(control.dataset.feedback, { target: control, sourceEvent: event, interaction });
  }
  function handleKeyDown(event) {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) handlePress(event);
  }
  function handleKeyUp(event) {
    if (event.key === ' ' || event.key === 'Enter') handleRelease(event);
  }

  const listeners = [
    ['pointerdown', handlePress, true], ['pointerup', handleRelease, true], ['pointercancel', handleRelease, true],
    ['click', handleClick, true], ['keydown', handleKeyDown, true], ['keyup', handleKeyUp, true],
    ['visibilitychange', releaseAll, true],
  ];

  return {
    sounds,
    haptics,
    emit,
    contextFromEvent,
    init() {
      if (!initialized && document?.addEventListener) {
        for (const [type, listener, capture] of listeners) document.addEventListener(type, listener, capture);
        initialized = true;
      }
      return this;
    },
    destroy() {
      if (initialized) {
        for (const [type, listener, capture] of listeners) {
          try { document?.removeEventListener?.(type, listener, capture); } catch { /* Detached document. */ }
        }
      }
      initialized = false;
      releaseAll();
      for (const [target, timer] of outcomeTimers) {
        try { cancelSchedule(timer); } catch { /* Optional scheduler. */ }
        for (const type of Object.keys(FEEDBACK_EVENTS)) {
          try { target.classList?.remove(`has-feedback-${type}`); } catch { /* Detached target. */ }
        }
      }
      outcomeTimers.clear();
      try { sounds.destroy(); } catch { /* Isolated cleanup. */ }
      try { haptics.destroy(); } catch { /* Isolated cleanup. */ }
    },
  };
}

export const interactionFeedback = createInteractionFeedback();
