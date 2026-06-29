// ════════════════════════════════════════════════════════
// dom.js — minimal DOM helpers
// ════════════════════════════════════════════════════════

/** getElementById shorthand. */
export const $ = (id) => document.getElementById(id);

/** querySelector shorthand. */
export const el = (sel, root = document) => root.querySelector(sel);

/** querySelectorAll → real array. */
export const els = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
/** Show a transient toast message. */
export function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/** Announce `msg` to screen readers via a singleton live region. */
export function ariaLive(msg, { level = 'polite' } = {}) {
  let region = document.getElementById('aria-live');
  if (!region) {
    region = document.createElement('div');
    region.id = 'aria-live';
    region.className = 'aria-live';
    region.setAttribute('aria-live', level);
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
  } else if (level) {
    region.setAttribute('aria-live', level);
  }
  // Clearing first guarantees identical strings re-announce.
  region.textContent = '';
  region.textContent = msg;
}
