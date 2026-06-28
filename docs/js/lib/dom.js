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
