import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '../functions/_lib/session.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequestGet, onRequestPost } from '../functions/api/household.js';
import { acceptHouseholdInvite } from '../functions/_lib/households.js';
import { householdDb } from '../test-support/household-db.js';

const SECRET = 'test-secret-please-change-in-prod-32+chars';
const householdEnv = {
  ALLOWED_EMAILS: 'kaykayyali@gmail.com,gloriakayyali@gmail.com',
  HOUSEHOLD_ID: 'our-home',
  HOUSEHOLD_NAME: 'Our Home',
  HOUSEHOLD_MEMBER_EMAILS: 'kaykayyali@gmail.com,gloriakayyali@gmail.com',
  HOUSEHOLD_OWNER_EMAIL: 'kaykayyali@gmail.com',
};

function routeContext(db, auth) {
  return { env: { ...householdEnv, DB: db }, data: { auth } };
}

async function body(response) {
  return response.json();
}

test('eligible authenticated user sees onboarding before accepting the household invitation', async () => {
  const { db } = householdDb();
  const response = await onRequestGet(routeContext(db, {
    sub: 'g', email: 'gloriakayyali@gmail.com', name: 'Gloria', picture: null,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { household: null, member: null, eligible: true });
});

test('household join creates once, then returns the existing membership idempotently', async () => {
  const { db } = householdDb();
  const context = routeContext(db, {
    sub: 'k', email: 'kaykayyali@gmail.com', name: 'Kaysser', picture: null,
  });

  const first = await onRequestPost(context);
  const second = await onRequestPost(context);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const joined = await body(second);
  assert.equal(joined.household.name, 'Our Home');
  assert.equal(joined.member.displayName, 'Kaysser');
  assert.equal(joined.member.role, 'owner');
  assert.equal('email' in joined.member, false);
});

test('authenticated but uninvited identity cannot join or see another household', async () => {
  const { db } = householdDb();
  const context = routeContext(db, {
    sub: 'e', email: 'kayyaliehab25@gmail.com', name: 'Ehab', picture: null,
  });

  const join = await onRequestPost(context);
  assert.equal(join.status, 403);
  assert.deepEqual(await body(join), { error: 'household_not_invited' });

  const status = await onRequestGet(context);
  assert.equal(status.status, 200);
  assert.deepEqual(await body(status), { household: null, member: null, eligible: false });
});

test('API middleware resolves members and revokes sessions for identities removed from the two-user allowlist', async () => {
  const { db } = householdDb();
  await acceptHouseholdInvite(db, {
    sub: 'k', email: 'kaykayyali@gmail.com', name: 'Kaysser', picture: null,
  }, householdEnv, 1_000);
  const token = await signSession({
    sub: 'k', email: 'kaykayyali@gmail.com', name: 'Kaysser', picture: null,
  }, SECRET, 3_600);
  let nextData;
  const context = {
    request: {
      url: 'https://cookbook.example/api/extract',
      headers: { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
    },
    env: { ...householdEnv, DB: db, SESSION_SECRET: SECRET },
    next: async () => { nextData = context.data; return new Response('ok'); },
  };

  const response = await middleware(context);
  assert.equal(response.status, 200);
  assert.equal(nextData.household.household.id, 'our-home');
  assert.equal(nextData.household.member.id, 'k');

  const outsiderToken = await signSession({
    sub: 'e', email: 'kayyaliehab25@gmail.com', name: 'Ehab', picture: null,
  }, SECRET, 3_600);
  let outsiderContinued = false;
  const outsider = {
    request: {
      url: 'https://cookbook.example/api/extract',
      headers: { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${outsiderToken}` : null) },
    },
    env: { ...householdEnv, DB: db, SESSION_SECRET: SECRET },
    next: async () => { outsiderContinued = true; return new Response('ok'); },
  };
  const outsiderResponse = await middleware(outsider);
  assert.equal(outsiderResponse.status, 403);
  assert.deepEqual(await outsiderResponse.json(), { error: 'email_not_allowed' });
  assert.equal(outsiderContinued, false);
});
