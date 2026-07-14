import { json, misconfigured } from '../_lib/http.js';
import {
  acceptHouseholdInvite,
  ensureHouseholdSchemaOnce,
  isHouseholdInvitee,
  membershipForUser,
} from '../_lib/households.js';

function authFrom(context) {
  const auth = context?.data?.auth;
  return auth?.sub && auth?.email ? auth : null;
}

function onboarding(auth, env) {
  return {
    household: null,
    member: null,
    eligible: isHouseholdInvitee(auth.email, env.HOUSEHOLD_MEMBER_EMAILS),
  };
}

async function prepare(context) {
  const auth = authFrom(context);
  if (!auth) return { response: json(401, { error: 'invalid_token' }) };
  if (!context?.env?.DB?.prepare) return { response: misconfigured('db_binding') };
  await ensureHouseholdSchemaOnce(context.env.DB);
  return { auth, db: context.env.DB, env: context.env };
}

export async function onRequestGet(context) {
  try {
    const ready = await prepare(context);
    if (ready.response) return ready.response;
    const membership = context.data.household || await membershipForUser(ready.db, ready.auth.sub);
    return json(200, membership || onboarding(ready.auth, ready.env));
  } catch (error) {
    console.error('[Household] Failed to resolve membership:', error);
    return json(500, { error: 'household_unavailable' });
  }
}

export async function onRequestPost(context) {
  try {
    const ready = await prepare(context);
    if (ready.response) return ready.response;
    if (!isHouseholdInvitee(ready.auth.email, ready.env.HOUSEHOLD_MEMBER_EMAILS)) {
      return json(403, { error: 'household_not_invited' });
    }
    const result = await acceptHouseholdInvite(ready.db, ready.auth, ready.env);
    context.data.household = result.membership;
    return json(result.created ? 201 : 200, result.membership);
  } catch (error) {
    if (error?.code === 'household_not_invited') {
      return json(403, { error: 'household_not_invited' });
    }
    console.error('[Household] Failed to accept invitation:', error);
    return json(500, { error: 'household_unavailable' });
  }
}
