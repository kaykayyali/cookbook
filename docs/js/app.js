// app.js — orchestration: auth gate → load recipes → wire controllers to the DOM
import { $ } from './lib/dom.js';
import { state, init, loadHousehold, loadRecipes, loadWorkspace } from './lib/store.js';
import { loadAuth, getToken, initGoogleSignIn, clearAuth } from './lib/auth.js';

import { initWorkspaceRuntime } from './lib/workspace-runtime.js'; import { initRecipeRuntime } from './lib/recipe-runtime.js';
import { initPwa } from './lib/pwa.js';
import { openOfflineDb } from './lib/offline-db.js';
import { hydrateOfflineState } from './lib/offline-bootstrap.js';
import { wireAuthenticatedUi } from './lib/authenticated-ui.js';
import { requiresSessionReload } from './lib/session-boundary.js';
const readSub = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch { return null; } };
const MAIN = $('main-content');
const LOGIN_GATE = $('login-gate');
let bootPromise = null, appBooted = false, bootedSub = null;

function showLoginGate() {
  $('toast')?.classList.remove('show');
  if (MAIN) MAIN.style.display = 'none';
  if (LOGIN_GATE) {
    LOGIN_GATE.style.display = '';
    const btn = LOGIN_GATE.querySelector('#login-gate-btn');
    if (btn) {
      initGoogleSignIn({
        buttonEl: btn,
        clientId: typeof window !== 'undefined' ? window.COOKBOOK_GOOGLE_CLIENT_ID : undefined,
        onSignedIn: () => startAuthenticatedApp(),
        onError: (msg) => {
          const err = LOGIN_GATE.querySelector('.login-error');
          if (err) err.textContent = msg;
        },
      });
    }
  }
}

async function bootAfterAuth() {
  if (LOGIN_GATE) LOGIN_GATE.style.display = 'none';
  if (MAIN) MAIN.style.display = '';

  init();
  state.auth = (() => { const auth = loadAuth(); return { sub: readSub(auth.token), email: auth.email }; })();
  const onUnauthorized = async () => { await clearAuth(); showLoginGate(); };
  let repo = null;
  try { repo = await openOfflineDb(); } catch { /* online-only fallback */ }
  const cached = await hydrateOfflineState({ repo, authSub: state.auth.sub, state });
  let runtime, recipeRuntime, ui;
  const wire = async () => {
    runtime = await initWorkspaceRuntime({
      state, repo, authSub: state.auth.sub, onUnauthorized,
      onChange: () => ui?.renderShared(),
    });
    recipeRuntime = await initRecipeRuntime({ state, repo, authSub: state.auth.sub, onChange: () => ui?.renderActive() });
    ui = wireAuthenticatedUi({
      state,
      runtime,
      recipeRuntime,
      onSignedIn: (email) => { state.auth = { sub: readSub(getToken()), email }; },
      onSignedOut: async () => { await clearAuth(); showLoginGate(); },
    });
  };
  if (cached.cached) await wire();
  const cachedMembership = state.household;
  const householdOk = await loadHousehold({ onUnauthorized });
  if (!getToken()) return false;
  if (!householdOk || !state.household) {
    if (cached.cached) { state.household = cachedMembership; return true; }
    showLoginGate();
    const err = LOGIN_GATE?.querySelector('.login-error');
    if (err) err.textContent = 'We couldn’t open Our Cookbook. Refresh to try again.';
    return false;
  }
  await repo?.putMembership(state.auth.sub, state.household);
  const recipesOk = await loadRecipes({ onUnauthorized });
  if (!recipesOk && !cached.cached) {
    showLoginGate();
    return false;
  }
  if (recipesOk) { recipeRuntime?.setAuthority(state.recipes); await repo?.putRecipes(state.auth.sub, state.household.household.id, state.recipes); }
  if (runtime) {
    await runtime.refresh();
  } else {
    const workspaceOk = await loadWorkspace({ onUnauthorized });
    if (!workspaceOk) { showLoginGate(); return false; }
    const current = {
      householdId: state.household.household.id, revision: state.workspaceRevision, plan: state.plan,
      cart: state.cart, pantry: state.pantry, shoppingChecked: state.shoppingChecked,
      manualItems: state.manualItems, recentMutations: [], updatedAt: Date.now(),
    };
    await repo?.putWorkspace(state.auth.sub, current.householdId, current);
    await wire();
  }
  state.offlineCache = false;
  ui?.renderActive();
  return true;
}

function startAuthenticatedApp() {
  const nextAuth = loadAuth();
  const nextSub = readSub(nextAuth.token);
  if (requiresSessionReload(bootedSub, nextSub)) {
    globalThis.location?.reload?.();
    return Promise.resolve(false);
  }
  if (appBooted) {
    state.auth = { sub: nextSub, email: nextAuth.email };
    if (LOGIN_GATE) LOGIN_GATE.style.display = 'none';
    if (MAIN) MAIN.style.display = '';
    return Promise.resolve(true);
  }
  if (!bootPromise) {
    bootPromise = bootAfterAuth()
      .then((ok) => { appBooted = ok; if (ok) bootedSub = state.auth.sub; return ok; })
      .finally(() => { bootPromise = null; });
  }
  return bootPromise;
}

void initPwa();
const _boot = (async function() {
  const token = getToken();
  if (!token) {
    showLoginGate();
    return;
  }
  await startAuthenticatedApp();
})();

export { _boot as ready, startAuthenticatedApp };
