import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importPKCS8, SignJWT, exportJWK } from 'jose';
import crypto from 'node:crypto';
import { verifyIdToken } from '../functions/_lib/google.js';

async function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const priv = await importPKCS8(pkcs8, { alg: 'RS256' });
  const pubJwk = await exportJWK(publicKey);
  return { priv, pubJwk };
}

test('verifyIdToken returns claims (incl. name + picture) for a valid Google ID token', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: true, name: 'You', picture: 'https://x/a.png' })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt()
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const getKey = async () => pubJwk;
  const claims = await verifyIdToken(token, 'client-123', getKey);
  assert.deepEqual(claims, { sub: 'g-123', email: 'you@example.com', email_verified: true, name: 'You', picture: 'https://x/a.png' });
});

test('verifyIdToken falls back to the email local-part when name is absent', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const claims = await verifyIdToken(token, 'client-123', async () => pubJwk);
  assert.equal(claims.name, 'you');
  assert.equal(claims.picture, null);
});

test('verifyIdToken rejects wrong audience', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const claims = await verifyIdToken(token, 'wrong-client', async () => pubJwk);
  assert.equal(claims, null);
});

test('verifyIdToken rejects unverified email', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const token = await new SignJWT({ sub: 'g-123', email: 'you@example.com', email_verified: false })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-123')
    .setExpirationTime('60 s')
    .sign(priv);
  const claims = await verifyIdToken(token, 'client-123', async () => pubJwk);
  assert.equal(claims, null);
});

test('verifyIdToken rejects garbage', async () => {
  const claims = await verifyIdToken('not-a-token', 'client-123', async () => (await makeKeyPair()).pubJwk);
  assert.equal(claims, null);
});
