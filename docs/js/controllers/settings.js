// ════════════════════════════════════════════════════════
// controllers/settings.js — settings panel: auth zone + import/export
// ════════════════════════════════════════════════════════

import { loadAuth, clearAuth, initGoogleSignIn } from '../lib/auth.js';
import { toast } from '../lib/dom.js';
import { esc, pluralize } from '../lib/format.js';
import { toSchema, parseImport } from '../lib/schema.js';
import { save as persist } from '../lib/store.js';
import { theme as defaultTheme } from '../lib/theme.js';
import { importRecipes as importToServer, fetchRecipes } from '../lib/api.js';
import { publishRecipeAuthority } from '../lib/recipe-authority.js';
import { interactionFeedback as defaultFeedback } from '../lib/interaction-feedback.js';

const THEME_PALETTES = {
  light:  { bg: '#fbf7f1', accent: '#b34a1c', border: '#d2c4ac' },
  dark:   { bg: '#1a140e', accent: '#e07a4a', border: '#4a3a28' },
  sepia:  { bg: '#f4ead5', accent: '#9c5a1c', border: '#b8a478' },
  forest: { bg: '#1d2a23', accent: '#7fb069', border: '#4a5e4f' },
  ocean:  { bg: '#0e2333', accent: '#5dbcd2', border: '#2c5070' },
  summer: { bg: '#fff8df', accent: '#c8483b', border: '#9ccdb5' },
};
const THEME_NAMES = Object.keys(THEME_PALETTES);
const DEFAULT_THEME = 'light';

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
 * @param {object|null} [deps.recipeRuntime] - versioned recipe authority owner
 * @param {() => void} [deps.onChange] - re-render after import
 * @param {() => string|null} [deps.getStoredTheme] - read current theme
 * @param {object} [deps.theme] - { getStored, set, apply } — defaults to singleton
 * @param {(email: string) => void} [deps.onSignedIn] - fired after a successful sign-in (state.auth refresh, feed load)
 * @param {() => void} [deps.onSignedOut] - fired after a sign-out (state.auth reset)
 * @returns {{ renderAuth, renderSettings, renderThemePicker, handleAuthClick, handleThemeClick }}
 */
export function initSettings({
  state,
  document = globalThis.document,
  loadAuth: loadAuthDep = loadAuth,
  clearAuth: clearAuthDep = clearAuth,
  initGoogleSignIn: initGoogleSignInDep = initGoogleSignIn,
  toast: toastDep = toast,
  exportRecipes: exportRecipesDep = defaultExportRecipes,
  importToServer: importToServerDep = importToServer,
  fetchRecipes: fetchRecipesDep = fetchRecipes,
  recipeRuntime = null,
  onChange = null,
  getStoredTheme = defaultTheme.getStored,
  theme: themeDep = defaultTheme,
  feedback = defaultFeedback,
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
  }

  async function importRecipes(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      let imported;
      try {
        imported = parseImport(JSON.parse(e.target.result));
      } catch {
        toastDep('Could not read file — expected JSON-LD');
        return;
      }
      if (!imported.length) { toastDep('No valid recipes found in file'); return; }

      let res;
      try { res = await importToServerDep(imported.map(toSchema)); }
      catch { toastDep('Could not import recipes'); return; }
      if (!res?.ok) { toastDep('Could not import recipes'); return; }

      // Capture the runtime generation before starting the GET. A mutation can
      // be acknowledged while it is in flight, making that response stale even
      // though no pending row remains to reapply over it.
      const mutationVersion = recipeRuntime?.version?.();
      let fres;
      try { fres = await fetchRecipesDep(); }
      catch { toastDep('Recipes imported, but could not refresh'); return; }
      if (!fres?.ok || !Array.isArray(fres.recipes)) {
        toastDep('Recipes imported, but could not refresh');
        return;
      }

      if (recipeRuntime) {
        const accepted = await recipeRuntime.setAuthority(
          fres.recipes,
          { mutationVersion },
        ).catch(() => false);
        if (!accepted) {
          // fetchRecipes does not publish today, but restoring from the runtime
          // keeps this handoff safe if a fetch helper ever touches shared state.
          publishRecipeAuthority(state, recipeRuntime.current());
          const refreshed = await recipeRuntime.refresh?.().catch(() => false);
          if (!refreshed) {
            if (onChange) onChange();
            toastDep('Recipes imported, but could not refresh');
            return;
          }
        }
      } else publishRecipeAuthority(state, fres.recipes);

      if (onChange) onChange();
      toastDep(`Imported ${pluralize(res.imported ?? imported.length, 'recipe')}`);
    };
    reader.onerror = () => toastDep('Could not read file');
    try { reader.readAsText(file); }
    catch { toastDep('Could not read file'); }
  }

  function renderThemePicker() {
    const zone = document.getElementById('settings-theme-zone');
    if (!zone) return;
    const current = getStoredTheme() || DEFAULT_THEME;
    const swatches = THEME_NAMES.map((name) => {
      const p = THEME_PALETTES[name];
      const active = name === current;
      const cls = `theme-swatch${active ? ' is-active' : ''}`;
      return `<button type="button" data-theme="${name}" data-feedback="select" class="${cls}" role="radio" `
        + `aria-checked="${active}" aria-label="${name.charAt(0).toUpperCase() + name.slice(1)}" `
        + `style="--swatch-bg:${p.bg};--swatch-accent:${p.accent};--swatch-border:${p.border}"></button>`;
    }).join('');
    zone.innerHTML =
      `<div class="theme-picker" role="radiogroup" aria-label="Theme">${swatches}</div>`
      + `<p class="theme-picker-hint">First load follows your system's light/dark setting. Pick a theme to override.</p>`;
    zone.addEventListener('click', handleThemeClick);
    zone.addEventListener('keydown', handleThemeKey);
  }

  function handleThemeClick(e) {
    const btn = e?.target?.closest?.('.theme-swatch');
    if (!btn) return;
    const name = btn.dataset.theme;
    if (!THEME_PALETTES[name]) return;
    themeDep.set(name);
    themeDep.apply(name);
    // Update aria-checked and is-active on all swatches within the same radiogroup.
    const group = btn.closest?.('[role="radiogroup"]');
    if (!group) return;
    for (const el of group.querySelectorAll('.theme-swatch')) {
      const isActive = el.dataset.theme === name;
      el.classList.toggle('is-active', isActive);
      el.setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  }

  function handleThemeKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
    const group = e.target?.closest?.('[role="radiogroup"]');
    if (!group) return;
    const swatches = [...group.querySelectorAll('.theme-swatch')];
    const idx = swatches.indexOf(e.target.closest('.theme-swatch'));
    if (idx < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      swatches[(idx + 1) % swatches.length].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      swatches[(idx - 1 + swatches.length) % swatches.length].focus();
    } else {
      swatches[idx].click();
    }
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
    const soundToggle = document.getElementById('feedback-sounds-toggle');
    if (soundToggle) {
      soundToggle.checked = feedback.sounds.enabled();
      soundToggle.addEventListener('change', (event) => {
        if (!soundToggle.checked) feedback.emit('toggle-off', { target: soundToggle, sourceEvent: event });
        feedback.sounds.setEnabled(soundToggle.checked);
        if (soundToggle.checked) feedback.emit('toggle-on', { target: soundToggle, sourceEvent: event });
      });
    }
    const hapticSetting = document.getElementById('feedback-haptics-setting');
    const hapticToggle = document.getElementById('feedback-haptics-toggle');
    const hapticsSupported = feedback.haptics.supported();
    if (hapticSetting) hapticSetting.hidden = !hapticsSupported;
    if (hapticToggle) {
      hapticToggle.disabled = !hapticsSupported;
      hapticToggle.checked = hapticsSupported && feedback.haptics.enabled();
      hapticToggle.addEventListener('change', (event) => {
        const interaction = feedback.contextFromEvent?.(event, hapticToggle) || null;
        if (!hapticToggle.checked) feedback.emit('toggle-off', { target: hapticToggle, sourceEvent: event, interaction });
        feedback.haptics.setEnabled(hapticToggle.checked, { interaction });
        if (hapticToggle.checked) feedback.emit('toggle-on', { target: hapticToggle, sourceEvent: event, interaction });
      });
    }
    renderThemePicker();
    settingsRendered = true;
  }

  return { renderAuth, renderSettings, renderThemePicker, handleAuthClick, handleThemeClick, _importRecipes: importRecipes };
}

function defaultExportRecipes() {
  // Lazy reference — settings is initialised with the bound fn via dep, so
  // this only fires if exportRecipes is never overridden (tests).
  throw new Error('settings: exportRecipes dep not provided');
}
