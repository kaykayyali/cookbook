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
/** Show a transient toast message, optionally with one accessible action. */
export function toast(msg, { actionLabel = '', onAction = null, duration = 4200 } = {}) {
  const t = $('toast');
  if (!t) return;
  clearTimeout(toastTimer);
  if (actionLabel && typeof onAction === 'function' && t.ownerDocument?.createElement && t.replaceChildren) {
    const copy = t.ownerDocument.createElement('span');
    copy.textContent = msg;
    const action = t.ownerDocument.createElement('button');
    action.type = 'button';
    action.dataset.toastAction = '';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      clearTimeout(toastTimer);
      t.classList.remove('show');
      void onAction();
    }, { once: true });
    t.replaceChildren(copy, action);
  } else {
    t.textContent = msg;
  }
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
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
