// ════════════════════════════════════════════════════════
// google.js — Google ID token verification (RS256 via jose)
// ════════════════════════════════════════════════════════

import { jwtVerify, importJWK, createRemoteJWKSet } from 'jose';

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Verify a Google ID token and return its claims, or null on any failure.
 * `getKey` follows jose's contract: (protectedHeader, token) => Promise<Key>.
 *   - production: pass the callable from makeJwksResolver() — jose resolves
 *     the key by kid from the JWKS endpoint.
 *   - tests: a fixture (protectedHeader) => JWK (jose accepts a JWK directly,
 *     but we importJWK first so crypto.subtle is happy in non-Workers runtimes).
 * Requires email_verified === true.
 * @param {string} idToken
 * @param {string} clientId expected `aud`
 * @param {Function} getKey jose-shaped (protectedHeader, token) => Promise<Key>
 * @returns {Promise<{sub:string,email:string,email_verified:boolean}|null>}
 */
export async function verifyIdToken(idToken, clientId, getKey) {
  if (typeof idToken !== 'string' || !idToken) return null;
  if (typeof getKey !== 'function') return null;
  try {
    const { payload } = await jwtVerify(idToken, getKey, {
      issuer: ISSUERS,
      audience: clientId,
    });
    if (payload.email_verified !== true) return null;
    return { sub: payload.sub, email: payload.email, email_verified: true };
  } catch {
    return null;
  }
}

/**
 * Build a JWKS-backed getKey for production. Returns the callable from
 * jose.createRemoteJWKSet, which caches keys and resolves by `kid` from the
 * JOSE header. The returned function follows jose's getKey contract:
 * (protectedHeader, token) => Promise<CryptoKey|JWK>.
 * @param {string} [jwksUrl]
 * @returns {Function}
 */
export function makeJwksResolver(jwksUrl = JWKS_URL) {
  const set = createRemoteJWKSet(new URL(jwksUrl));
  // The set callable already matches jose's getKey shape; return it directly.
  // We only wrap to allow an optional JWK fast-path for test fixtures.
  return async (protectedHeader, token) => set(protectedHeader, token);
}

/**
 * Helper for tests: build a jose-compatible getKey that returns a fixed JWK
 * regardless of kid. Imports the JWK once and caches the imported Key.
 * @param {object} jwk
 * @returns {Function}
 */
export function fixtureGetKey(jwk) {
  let cached = null;
  return async () => {
    if (!cached) cached = await importJWK(jwk);
    return cached;
  };
}