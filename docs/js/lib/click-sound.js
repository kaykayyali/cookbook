export const CLICK_SOUND_KEY = 'cb_interface_sounds_v1';

function defaultPlay() {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) return () => {};
  let context;
  return () => {
    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') void context.resume();
      const start = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(720, start);
      oscillator.frequency.exponentialRampToValueAtTime(420, start + 0.025);
      gain.gain.setValueAtTime(0.025, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.03);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.03);
    } catch {
      // Sound is optional; browsers without usable audio stay silent.
    }
  };
}

export function createClickSound({
  document = globalThis.document,
  storage = globalThis.localStorage,
  play = defaultPlay(),
} = {}) {
  let initialized = false;
  const enabled = () => {
    try { return storage?.getItem?.(CLICK_SOUND_KEY) !== 'off'; }
    catch { return true; }
  };
  const setEnabled = (value) => {
    try { storage?.setItem?.(CLICK_SOUND_KEY, value ? 'on' : 'off'); }
    catch { /* Device-local preference is best effort. */ }
  };
  const handleClick = (event) => {
    const button = event.target?.closest?.('button, [role="button"]');
    if (!button || button.disabled || button.getAttribute?.('aria-disabled') === 'true' || !enabled()) return;
    play();
  };
  return {
    enabled,
    setEnabled,
    init() {
      if (!initialized && document?.addEventListener) {
        document.addEventListener('click', handleClick);
        initialized = true;
      }
      return this;
    },
    destroy() {
      if (initialized) document?.removeEventListener?.('click', handleClick);
      initialized = false;
    },
  };
}

export const clickSound = createClickSound();
