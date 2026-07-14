import { json, misconfigured } from '../_lib/http.js';
import { authorFrom } from '../_lib/community.js';
import { createD1RecipeMutationStore } from '../_lib/recipe-mutations.js';

export async function onRequestPost(context) {
  if (!context.env?.DB) return misconfigured('db_binding');
  const householdId = context.data?.household?.household?.id;
  if (!householdId) return json(403, { error: 'household_required' });
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  let body;
  try { body = await context.request.json(); } catch { return json(400, { error: 'bad_json' }); }
  if (!body?.mutationId || !body?.op || typeof body.payload !== 'object') {
    return json(400, { error: 'invalid_recipe_mutation' });
  }
  const store = context.data?.recipeMutationStore || await createD1RecipeMutationStore(context.env.DB);
  const result = await store.mutate({
    mutationId: String(body.mutationId).slice(0, 200), op: body.op, payload: body.payload, author, householdId,
  });
  return json(result.status, result.status === 200
    ? { recipes: result.recipes }
    : { error: result.error || 'recipe_mutation_failed' });
}
