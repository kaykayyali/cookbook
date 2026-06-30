// ════════════════════════════════════════════════════════
// community/[id].js — /api/community/:id: get (GET) + edit (PUT) + delete (DELETE)
// Auth-gated by functions/api/_middleware.js (context.data.auth).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../../_lib/http.js';
import { getCommunity, editRecipe, deleteCommunity, ensureOnce, authorFrom } from '../../_lib/community.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  await ensureOnce(env.DB);
  const res = await getCommunity(env.DB, params.id);
  return json(res.status, res.body);
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  await ensureOnce(env.DB);
  const res = await editRecipe(env.DB, { id: params.id, recipe: body && body.recipe, author });
  return json(res.status, res.body);
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  await ensureOnce(env.DB);
  const res = await deleteCommunity(env.DB, { id: params.id, author });
  if (res.status === 204) return new Response(null, { status: 204 });
  return json(res.status, res.body);
}