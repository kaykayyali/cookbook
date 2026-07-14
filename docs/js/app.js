// app.js — orchestration: auth gate → load recipes → wire controllers to the DOM
import { $ } from './lib/dom.js';
import { state, init, loadHousehold, loadRecipes } from './lib/store.js';
import { loadAuth, getToken, initGoogleSignIn, clearAuth } from './lib/auth.js';

import { initPanels } from './controllers/panels.js';
import { initRecipes } from './controllers/recipes.js';
import { initPantry } from './controllers/pantry.js';
import { initCart } from './controllers/cart.js';
import { initDetail } from './controllers/detail.js';
import { initDrawer } from './controllers/drawer.js';
import { initExtract } from './controllers/extract.js';
import { initSettings } from './controllers/settings.js';
import { initFab } from './controllers/fab.js';
import { initSearch } from './controllers/search.js';
import { showRecipeSchema, wireSchemaModal, exportRecipesToFile } from './lib/schema-modal.js';

const readSub = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch { return null; } };

// ════════════════════════════════════════════════════════
// Login gate
// ════════════════════════════════════════════════════════

const MAIN = $('main-content');
const LOGIN_GATE = $('login-gate');

function showLoginGate() {
  if (MAIN) MAIN.style.display = 'none';
  if (LOGIN_GATE) {
    LOGIN_GATE.style.display = '';
    const btn = LOGIN_GATE.querySelector('#login-gate-btn');
    if (btn) {
      initGoogleSignIn({
        buttonEl: btn,
        clientId: typeof window !== 'undefined' ? window.COOKBOOK_GOOGLE_CLIENT_ID : undefined,
        onSignedIn: () => bootAfterAuth(),
        onError: (msg) => {
          const err = LOGIN_GATE.querySelector('.login-error');
          if (err) err.textContent = msg;
        },
      });
    }
  }
}

// ════════════════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════════════════

async function bootAfterAuth() {
  if (LOGIN_GATE) LOGIN_GATE.style.display = 'none';
  if (MAIN) MAIN.style.display = '';

  init(); // load pantry + cart from localStorage

  const householdOk = await loadHousehold({
    onUnauthorized: async () => {
      await clearAuth();
      showLoginGate();
    },
  });
  if (!getToken()) return;
  if (!householdOk || !state.household) {
    showLoginGate();
    const err = LOGIN_GATE?.querySelector('.login-error');
    if (err) err.textContent = 'We couldn’t open Our Cookbook. Refresh to try again.';
    return;
  }

  // Load recipes from server; on 401, show login gate and clear auth
  const ok = await loadRecipes({
    onUnauthorized: async () => {
      await clearAuth();
      showLoginGate();
    },
  });
  if (!ok) {
    showLoginGate();
    return;
  }

  // Wire controllers
  const panels = initPanels({ state });
  const drawer = initDrawer({ state, onSchema: showRecipeSchema, onSaved: () => panels.renderActive() });
  state.auth = (() => { const a = loadAuth(); return { sub: readSub(a.token), email: a.email }; })();
  const detail = initDetail({ state, onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema, onChange: () => recipes.render() });
  const recipes = initRecipes({ state, onOpenDetail: (id) => detail.open(id), onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema });
  const pantry = initPantry({ state });
  const cart = initCart({ state });
  const extract = initExtract({ state, openPrefilled: (r) => drawer.openPrefilled(r) });
  const settings = initSettings({ state, exportRecipes: () => exportRecipesToFile(state), onSignedIn: (email) => { state.auth = { sub: readSub(getToken()), email }; }, onSignedOut: async () => { await clearAuth(); showLoginGate(); } });
  panels.register('recipes', recipes.render);
  panels.register('pantry', pantry.render);
  panels.register('cart', cart.render);
  panels.register('settings', () => { settings.renderSettings(); settings.renderAuth(); });
  settings.renderAuth();
  initFab({ state, openDrawer: (id) => drawer.open(id), extract, showPanel: panels.showPanel });
  initSearch({ state, onChange: () => recipes.render() });
  wireSchemaModal();

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('schema-overlay')?.classList.contains('open')) $('schema-overlay').classList.remove('open');
    else if ($('url-overlay')?.classList.contains('open')) extract.close();
    else if ($('recipe-drawer')?.classList.contains('open')) drawer.close();
    else if ($('detail-modal')?.classList.contains('open')) detail.close();
  });

  panels.showPanel('recipes');
}

// ════════════════════════════════════════════════════════
// Entry point
// ════════════════════════════════════════════════════════

const _boot = (async function() {
  const token = getToken();
  if (!token) {
    showLoginGate();
    return;
  }
  await bootAfterAuth();
})();

export { _boot as ready };
