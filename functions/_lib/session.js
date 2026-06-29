// ════════════════════════════════════════════════════════
// session.js — server-signed HS256 session JWT (pure, uses jose)
// ════════════════════════════════════════════════════════

import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'cookbook-api';

/**
 * Mint a session JWT for the given user. TTL is in seconds.
 * @param {{sub:string, email:string}} claims
 * @param {string} secret
 * @param {number} ttlSec
 * @returns {Promise<string>}
 */
export async function signSession({ sub, email }, secret, ttlSec) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('SESSION_SECRET not configured or too short (need >=16 chars)');
  }
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ sub, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(`${ttlSec} s`)
    .sign(key);
}

/**
 * Verify a session JWT. Returns the claims on success, null on any failure
 * (bad signature, wrong issuer, expired, malformed).
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<{sub:string,email:string}|null>}
 */
export async function verifySession(token, secret) {
  if (typeof token !== 'string' || !token) return null;
  if (typeof secret !== 'string' || secret.length < 16) return null;
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
