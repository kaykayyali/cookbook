// Integration test: verifyIdToken works end-to-end through a real
// jose.createRemoteJWKSet pointed at a local JWKS HTTP endpoint.
//
// This is what would have caught the makeJwksGetter `set.getKey({kid})` bug:
// every prior test mocked the key getter, so the broken JWKS path was never
// exercised. Here we build the resolver for real, point it at a local server,
// and verify the full sign-in -> verify cycle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { importPKCS8, SignJWT, exportJWK } from 'jose';
import crypto from 'node:crypto';
import { verifyIdToken, makeJwksResolver } from '../functions/_lib/google.js';

async function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const priv = await importPKCS8(pkcs8, 'RS256');
  const pubJwk = await exportJWK(publicKey);
  return { priv, pubJwk };
}

/** Spin up a local HTTP server that serves a JWKS document at /jwks. */
function startJwksServer(jwks) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/jwks') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(jwks));
      } else {
        res.writeHead(404); res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/jwks` });
    });
  });
}

test('verifyIdToken resolves the correct kid via the production JWKS resolver', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  const kid = 'real-kid-1';
  const jwks = { keys: [{ ...pubJwk, kid, alg: 'RS256', use: 'sig' }] };
  const { server, url } = await startJwksServer(jwks);
  try {
    // Sanity: the production resolver shape is what jwtVerify consumes.
    const getKey = makeJwksResolver(url);
    assert.equal(typeof getKey, 'function', 'makeJwksResolver returns a callable');

    const token = await new SignJWT({ sub: 'g-real', email: 'you@example.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setIssuer('https://accounts.google.com')
      .setAudience('prod-client')
      .setExpirationTime('60 s')
      .sign(priv);

    const claims = await verifyIdToken(token, 'prod-client', getKey);
    assert.deepEqual(claims, { sub: 'g-real', email: 'you@example.com', email_verified: true, name: 'you', picture: null });
  } finally {
    server.close();
  }
});

test('verifyIdToken rejects when kid is not found in JWKS', async () => {
  const { priv, pubJwk } = await makeKeyPair();
  // Serve a JWKS whose kid does not match the token's kid.
  const jwks = { keys: [{ ...pubJwk, kid: 'wrong-kid', alg: 'RS256', use: 'sig' }] };
  const { server, url } = await startJwksServer(jwks);
  try {
    const getKey = makeJwksResolver(url);
    const token = await new SignJWT({ sub: 'g-1', email: 'you@example.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'real-kid-1' })
      .setIssuedAt()
      .setIssuer('https://accounts.google.com')
      .setAudience('prod-client')
      .setExpirationTime('60 s')
      .sign(priv);

    const claims = await verifyIdToken(token, 'prod-client', getKey);
    assert.equal(claims, null);
  } finally {
    server.close();
  }
});

test('makeJwksResolver follows jose getKey contract (protectedHeader, token)', async () => {
  // Smoke: the resolver must be a function that jose's jwtVerify can consume
  // directly. This guards against regressions like the previous
  // `set.getKey({kid})` invocation that called a method that does not exist
  // on jose v5's createRemoteJWKSet result.
  const { pubJwk } = await makeKeyPair();
  const kid = 'shape-test';
  const jwks = { keys: [{ ...pubJwk, kid, alg: 'RS256', use: 'sig' }] };
  const { server, url } = await startJwksServer(jwks);
  try {
    const getKey = makeJwksResolver(url);
    assert.equal(typeof getKey, 'function', 'makeJwksResolver returns a callable');
    // jose's callable is invoked with (protectedHeader, token) — exercise that
    // exact shape, which is what jwtVerify uses internally.
    const key = await getKey({ alg: 'RS256', kid }, undefined);
    assert.ok(key, 'getKey(protectedHeader, token) returns a key');
  } finally {
    server.close();
  }
});