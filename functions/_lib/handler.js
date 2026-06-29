// ════════════════════════════════════════════════════════
// handler.js — pure request handlers (deps injected for testing)
// ════════════════════════════════════════════════════════

const DEFAULT_TTL = 604800; // 7 days

/**
 * Handle POST /api/auth. Returns a { status, body } envelope (no Response, so
 * it is unit-testable without the Workers runtime).
 * @param {{idToken?:string}} body
 * @param {object} env GOOGLE_CLIENT_ID, ALLOWED_EMAILS, SESSION_SECRET, SESSION_TTL
 * @param {object} deps verifyIdToken, signSession, isAllowed
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleAuth(body, env, deps) {
  const idToken = body && typeof body === 'object' ? body.idToken : undefined;
  if (typeof idToken !== 'string' || !idToken) {
    return { status: 400, body: { error: 'missing_id_token' } };
  }
  const claims = await deps.verifyIdToken(idToken, env.GOOGLE_CLIENT_ID);
  // verifyIdToken already enforces email_verified === true and returns null
  // otherwise — so the only way we reach this branch with a null claims is
  // a verification failure. Whitelist is the next gate.
  if (!claims) {
    return { status: 401, body: { error: 'invalid_id_token' } };
  }
  if (!deps.isAllowed(claims.email, env.ALLOWED_EMAILS)) {
    return { status: 403, body: { error: 'not_allowed' } };
  }
  const ttl = Number(env.SESSION_TTL) || DEFAULT_TTL;
  const token = await deps.signSession({ sub: claims.sub, email: claims.email }, env.SESSION_SECRET, ttl);
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  return { status: 200, body: { token, email: claims.email, expiresAt } };
}

/**
 * Authorize a protected request via its Bearer token. Returns either
 * { ok: true, claims } or { ok: false, status, body }.
 * @param {object} req with headers.get(name)
 * @param {object} env SESSION_SECRET
 * @param {object} deps verifySession
 * @returns {Promise<object>}
 */
export async function authorize(req, env, deps) {
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return { ok: false, status: 401, body: { error: 'missing_token' } };
  const claims = await deps.verifySession(m[1], env.SESSION_SECRET);
  if (!claims) return { ok: false, status: 401, body: { error: 'invalid_token' } };
  return { ok: true, claims };
}
