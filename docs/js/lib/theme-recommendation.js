import { theme as defaultTheme } from './theme.js';

const RECOMMENDATION_KEY = 'cb_summer_theme_recommendation_v1';

/**
 * One-time, device-local Summer theme recommendation. The storage key is
 * subject-scoped so each household member can make their own visual choice.
 */
export function createThemeRecommendation({
  subject = 'household',
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  document = globalThis.document,
  theme = defaultTheme,
} = {}) {
  const key = `${RECOMMENDATION_KEY}:${subject || 'household'}`;
  let shownThisSession = false;
  let wired = false;

  function banner() {
    return document?.getElementById?.('summer-theme-recommendation') || null;
  }

  function hide() {
    const el = banner();
    if (el) el.hidden = true;
  }

  function wire() {
    const el = banner();
    if (!el || wired) return;
    el.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-action="try-summer-theme"]')) {
        theme.set('summer');
        theme.apply('summer');
        hide();
        return;
      }
      if (event.target?.closest?.('[data-action="dismiss-summer-theme"]')) hide();
    });
    wired = true;
  }

  function maybeShow() {
    const el = banner();
    if (!el || shownThisSession) return false;
    if (theme.getStored?.() === 'summer') {
      try { storage?.setItem(key, '1'); } catch { /* private mode */ }
      return false;
    }
    try {
      if (storage?.getItem(key)) return false;
      storage?.setItem(key, '1');
    } catch { /* private mode: runtime guard still prevents repeats */ }
    shownThisSession = true;
    wire();
    el.hidden = false;
    return true;
  }

  return { maybeShow, hide };
}
