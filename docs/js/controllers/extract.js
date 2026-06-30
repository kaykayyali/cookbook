// ════════════════════════════════════════════════════════
// controllers/extract.js — URL extraction modal + API call
// ════════════════════════════════════════════════════════

import { authFetch, getToken } from '../lib/auth.js';
import { parseImport } from '../lib/schema.js';
import { toast } from '../lib/dom.js';

/**
 * Extract-from-URL controller. Owns the URL modal, fetches /api/extract,
 * and on success closes the modal + opens the drawer prefilled.
 *
 * @param {object} deps
 * @param {object} deps.state - { pendingOpenAfterSave }
 * @param {Document} [deps.document]
 * @param {(recipe: object) => void} [deps.openPrefilled] - drawer prefill
 * @returns {{ open: () => void, close: () => void, submit: () => Promise<void> }}
 */
export function initExtract({
  state,
  document = globalThis.document,
  openPrefilled = null,
  getToken: getTokenDep = getToken,
  authFetch: authFetchDep = authFetch,
  parseImport: parseImportDep = parseImport,
  toast: toastDep = toast,
} = {}) {
  function open() {
    const signedOut = !getTokenDep();
    const signedOutEl = document.getElementById('url-signedout');
    const signedInEl = document.getElementById('url-signedin');
    if (signedOutEl) signedOutEl.style.display = signedOut ? '' : 'none';
    if (signedInEl) signedInEl.style.display = signedOut ? 'none' : '';
    const input = document.getElementById('url-input');
    if (input) input.value = '';
    const status = document.getElementById('url-status');
    if (status) status.textContent = '';
    const overlay = document.getElementById('url-overlay');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    const overlay = document.getElementById('url-overlay');
    if (overlay) overlay.classList.remove('open');
    if (!isAnyOpen(document)) document.body.style.overflow = '';
  }

  async function submit() {
    const input = document.getElementById('url-input');
    const status = document.getElementById('url-status');
    const btn = document.getElementById('url-extract-btn');
    const url = (input?.value || '').trim();
    if (!url) return;
    if (status) status.textContent = 'Extracting…';
    if (btn) btn.disabled = true;
    try {
      const res = await authFetchDep('/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (status) status.textContent = data.error || 'failed';
        if (data.partial) {
          const [recipe] = parseImportDep([data.partial]);
          if (recipe) {
            state.pendingOpenAfterSave = true;
            close();
            if (openPrefilled) openPrefilled(recipe);
          }
        }
        return;
      }
      const [recipe] = parseImportDep([data.recipe]);
      if (!recipe) { if (status) status.textContent = 'no recipe found'; return; }
      state.pendingOpenAfterSave = true;
      close();
      if (openPrefilled) openPrefilled(recipe);
      toastDep('Recipe extracted — review and save');
    } catch (e) {
      if (status) status.textContent = e?.message || 'network';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireExtract() {
    const closeBtn = document.getElementById('url-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const overlay = document.getElementById('url-overlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target.id === 'url-overlay') close(); });
    const extractBtn = document.getElementById('url-extract-btn');
    if (extractBtn) extractBtn.addEventListener('click', () => submit());
    const input = document.getElementById('url-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }
    const hintBtn = document.getElementById('url-signin-hint-btn');
    if (hintBtn) {
      hintBtn.addEventListener('click', () => {
        close();
        const host = document.getElementById('g-signin-btn');
        const clickable = host?.querySelector?.('[role="button"], button') || host?.firstElementChild;
        if (clickable) clickable.click();
      });
    }
  }

  wireExtract();
  return { open, close, submit };
}

function isAnyOpen(document) {
  return !!document.getElementById('detail-modal')?.classList.contains('open')
    || !!document.getElementById('recipe-drawer')?.classList.contains('open');
}
