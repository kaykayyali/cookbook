import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from '../functions/_lib/session.js';

const SECRET = 'test-secret-please-change-in-prod-32+chars';

test('signSession + verifySession round-trip the claims', async () => {
  const token = await signSession({ sub: '123', email: 'a@b.com' }, SECRET, 3600);
  const claims = await verifySession(token, SECRET);
  assert.deepEqual(claims, { sub: '123', email: 'a@b.com' });
});

test('verifySession rejects a token signed with a different secret', async () => {
  const token = await signSession({ sub: '123', email: 'a@b.com' }, SECRET, 3600);
  const claims = await verifySession(token, 'wrong-secret');
  assert.equal(claims, null);
});

test('verifySession rejects an expired token', async () => {
  // ttl 0 → already expired
  const token = await signSession({ sub: '123', email: 'a@b.com' }, SECRET, 0);
  const claims = await verifySession(token, SECRET);
  assert.equal(claims, null);
});

test('verifySession rejects garbage', async () => {
  assert.equal(await verifySession('not-a-jwt', SECRET), null);
  assert.equal(await verifySession('', SECRET), null);
});