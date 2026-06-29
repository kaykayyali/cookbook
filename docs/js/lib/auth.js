// ════════════════════════════════════════════════════════
// auth.js — Google sign-in + session token storage (no DOM beyond GIS)
// ════════════════════════════════════════════════════════

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'cb_token';
const EMAIL_KEY = 'cb_email';

/** API base: same-origin ('/api') in dev and prod; override only if needed. */
export const API_BASE = (typeof window !== 'undefined' && window.COOKBOOK_API) || '/api';

let gsiPromise = null;
function loadGsi() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/** Read persisted auth state. */
export function loadAuth() {
  return {
    token: localStorage.getItem(TOKEN_KEY) || '',
    email: localStorage.getItem(EMAIL_KEY) || '',
  };
}

/** Persist token + email. */
export function saveAuth(token, email) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

/** Clear persisted auth state (sign-out). */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

/** Current session token, or null. */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

/** fetch wrapper that attaches the Bearer token when present. */
export async function authFetch(path, init = {}) {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/**
 * Render a "Sign in with Google" button. On success, exchange the Google ID
 * token for a session token via /api/auth, persist it, and call onSignedIn.
 * @param {object} opts buttonEl, clientId, onSignedIn(email), onError(msg)
 */
export async function initGoogleSignIn({ buttonEl, clientId, onSignedIn, onError }) {
  try {
    const g = await loadGsi();
    g.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        if (!resp.credential) { onError?.('No credential returned'); return; }
        try {
          const res = await fetch(`${API_BASE}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: resp.credential }),
          });
          const data = await res.json();
          if (!res.ok) { onError?.(data.error || 'auth_failed'); return; }
          saveAuth(data.token, data.email);
          onSignedIn?.(data.email);
        } catch (e) {
          onError?.(e.message || 'network');
        }
      },
    });
    g.accounts.id.renderButton(buttonEl, { type: 'standard', size: 'medium', theme: 'outline' });
  } catch (e) {
    onError?.(e.message || 'gis_load_failed');
  }
}