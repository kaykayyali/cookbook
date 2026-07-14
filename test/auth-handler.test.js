import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuth, authorize } from '../functions/_lib/handler.js';

const env = {
  GOOGLE_CLIENT_ID: 'client-123',
  ALLOWED_EMAILS: 'you@example.com',
  SESSION_SECRET: 'secret-32-chars-min-aaaaaaaaaaaaa',
  SESSION_TTL: '3600',
};

const goodDeps = {
  verifyIdToken: async () => ({ sub: 'g-1', email: 'you@example.com', email_verified: true }),
  signSession: async () => 'session-jwt-xyz',
  isAllowed: (email, list) => email === 'you@example.com' && list === env.ALLOWED_EMAILS,
  verifySession: async (t) => (t === 'session-jwt-xyz' ? { sub: 'g-1', email: 'you@example.com' } : null),
};

test('handleAuth mints a session for a whitelisted user', async () => {
  const res = await handleAuth({ idToken: 'tok' }, env, goodDeps);
  assert.equal(res.status, 200);
  assert.equal(res.body.token, 'session-jwt-xyz');
  assert.equal(res.body.email, 'you@example.com');
  assert.ok(res.body.expiresAt > 0);
});

test('handleAuth 401 when the Google token is invalid', async () => {
  const deps = { ...goodDeps, verifyIdToken: async () => null };
  const res = await handleAuth({ idToken: 'bad' }, env, deps);
  assert.equal(res.status, 401);
});

test('handleAuth 403 when email is not whitelisted', async () => {
  const deps = { ...goodDeps, verifyIdToken: async () => ({ sub: 'g-2', email: 'stranger@example.com', email_verified: true }) };
  const res = await handleAuth({ idToken: 'tok' }, env, deps);
  assert.equal(res.status, 403);
});

test('handleAuth 400 when idToken missing', async () => {
  const res = await handleAuth({}, env, goodDeps);
  assert.equal(res.status, 400);
});

test('authorize accepts a valid Bearer token', async () => {
  const req = { headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer session-jwt-xyz' : null) } };
  const res = await authorize(req, env, goodDeps);
  assert.equal(res.ok, true);
  assert.equal(res.claims.email, 'you@example.com');
});

test('authorize 401 when no Authorization header', async () => {
  const req = { headers: { get: () => null } };
  const res = await authorize(req, env, goodDeps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test('authorize 401 when token invalid', async () => {
  const req = { headers: { get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer nope' : null) } };
  const res = await authorize(req, env, goodDeps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test('authorization failures never log bearer or session-secret fragments', async () => {
  const logs = [];
  const original = console.error;
  console.error = (...parts) => logs.push(parts.join(' '));
  try {
    const req = { headers: { get: () => 'Bearer uniquely-sensitive-bearer-token' } };
    await authorize(req, env, { ...goodDeps, verifySession: async () => null });
    const output = logs.join('\n');
    assert.doesNotMatch(output, /uniquely-sensitive/);
    assert.doesNotMatch(output, /sec(?:ret)?/i);
  } finally {
    console.error = original;
  }
});
