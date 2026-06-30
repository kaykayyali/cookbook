// ════════════════════════════════════════════════════════
// ui.js — interactive primitive factories.
// Returns HTML strings (or DOM nodes from Toast) with correct ARIA and
// spec-required behaviors. Pure functions, no global state.
// Spec §6 (interactive primitives), §10 (a11y non-negotiables).
// ════════════════════════════════════════════════════════

import { ICON } from './icons.js';

/**
 * @param {object} opts
 * @param {string} opts.label                       Visible label.
 * @param {'primary'|'secondary'|'ghost'} [opts.variant='primary']
 * @param {'sm'|'md'|'lg'} [opts.size='md']
 * @param {'button'|'submit'|'reset'} [opts.type='button']
 * @param {boolean} [opts.disabled]
 * @param {string} [opts.icon]                      An icon name from ICON.
 * @param {string} [opts.id]
 * @param {Record<string,string>} [opts.data]       data-* attrs (data-id, data-action, etc.)
 */
export function Button({ label, variant = 'primary', size = 'md', type = 'button', disabled, icon, id, data = {} }) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' ? `btn-${size}` : ''].filter(Boolean).join(' ');
  const dataAttrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(String(v))}"`).join('');
  const disAttr = disabled ? ' disabled aria-disabled="true"' : '';
  const idAttr = id ? ` id="${esc(id)}"` : '';
  const iconHTML = icon ? ICON[icon] || '' : '';
  return `<button${idAttr} type="${type}" class="${cls}"${disAttr}${dataAttrs}>${iconHTML}${esc(label)}</button>`;
}

/**
 * @param {object} opts
 * @param {string} opts.label                       REQUIRED — used as aria-label.
 * @param {string} opts.icon                        Icon name from ICON. REQUIRED.
 * @param {boolean} [opts.danger]
 * @param {'sm'|'md'} [opts.size='md']
 * @param {Record<string,string>} [opts.data]       data-* attrs (data-id, data-action, etc.)
 */
export function IconButton({ label, icon, danger, size = 'md', data = {} }) {
  if (typeof label !== 'string' || !label) {
    throw new Error('IconButton requires a non-empty aria-label (spec §10 #2)');
  }
  if (!icon || !ICON[icon]) {
    throw new Error(`IconButton requires a valid icon name; got ${JSON.stringify(icon)}`);
  }
  const cls = ['icon-btn', danger ? 'danger' : '', size === 'sm' ? 'icon-btn-sm' : ''].filter(Boolean).join(' ');
  const dataAttrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(String(v))}"`).join('');
  return `<button type="button" class="${cls}" aria-label="${esc(label)}" title="${esc(label)}"${dataAttrs}>${ICON[icon]}</button>`;
}

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.label
 * @param {string} [opts.type='text']               'text' | 'textarea' | 'number' | 'url' | ...
 * @param {string} [opts.value]
 * @param {string} [opts.placeholder]
 * @param {boolean} [opts.required]
 * @param {boolean} [opts.invalid]
 * @param {string} [opts.hint]                      Error/help text.
 */
export function Input({ id, label, type = 'text', value, placeholder, required, invalid, hint }) {
  const safeLabel = esc(label);
  const requiredAttr = required ? ' required' : '';
  const invalidAttr = invalid ? ' aria-invalid="true"' : '';
  const valueAttr = value != null ? ` value="${esc(value)}"` : '';
  const placeholderAttr = placeholder ? ` placeholder="${esc(placeholder)}"` : '';
  const help = invalid && hint
    ? `<p class="form-error" role="alert">${esc(hint)}</p>`
    : '';
  if (type === 'textarea') {
    return `<label class="label" for="${esc(id)}">${safeLabel}</label><textarea id="${esc(id)}" class="input"${requiredAttr}${invalidAttr}${placeholderAttr}>${esc(value ?? '')}</textarea>${help}`;
  }
  return `<label class="label" for="${esc(id)}">${safeLabel}</label><input id="${esc(id)}" type="${esc(type)}" class="input"${requiredAttr}${invalidAttr}${valueAttr}${placeholderAttr}>${help}`;
}

/**
 * @param {object} opts
 * @param {string} opts.name                        An icon name from ICON.
 */
export function Icon({ name }) {
  const raw = ICON[name];
  if (!raw) throw new Error(`Icon: unknown name ${JSON.stringify(name)}`);
  // Re-wrap the imported ICON SVG so it gets class="icon" and inherits font size.
  // ICON strings are raw <svg>…</svg>. We mutate them with a simple suffix:
  // inject class="icon" right after `<svg`.
  return raw.replace(/^<svg/, '<svg class="icon"');
}

/**
 * Build a transient toast. Toasts are auto-dismissed after `durSlow`
 * (320ms default per spec §5.7). The Toast primitive's CSS is in
 * components.css (`.toast`, `.toast.show`, `.toast-error`).
 *
 * @param {string} msg
 * @param {{ kind?: 'success' | 'error' }} [opts]
 */
export function Toast(msg, { kind = 'success' } = {}) {
  // Use a single existing <div id="toast"> if present (matches current dom.js);
  // otherwise inject one. Pure returns a small DOM-mounting function —
  // called once at runtime, not by tests.
  return function mountToast(target = document.body) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      target.appendChild(el);
    }
    el.className = `toast${kind === 'error' ? ' toast-error' : ''}`;
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 320);
  };
}

// Helper: HTML-attribute escaping. Same algorithm as format.js:esc so the
// factory output stays consistent with the rest of the codebase.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
