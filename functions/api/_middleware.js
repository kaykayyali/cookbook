// ════════════════════════════════════════════════════════
// _middleware.js — gate /api/* with a session token (skip /api/auth)
// ════════════════════════════════════════════════════════

import { authorize } from '../_lib/handler.js';
import { verifySession } from '../_lib/session.js';
import { json } from '../_lib/http.js';

const deps = { verifySession };

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  // /api/auth is the only public route; everything else under /api/* needs auth.
  if (url.pathname === '/api/auth') return next();
  if (typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 16) {
    return json(500, { error: 'server_misconfigured' });
  }
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return json(auth.status, auth.body);
  return next();
}
