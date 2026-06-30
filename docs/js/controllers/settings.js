// ════════════════════════════════════════════════════════
// controllers/settings.js — settings panel: auth zone + import/export
// ════════════════════════════════════════════════════════

import { loadAuth, clearAuth, initGoogleSignIn } from '../lib/auth.js';
import { toast } from '../lib/dom.js';
import { esc, pluralize } from '../lib/format.js';
import { toSchema, parseImport } from '../lib/schema.js';
import { save as persist } from '../lib/store.js';

/**
 * Settings panel controller.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {() => {token, email}} [deps.loadAuth]
 * @param {() => Promise<void>} [deps.clearAuth]
 * @param {(opts) => void} [deps.initGoogleSignIn]
 * @param {(msg) => void} [deps.toast]
 * @param {() => void} [deps.exportRecipes]
 * @param {() => void} [deps.onChange] - re-render after import
 * @param {(email: string) => void} [deps.onSignedIn] - fired after a successful sign-in (state.auth refresh, feed load)
 * @param {() => void} [deps.onSignedOut] - fired after a sign-out (state.auth reset)
 * @returns {{ renderAuth, renderSettings, handleAuthClick }}
 */
export function initSettings({
  state,
  document = globalThis.document,
  loadAuth: loadAuthDep = loadAuth,
  clearAuth: clearAuthDep = clearAuth,
  initGoogleSignIn: initGoogleSignInDep = initGoogleSignIn,
  toast: toastDep = toast,
  exportRecipes: exportRecipesDep = defaultExportRecipes,
  onChange = null,
  onSignedIn = null,
  onSignedOut = null,
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
        onSignedIn: (email) => { renderAuth(); if (onSignedIn) onSignedIn(email); },
        onError: (msg) => toastDep(`Sign-in failed: ${msg}`),
      });
    }
  }

  async function handleAuthClick(e) {
    if (!e?.target?.closest?.('[data-action="signout"]')) return;
    await clearAuthDep();
    renderAuth();
    if (onSignedOut) onSignedOut();
    toastDep('Signed out');
  }

  function importRecipes(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = parseImport(JSON.parse(e.target.result));
        if (!imported.length) { toastDep('No valid recipes found in file'); return; }
        state.recipes = [...imported, ...state.recipes];
        persist();
        if (onChange) onChange();
        toastDep(`Imported ${pluralize(imported.length, 'recipe')}`);
      } catch { toastDep('Could not read file — expected JSON-LD'); }
    };
    reader.readAsText(file);
  }

  function renderSettings() {
    if (settingsRendered) return;
    const importBtn = document.getElementById('settings-import-btn');
    if (importBtn) importBtn.addEventListener('click', () => document.getElementById('import-file')?.click());
    const exportBtn = document.getElementById('settings-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportRecipesDep);
    const fileInput = document.getElementById('import-file');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) importRecipes(e.target.files[0]);
        e.target.value = '';
      });
    }
    const authZone = document.getElementById('settings-auth-zone');
    if (authZone) authZone.addEventListener('click', handleAuthClick);
    settingsRendered = true;
  }

  return { renderAuth, renderSettings, handleAuthClick, _importRecipes: importRecipes };
}

function defaultExportRecipes() {
  // Lazy reference — settings is initialised with the bound fn via dep, so
  // this only fires if exportRecipes is never overridden (tests).
  throw new Error('settings: exportRecipes dep not provided');
}
