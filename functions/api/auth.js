// ════════════════════════════════════════════════════════
// auth.js — POST /api/auth : verify Google ID token, mint session
// ════════════════════════════════════════════════════════

import { handleAuth } from '../_lib/handler.js';
import { verifyIdToken, makeJwksResolver } from '../_lib/google.js';
import { signSession } from '../_lib/session.js';
import { isAllowed } from '../_lib/whitelist.js';
import { json } from '../_lib/http.js';

// Production JWKS resolver — a cached JWKS-backed getKey. Built once per
// isolate. jose handles `kid` lookup and JWKS refresh internally.
const getKey = makeJwksResolver();

const deps = {
  verifyIdToken: (idToken, clientId) => verifyIdToken(idToken, clientId, getKey),
  signSession,
  isAllowed,
};

function misconfigured(reason) {
  // Distinguishing codes so operators can tell which binding is missing
  // (the previous generic 'server_misconfigured' conflated 4 distinct states).
  return json(500, { error: 'server_misconfigured', reason });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (typeof env.GOOGLE_CLIENT_ID !== 'string' || !env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID.includes('replace-me')) {
    return misconfigured('google_client_id');
  }
  if (typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 16) {
    return misconfigured('session_secret');
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }
  const { status, body: out } = await handleAuth(body, env, deps);
  return json(status, out);
}