import { LEGACY_SOUNDS_KEY, createSoundAdapter } from './interaction-feedback.js';

export const CLICK_SOUND_KEY = LEGACY_SOUNDS_KEY;

export function createClickSound({
  document = globalThis.document,
  storage = globalThis.localStorage,
  play = null,
} = {}) {
  const adapter = play ? null : createSoundAdapter({ storage, document });
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
    if (play) play();
    else adapter.play('select', { fromUserGesture: Boolean(event.isTrusted) });
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
      adapter?.destroy();
    },
  };
}

export const clickSound = createClickSound();
