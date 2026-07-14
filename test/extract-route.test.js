// ════════════════════════════════════════════════════════
// extract-route.test.js — locks the _middleware → /api/extract auth contract.
//
// The middleware verifies the Bearer token and must hand the claims to the
// route handler. The channel is `context.data.auth` (the documented Pages
// Functions middleware→handler channel) — NOT `request.auth`, because
// expando properties on Request do not reliably survive next() in the
// Workers runtime. The prior code used request.auth and the route saw
// `undefined` for every authenticated request (401 invalid_token) even
// though authorize() had succeeded. These tests pin the contract so a
// regression to request.auth is caught locally, not in production.
// ════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '../functions/_lib/session.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequestPost as extractRoute, realDeps } from '../functions/api/extract.js';

const SECRET = 'test-secret-please-change-in-prod-32+chars';

test('middleware propagates verified claims via context.data (not request.auth)', async () => {
  // Real jose round-trip: mint a token, let the middleware's authorize()
  // verify it, and confirm claims land on context.data.auth before next().
  const token = await signSession({ sub: 'g-1', email: 'you@example.com' }, SECRET, 3600);
  let nextSawData;
  let nextSawRequestAuth;
  const context = {
    request: {
      url: 'https://cookbook.example/api/extract',
      headers: { get: (h) => (h.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
    },
    env: { SESSION_SECRET: SECRET, ALLOWED_EMAILS: 'you@example.com' },
    next: async () => {
      nextSawData = context.data;
      nextSawRequestAuth = context.request.auth;
      return new Response('ok');
    },
  };
  const res = await middleware(context);
  assert.equal(res.status, 200);
  assert.equal(nextSawData?.auth?.email, 'you@example.com');
  // The middleware must NOT rely on request.auth — assert it deliberately
  // leaves the Request expando unset so the route never reads it.
  assert.equal(nextSawRequestAuth, undefined);
});

test('extract route reads auth from context.data and passes the auth gate', async () => {
  // Auth present via context.data, but env.AI missing → the route must reach
  // the AI-binding guard (500), proving the auth check passed. The old
  // request.auth code would have returned 401 invalid_token here instead.
  const context = {
    request: { json: async () => ({ url: 'https://example.com/x' }) },
    env: { EXTRACT_RATE_PER_MIN: '10' }, // no AI binding
    data: { auth: { sub: 'g-1', email: 'you@example.com' } },
  };
  const res = await extractRoute(context);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'server_misconfigured', reason: 'ai_binding' });
});

test('extract route returns 401 invalid_token when claims did not propagate', async () => {
  // The production failure mode: middleware verified the token but claims
  // never reached the route (no context.data.auth). Must 401 invalid_token
  // rather than fall through to extraction.
  const context = {
    request: { json: async () => ({ url: 'https://example.com/x' }) },
    env: { AI: { run: async () => '' }, EXTRACT_RATE_PER_MIN: '10' },
    data: undefined,
  };
  const res = await extractRoute(context);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'invalid_token' });
});

test('Workers AI extraction allows enough output tokens for a complete recipe', async () => {
  let input;
  const deps = realDeps({
    AI: { run: async (_model, options) => { input = options; return { response: '{}' }; } },
  });

  await deps.runLLM([{ role: 'user', content: 'extract this recipe' }]);

  assert.equal(input.max_tokens, 2048);
});