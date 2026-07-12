// ════════════════════════════════════════════════════════
// recipes.js — /api/recipes: list (GET) + create (POST)
// Auth-gated by functions/api/_middleware.js (context.data.auth).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../_lib/http.js';
import { listRecipes, createRecipe, ensureOnce, authorFrom, countRecipes, seedRecipes } from '../_lib/recipes.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return misconfigured('db_binding');
  await ensureOnce(env.DB);
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });

  // Auto-seed on first fetch for new users
  const count = await countRecipes(env.DB, author.sub);
  if (count === 0) {
    const { SEED_RECIPES } = await import('../_lib/seed-data.js');
    await seedRecipes(env.DB, author.sub, SEED_RECIPES);
    const results = await listRecipes(env.DB, author.sub);
    return json(results.status, { ...results.body, seeded: true });
  }

  const url = new URL(request.url);
  const limit = url.searchParams.get('limit') || null;
  const res = await listRecipes(env.DB, author.sub, { limit });
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
  const res = await createRecipe(env.DB, { recipe: body && body.recipe, author });
  return json(res.status, res.body);
}
