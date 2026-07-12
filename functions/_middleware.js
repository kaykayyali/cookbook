// ════════════════════════════════════════════════════════
// _middleware.js — login gate for personal recipes
//
// All /api/* routes (except /api/auth) require a valid session token
// (enforced by functions/api/_middleware.js).
//
// This root middleware handles the login UX: unauthenticated requests to
// the main page get a login gate instead of the app. Static assets
// (CSS/JS/images) and /api/auth pass through so the login page can load.
// ════════════════════════════════════════════════════════

import { verifySession } from './_lib/session.js';

const deps = { verifySession };

const ASSET_EXTS = new Set([
  '.js', '.css', '.svg', '.png', '.jpg', '.webp', '.ico',
  '.woff', '.woff2', '.json', '.map',
]);

const PUBLIC_PREFIXES = ['/api/auth'];

function isPublic(pathname) {
  // Static assets always pass through
  const ext = pathname.slice(pathname.lastIndexOf('.'));
  if (ASSET_EXTS.has(ext)) return true;

  // Public API routes
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;

  return false;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (isPublic(url.pathname)) return next();

  // API routes: let the api/_middleware handle auth
  if (url.pathname.startsWith('/api/')) return next();

  // HTML pages: check session, serve login gate if unauthenticated
  const cookie = request.headers.get('Cookie') || '';
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) {
    // Secret missing: allow through (the api middleware will 500 if hit)
    return next();
  }

  const token = cookie.split(';').find((c) => c.trim().startsWith('cb_session='));
  if (!token) {
    // No session cookie — this is fine for the login gate page.
    // The client-side app.js will show the login screen.
    // We still serve the full app; the gate is client-side.
    return next();
  }

  // Has a session cookie — verify it. If valid, proceed. If invalid,
  // still serve the page (client-side will detect the bad token).
  try {
    const claims = await verifySession(token.split('=')[1].trim(), env.SESSION_SECRET);
    if (claims && claims.sub) {
      // Valid session — set auth context for downstream handlers
      if (!context.data) context.data = {};
      context.data.auth = claims;
    }
  } catch {
    // Invalid token — serve the page, client-side handles re-auth
  }

  return next();
}
