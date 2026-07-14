// ════════════════════════════════════════════════════════
// community/[id].js — /api/community/:id: get (GET) + edit (PUT) + delete (DELETE)
// Auth-gated by functions/api/_middleware.js (context.data.auth).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../../_lib/http.js';
import { getCommunity, editRecipe, deleteCommunity, ensureOnce, authorFrom } from '../../_lib/community.js';

function householdIdFrom(context) {
  const id = context?.data?.household?.household?.id;
  return typeof id === 'string' && id ? id : null;
}

export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  const householdId = householdIdFrom(context);
  if (!householdId) return json(403, { error: 'household_required' });
  await ensureOnce(env.DB, householdId);
  const res = await getCommunity(env.DB, { id: params.id, householdId });
  return json(res.status, res.body);
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  const householdId = householdIdFrom(context);
  if (!householdId) return json(403, { error: 'household_required' });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  await ensureOnce(env.DB, householdId);
  const res = await editRecipe(env.DB, {
    id: params.id,
    recipe: body && body.recipe,
    author,
    householdId,
  });
  return json(res.status, res.body);
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  const householdId = householdIdFrom(context);
  if (!householdId) return json(403, { error: 'household_required' });
  await ensureOnce(env.DB, householdId);
  const res = await deleteCommunity(env.DB, { id: params.id, author, householdId });
  if (res.status === 204) return new Response(null, { status: 204 });
  return json(res.status, res.body);
}