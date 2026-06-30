// ════════════════════════════════════════════════════════
// controllers/settings.js — settings panel: auth zone + import/export
// ════════════════════════════════════════════════════════

import { loadAuth, clearAuth, initGoogleSignIn } from '../lib/auth.js';
import { toast } from '../lib/dom.js';
import { esc } from '../lib/format.js';

/**
 * Settings panel controller. Renders the auth zone (sign-in button when
 * signed out, email + sign-out when signed in), wires the import/export
 * buttons, and handles delegated sign-out clicks in the auth zone.
 *
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {() => {token: ?string, email: ?string}} [deps.loadAuth]
 * @param {() => Promise<void>} [deps.clearAuth]
 * @param {(opts: object) => void} [deps.initGoogleSignIn]
 * @param {(msg: string) => void} [deps.toast]
 * @param {() => void} [deps.exportRecipes]
 * @returns {{ renderAuth: () => void, renderSettings: () => void, handleAuthClick: (e: Event) => Promise<void> }}
 */
export function initSettings({
  document = globalThis.document,
  loadAuth: loadAuthDep = loadAuth,
  clearAuth: clearAuthDep = clearAuth,
  initGoogleSignIn: initGoogleSignInDep = initGoogleSignIn,
  toast: toastDep = toast,
  exportRecipes = null,
} = {}) {
  let settingsRendered = false;

  function renderAuth() {
    const zone = document.getElementById('settings-auth-zone');
    if (!zone) return;
    const { token, email } = loadAuthDep();
    if (token) {
      zone.innerHTML =
        `<div class="auth-signed-in">
           <span class="auth-email">Signed in as ${esc(email)}</span>
           <button class="auth-signout" data-action="signout">Sign out</button>
         </div>`;
    } else {
      zone.innerHTML = `<div id="g-signin-btn"></div>`;
      initGoogleSignInDep({
        buttonEl: document.getElementById('g-signin-btn'),
        clientId: typeof window !== 'undefined' ? window.COOKBOOK_GOOGLE_CLIENT_ID : undefined,
        onSignedIn: () => { renderAuth(); },
        onError: (msg) => toastDep(`Sign-in failed: ${msg}`),
      });
    }
  }

  async function handleAuthClick(e) {
    if (!e?.target?.closest?.('[data-action="signout"]')) return;
    await clearAuthDep();
    renderAuth();
    toastDep('Signed out');
  }

  function renderSettings() {
    if (settingsRendered) return;
    const importBtn = document.getElementById('settings-import-btn');
    if (importBtn) importBtn.addEventListener('click', () => document.getElementById('import-file')?.click());
    const exportBtn = document.getElementById('settings-export-btn');
    if (exportBtn && exportRecipes) exportBtn.addEventListener('click', exportRecipes);
    settingsRendered = true;
  }

  return { renderAuth, renderSettings, handleAuthClick };
}
