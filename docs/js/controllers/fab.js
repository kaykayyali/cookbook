// ════════════════════════════════════════════════════════
// controllers/fab.js — FAB toggle + dropdown action dispatch
// ════════════════════════════════════════════════════════

import { getToken } from '../lib/auth.js';
import { toast } from '../lib/dom.js';

/**
 * FAB controller. Toggles a 2-item dropdown ("Enter Manually" or
 * "Extract from URL"). Manual closes the dropdown and calls openDrawer(null).
 * URL: if signed in, calls extract.open(); if signed out, opens the
 * settings panel so the GIS button is mounted, then clicks it.
 *
 * @param {object} deps
 * @param {object} [deps.state] - { pendingOpenUrlModal }
 * @param {Document} [deps.document]
 * @param {(id: string|null) => void} [deps.openDrawer] - drawer.open
 * @param {{ open: () => void }} [deps.extract] - extract controller
 * @param {() => string|null} [deps.getToken]
 * @param {(id: string) => void} [deps.showPanel] - panels controller
 * @param {string} [deps.gSigninBtnId='g-signin-btn'] - id of the GIS host
 * @returns {{ toggle: (e?: Event) => void, open: () => void, close: () => void, handleAction: (action: string, e?: Event) => void }}
 */
export function initFab({
  state = {},
  document = globalThis.document,
  openDrawer = null,
  extract = null,
  getToken: getTokenDep = getToken,
  showPanel = null,
  toast: toastDep = toast,
  gSigninBtnId = 'g-signin-btn',
} = {}) {
  function isOpen() {
    const dd = document.getElementById('fab-dropdown');
    return dd ? !dd.hasAttribute('hidden') : false;
  }

  function open() {
    const dd = document.getElementById('fab-dropdown');
    const btn = document.getElementById('fab-new');
    if (!dd || !btn) return;
    dd.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', closeOutside, { capture: true });
  }

  function close() {
    const dd = document.getElementById('fab-dropdown');
    const btn = document.getElementById('fab-new');
    if (!dd || !btn) return;
    dd.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', closeOutside, { capture: true });
  }

  function closeOutside(e) {
    const stack = document.getElementById('fab-stack');
    if (stack && stack.contains(e.target)) return;
    close();
  }

  function toggle(e) {
    e?.stopPropagation?.();
    if (isOpen()) close();
    else open();
  }

  function handleAction(action, e) {
    e?.stopPropagation?.();
    if (action === 'manual') {
      close();
      if (openDrawer) openDrawer(null);
      return;
    }
    if (action !== 'url') return;
    close();
    if (getTokenDep()) {
      if (extract) extract.open();
      return;
    }
    // Signed out: render auth into Settings so the GIS button exists, then
    // click it. Open Settings panel + auto-open URL modal on success.
    if (showPanel) showPanel('settings');
    state.pendingOpenUrlModal = true;
    setTimeout(() => {
      const host = document.getElementById(gSigninBtnId);
      const clickable = host?.querySelector?.('[role="button"], button') || host?.firstElementChild;
      if (clickable) clickable.click();
      else { toastDep('Sign-in not ready — open Settings to sign in'); state.pendingOpenUrlModal = false; }
    }, 50);
  }

  function wireFab() {
    const btn = document.getElementById('fab-new');
    if (btn) btn.addEventListener('click', toggle);
    const dd = document.getElementById('fab-dropdown');
    if (dd) {
      dd.addEventListener('click', (e) => {
        const item = e.target.closest('[data-fab-action]');
        if (item) handleAction(item.dataset.fabAction, e);
      });
    }
  }

  wireFab();
  return { toggle, open, close, handleAction };
}
