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
let activeToast = null;

/** Revoke the current toast action and remove it from focus/navigation. */
export function dismissToast() {
  clearTimeout(toastTimer);
  toastTimer = undefined;
  if (!activeToast) return false;
  const { container, action, listener } = activeToast;
  if (action) {
    action.removeEventListener('click', listener);
    action.disabled = true;
    action.remove();
  }
  container.classList.remove('show');
  activeToast = null;
  return true;
}

/** Show a transient toast message, optionally with one accessible action. */
export function toast(msg, { actionLabel = '', onAction = null, duration = 4200 } = {}) {
  const t = $('toast');
  if (!t) return () => false;
  dismissToast();
  let action = null;
  let listener = null;
  if (actionLabel && typeof onAction === 'function' && t.ownerDocument?.createElement && t.replaceChildren) {
    const copy = t.ownerDocument.createElement('span');
    copy.textContent = msg;
    action = t.ownerDocument.createElement('button');
    action.type = 'button';
    action.dataset.toastAction = '';
    action.textContent = actionLabel;
    listener = (event) => {
      if (activeToast?.action !== action) return;
      dismissToast();
      void onAction(event);
    };
    action.addEventListener('click', listener);
    t.replaceChildren(copy, action);
  } else {
    t.textContent = msg;
  }
  const token = { container: t, action, listener };
  activeToast = token;
  t.classList.add('show');
  toastTimer = setTimeout(() => {
    if (activeToast === token) dismissToast();
  }, duration);
  return () => activeToast === token && dismissToast();
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
