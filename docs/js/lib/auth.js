// ════════════════════════════════════════════════════════
// auth.js — Google sign-in + session token storage (no DOM beyond GIS)
// ════════════════════════════════════════════════════════

import { STORAGE_KEYS } from './constants.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** API base: same-origin ('/api') in dev and prod; override only if needed. */
export const API_BASE = (typeof window !== 'undefined' && window.COOKBOOK_API) || '/api';

// GIS load is cached but only on success — a rejected promise drops so callers
// can retry after a transient failure (network blip, captive portal).
let gsiPromise = null;
function loadGsi() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => {
      gsiPromise = null; // drop the cache so the next call retries
      reject(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/** Read persisted auth state. */
export function loadAuth() {
  return {
    token: localStorage.getItem(STORAGE_KEYS.token) || '',
    email: localStorage.getItem(STORAGE_KEYS.email) || '',
  };
}

/** Persist token + email. */
export function saveAuth(token, email) {
  localStorage.setItem(STORAGE_KEYS.token, token);
  localStorage.setItem(STORAGE_KEYS.email, email);
}

/** Clear persisted auth state + tell GIS to forget the account. */
export async function clearAuth() {
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.email);
  await disableGisAutoSelect();
}

/**
 * Tell Google Identity Services to drop the auto-selected account so a
 * subsequent sign-in on this device prompts for an account pick instead of
 * silently re-authenticating as the previous user. Safe to call before GIS
 * has loaded (no-op).
 */
export async function disableGisAutoSelect() {
  try {
    const g = await loadGsi();
    g.accounts.id.disableAutoSelect();
  } catch {
    // GIS not loaded yet — there's nothing for us to disable.
  }
}

/** Current session token, or null. */
export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.token) || null;
}

/**
 * fetch wrapper that attaches the Bearer token when present. If the response
 * is 401, the persisted token is cleared (server says it's invalid) and the
 * optional `onUnauthorized` callback fires so the UI can re-render signed-out.
 * Returns the underlying `Response` so callers can branch on `res.ok`.
 */
export async function authFetch(path, init = {}, { onUnauthorized } = {}) {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    localStorage.removeItem(STORAGE_KEYS.token);
    if (onUnauthorized) onUnauthorized();
  }
  return res;
}

// GIS initialize/renderButton are designed to run once per page-load per
// client_id; calling initialize again throws "A second request placed on
// the page…" in some browsers. Guard the initialize step so repeated
// renderAuth() calls don't re-init GIS, but let renderButton re-render the
// existing button (idempotent).
let gisInitialized = false;
let gisClientId = null;
let gisCallbacks = { onSignedIn: null, onError: null };

/**
 * Render a "Sign in with Google" button. On success, exchange the Google ID
 * token for a session token via /api/auth, persist it, and call onSignedIn.
 * @param {object} opts buttonEl, clientId, onSignedIn(email), onError(msg)
 */
export async function initGoogleSignIn({ buttonEl, clientId, onSignedIn, onError }) {
  // GIS keeps the callback passed to its one-shot initialize call. Keep the
  // active surface's handlers separately so a later render (for example the
  // login gate after signing out from Settings) receives the credential.
  gisCallbacks = { onSignedIn, onError };
  if (!clientId || clientId.includes('replace-me')) {
    // Loud, deploy-time-blocker error so a forgotten client-id swap surfaces
    // immediately rather than as silent GIS failures.
    const msg = 'Google client ID not configured — set window.COOKBOOK_GOOGLE_CLIENT_ID before deploying';
    console.error(`[auth] ${msg}`);
    gisCallbacks.onError?.(msg);
    return;
  }
  try {
    const g = await loadGsi();
    if (!gisInitialized || gisClientId !== clientId) {
      g.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          if (!resp.credential) { gisCallbacks.onError?.('No credential returned'); return; }
          try {
            const res = await fetch(`${API_BASE}/auth`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken: resp.credential }),
            });
            const data = await res.json();
            if (!res.ok) { gisCallbacks.onError?.(data.error || 'auth_failed'); return; }
            if (!data || !data.token) { gisCallbacks.onError?.('auth_failed'); return; }
            saveAuth(data.token, data.email);
            gisCallbacks.onSignedIn?.(data.email);
          } catch (e) {
            gisCallbacks.onError?.(e.message || 'network');
          }
        },
      });
      gisInitialized = true;
      gisClientId = clientId;
    }
    g.accounts.id.renderButton(buttonEl, { type: 'standard', size: 'medium', theme: 'outline' });
  } catch (e) {
    gisCallbacks.onError?.(e.message || 'gis_load_failed');
  }
}
