// ════════════════════════════════════════════════════════
// google.js — Google ID token verification (RS256 via jose)
// ════════════════════════════════════════════════════════

import { jwtVerify, importJWK, createRemoteJWKSet } from 'jose';

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function base64UrlDecode(str) {
  // base64url → bytes, using only Web APIs available in Node ≥16 and Workers.
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Verify a Google ID token and return its claims, or null on any failure.
 * getKey(kid) supplies the public key (in production, the cached Google JWKS;
 * in tests, a fixture key). Requires email_verified === true.
 * @param {string} idToken
 * @param {string} clientId expected `aud`
 * @param {(kid:string)=>Promise<CryptoKey|object>} getKey returns a key/JWK
 * @returns {Promise<{sub:string,email:string,email_verified:boolean}|null>}
 */
export async function verifyIdToken(idToken, clientId, getKey) {
  if (typeof idToken !== 'string' || !idToken) return null;
  // peek at the header to get kid without verifying
  let kid = '';
  try {
    const header = JSON.parse(base64UrlDecode(idToken.split('.')[0]));
    kid = header.kid || '';
  } catch {
    return null;
  }
  let key;
  try {
    key = await getKey(kid);
    // accept a raw JWK object by importing it
    if (key && typeof key === 'object' && !(key instanceof CryptoKey) && key.kty) {
      key = await importJWK(key);
    }
  } catch {
    return null;
  }
  try {
    const { payload } = await jwtVerify(idToken, key, {
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
 * Build a cached JWKS key getter for production. Fetches once, then returns
 * the key matching `kid`. Not used by unit tests (they inject a fixture key).
 * @param {string} jwksUrl
 * @returns {(kid:string)=>Promise<CryptoKey>}
 */
export function makeJwksGetter(jwksUrl) {
  const set = createRemoteJWKSet(new URL(jwksUrl));
  return async (kid) => set.getKey({ kid });
}