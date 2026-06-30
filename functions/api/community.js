// ════════════════════════════════════════════════════════
// community.js — /api/community: list (GET) + share (POST)
// Auth-gated by functions/api/_middleware.js (context.data.auth).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../_lib/http.js';
import { listCommunity, shareRecipe, ensureOnce, authorFrom } from '../_lib/community.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return misconfigured('db_binding');
  await ensureOnce(env.DB);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || null;
  const limit = url.searchParams.get('limit') || null;
  const res = await listCommunity(env.DB, { cursor, limit });
  return json(res.status, res.body);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return misconfigured('db_binding');
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  await ensureOnce(env.DB);
  const res = await shareRecipe(env.DB, { recipe: body && body.recipe, author });
  return json(res.status, res.body);
}