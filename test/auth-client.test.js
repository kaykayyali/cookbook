import { test } from 'node:test';
import assert from 'node:assert/strict';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('re-rendering Google sign-in uses the latest success callback without reinitializing GIS', async (t) => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
  };
  t.after(() => Object.assign(globalThis, original));

  let gisCallback;
  let initializeCount = 0;
  globalThis.window = {
    COOKBOOK_API: '/api',
    google: {
      accounts: {
        id: {
          initialize(options) {
            initializeCount += 1;
            gisCallback = options.callback;
          },
          renderButton() {},
        },
      },
    },
  };
  globalThis.document = { head: { appendChild() {} }, createElement: () => ({}) };
  globalThis.localStorage = memoryStorage();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ token: 'session-token', email: 'cook@example.com' }),
  });

  const auth = await import(`../docs/js/lib/auth.js?latest-callback=${Date.now()}`);
  const calls = [];
  await auth.initGoogleSignIn({
    buttonEl: {},
    clientId: 'client-id',
    onSignedIn: () => calls.push('settings'),
    onError: assert.fail,
  });
  await auth.initGoogleSignIn({
    buttonEl: {},
    clientId: 'client-id',
    onSignedIn: () => calls.push('login-gate'),
    onError: assert.fail,
  });

  assert.equal(initializeCount, 1, 'GIS initialize remains one-shot');
  await gisCallback({ credential: 'google-id-token' });
  assert.deepEqual(calls, ['login-gate'], 'the visible login surface owns the callback');
  assert.equal(globalThis.localStorage.getItem('cb_token'), 'session-token');
});
