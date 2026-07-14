// ════════════════════════════════════════════════════════
// _middleware.js — gate /api/* with a session token (skip /api/auth)
// ════════════════════════════════════════════════════════

import { authorize } from '../_lib/handler.js';
import { verifySession } from '../_lib/session.js';
import { json } from '../_lib/http.js';
import { ensureHouseholdSchemaOnce, membershipForUser } from '../_lib/households.js';
import { isAllowed } from '../_lib/whitelist.js';

const deps = { verifySession };

const PUBLIC_PATHS = new Set(['/api/auth']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  // Public routes opt out of the auth gate; everything else under /api/*
  // requires a valid session token. Maintain this as a set, not as
  // path-prefix tests, so future sibling routes can be added safely.
  if (PUBLIC_PATHS.has(url.pathname)) return next();
  if (typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 16) {
    return json(500, { error: 'server_misconfigured', reason: 'session_secret' });
  }
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return json(auth.status, auth.body);
  if (!isAllowed(auth.claims.email, env.ALLOWED_EMAILS)) {
    return json(403, { error: 'email_not_allowed' });
  }
  // Propagate verified claims to downstream handlers via `context.data` —
  // the documented Pages Functions middleware→handler channel. Do NOT use
  // `request.auth`: arbitrary (expando) properties on Request do not
  // reliably survive next() in the Workers runtime, so the route handler
  // would see `undefined` and reject every authenticated request.
  if (!context.data) context.data = {};
  context.data.auth = auth.claims;
  if (env.DB?.prepare) {
    try {
      await ensureHouseholdSchemaOnce(env.DB);
      context.data.household = await membershipForUser(env.DB, auth.claims.sub);
    } catch (error) {
      console.error('[Authorize] Household membership lookup failed:', error);
      return json(500, { error: 'household_unavailable' });
    }
  } else {
    context.data.household = null;
  }
  return next();
}