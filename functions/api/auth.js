// ════════════════════════════════════════════════════════
// auth.js — POST /api/auth : verify Google ID token, mint session
// ════════════════════════════════════════════════════════

import { handleAuth } from '../_lib/handler.js';
import { verifyIdToken, makeJwksGetter } from '../_lib/google.js';
import { signSession } from '../_lib/session.js';
import { isAllowed } from '../_lib/whitelist.js';
import { json } from '../_lib/http.js';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const keyGetter = makeJwksGetter(GOOGLE_JWKS);

const deps = {
  verifyIdToken: (idToken, clientId) => verifyIdToken(idToken, clientId, keyGetter),
  signSession,
  isAllowed,
};

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }
  const { status, body: out } = await handleAuth(body, env, deps);
  return json(status, out);
}