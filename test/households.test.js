import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUSEHOLD_SCHEMA,
  ensureHouseholdSchema,
  isHouseholdInvitee,
  membershipForUser,
  acceptHouseholdInvite,
} from '../functions/_lib/households.js';
import { householdDb } from '../test-support/household-db.js';

test('household schema creates private households, unique memberships, and no email column', async () => {
  const prepared = [];
  const db = {
    prepare(sql) { prepared.push(sql); return { run: async () => ({ meta: {} }) }; },
    batch: async (statements) => Promise.all(statements.map((stmt) => stmt.run())),
  };

  await ensureHouseholdSchema(db);
  const ddl = prepared.join('\n');
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS households/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS household_members/);
  assert.match(ddl, /UNIQUE[^\n]*user_sub|CREATE UNIQUE INDEX[^\n]*user_sub/i);
  assert.doesNotMatch(HOUSEHOLD_SCHEMA, /\bemail\b/i);
});

test('household invitation roster is explicit, trimmed, and case-insensitive', () => {
  const roster = 'kaykayyali@gmail.com, gloriakayyali@gmail.com';
  assert.equal(isHouseholdInvitee('GLORIAKAYYALI@gmail.com', roster), true);
  assert.equal(isHouseholdInvitee(' kaykayyali@gmail.com ', roster), true);
  assert.equal(isHouseholdInvitee('kayyaliehab25@gmail.com', roster), false);
  assert.equal(isHouseholdInvitee('', roster), false);
});

test('accepting a household invitation is idempotent and exposes display identity without email', async () => {
  const { db, households, members } = householdDb();
  const env = {
    HOUSEHOLD_ID: 'our-home',
    HOUSEHOLD_NAME: 'Our Home',
    HOUSEHOLD_MEMBER_EMAILS: 'kaykayyali@gmail.com,gloriakayyali@gmail.com',
    HOUSEHOLD_OWNER_EMAIL: 'kaykayyali@gmail.com',
  };
  const auth = {
    sub: 'google-kaysser',
    email: 'kaykayyali@gmail.com',
    name: 'Kaysser',
    picture: 'https://example.com/k.png',
  };

  const first = await acceptHouseholdInvite(db, auth, env, 1_000);
  const second = await acceptHouseholdInvite(db, auth, env, 2_000);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(households.size, 1);
  assert.equal(members.size, 1);
  assert.deepEqual(second.membership, {
    household: { id: 'our-home', name: 'Our Home' },
    member: {
      id: 'google-kaysser',
      displayName: 'Kaysser',
      picture: 'https://example.com/k.png',
      role: 'owner',
    },
  });
  assert.equal(JSON.stringify(second).includes('kaykayyali@gmail.com'), false);
});

test('a second invited identity joins the same household as a member', async () => {
  const { db } = householdDb();
  const env = {
    HOUSEHOLD_ID: 'our-home',
    HOUSEHOLD_NAME: 'Our Home',
    HOUSEHOLD_MEMBER_EMAILS: 'kaykayyali@gmail.com,gloriakayyali@gmail.com',
    HOUSEHOLD_OWNER_EMAIL: 'kaykayyali@gmail.com',
  };
  await acceptHouseholdInvite(db, { sub: 'k', email: 'kaykayyali@gmail.com', name: 'Kaysser' }, env, 1_000);
  const gloria = await acceptHouseholdInvite(db, { sub: 'g', email: 'gloriakayyali@gmail.com', name: 'Gloria' }, env, 1_001);

  assert.equal(gloria.membership.household.id, 'our-home');
  assert.equal(gloria.membership.member.role, 'member');
  assert.equal(gloria.membership.member.displayName, 'Gloria');
  assert.deepEqual(await membershipForUser(db, 'g'), gloria.membership);
});

test('migration file matches the self-healing household schema', () => {
  const migration = readFileSync(new URL('../docs/superpowers/migrations/0004_households.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS households/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS household_members/);
  assert.match(migration, /UNIQUE \(user_sub\)/);
  assert.match(migration, /FOREIGN KEY\s*\(household_id\)/);
});

test('deployment admits exactly the same two identities invited to the household', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const values = (name) => config.match(new RegExp(`^${name} = "([^"]*)"$`, 'm'))?.[1]
    .split(',').map((email) => email.trim().toLowerCase()).sort();

  const allowed = values('ALLOWED_EMAILS');
  const invited = values('HOUSEHOLD_MEMBER_EMAILS');
  assert.deepEqual(allowed, ['gloriakayyali@gmail.com', 'kaykayyali@gmail.com']);
  assert.deepEqual(invited, allowed);
});
