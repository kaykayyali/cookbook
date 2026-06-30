// ════════════════════════════════════════════════════════
// controllers/settings.js — settings panel: auth zone + import/export
// ════════════════════════════════════════════════════════

import { loadAuth, clearAuth, initGoogleSignIn } from '../lib/auth.js';
import { toast } from '../lib/dom.js';
import { esc, pluralize } from '../lib/format.js';
import { toSchema, parseImport } from '../lib/schema.js';
import { save as persist } from '../lib/store.js';
import { theme as defaultTheme } from '../lib/theme.js';

const THEME_PALETTES = {
  light:  { bg: '#fbf7f1', accent: '#b34a1c', border: '#d2c4ac' },
  dark:   { bg: '#1a140e', accent: '#e07a4a', border: '#4a3a28' },
  sepia:  { bg: '#f4ead5', accent: '#9c5a1c', border: '#b8a478' },
  forest: { bg: '#1d2a23', accent: '#7fb069', border: '#4a5e4f' },
  ocean:  { bg: '#0e2333', accent: '#5dbcd2', border: '#2c5070' },
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
 * @param {() => void} [deps.onChange] - re-render after import
 * @param {() => string|null} [deps.getStoredTheme] - read current theme
 * @param {object} [deps.theme] - { getStored, set, apply } — defaults to singleton
 * @param {object} [deps.panels] - panels controller; registers the settings
 *   renderer so showPanel('settings') actually mounts the auth zone + picker.
 *   Optional for back-compat with tests that wire the panel manually.
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
  onChange = null,
  getStoredTheme = defaultTheme.getStored,
  theme: themeDep = defaultTheme,
  panels = null,
} = {}) {
  let settingsRendered = false;

  // Register with the panel router so showPanel('settings') mounts both the
  // auth zone (GIS button) and the theme picker + import/export wiring.
  // No boot-time call here — that would trigger real auth loading in tests
  // where the controller is stubbed directly.
  if (panels) panels.register('settings', () => { renderAuth(); renderSettings(); });

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

  function renderThemePicker() {
    const zone = document.getElementById('settings-theme-zone');
    if (!zone) return;
    const current = getStoredTheme() || DEFAULT_THEME;
    const swatches = THEME_NAMES.map((name) => {
      const p = THEME_PALETTES[name];
      const active = name === current;
      const cls = `theme-swatch${active ? ' is-active' : ''}`;
      return `<button type="button" data-theme="${name}" class="${cls}" role="radio" `
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
