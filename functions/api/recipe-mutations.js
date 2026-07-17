import { json, misconfigured } from '../_lib/http.js';
import { authorFrom } from '../_lib/community.js';
import { createD1RecipeMutationStore } from '../_lib/recipe-mutations.js';

const RECIPE_OPS = new Set(['recipe.create', 'recipe.update', 'recipe.delete', 'recipe.ingredient.review']);
const MUTATION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;

function hasDangerousKey(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || hasDangerousKey(value[key], seen)) return true;
  }
  seen.delete(value);
  return false;
}

export async function onRequestPost(context) {
  if (!context.env?.DB) return misconfigured('db_binding');
  const householdId = context.data?.household?.household?.id;
  if (!householdId) return json(403, { error: 'household_required' });
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  let body;
  try { body = await context.request.json(); } catch { return json(400, { error: 'bad_json' }); }
  let serialized = '';
  try { serialized = JSON.stringify(body); } catch { return json(400, { error: 'invalid_recipe_mutation' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.mutationId !== 'string' || !MUTATION_ID_RE.test(body.mutationId)
      || typeof body.op !== 'string' || !RECIPE_OPS.has(body.op)
      || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)
      || serialized.length > 50_000 || hasDangerousKey(body.payload)) {
    return json(400, { error: 'invalid_recipe_mutation' });
  }
  const store = context.data?.recipeMutationStore || await createD1RecipeMutationStore(context.env.DB);
  let result;
  try {
    result = await store.mutate({
      mutationId: body.mutationId, op: body.op, payload: body.payload, author, householdId,
    });
  } catch (error) {
    if (['recipe_mutation_too_large', 'invalid_recipe_mutation'].includes(error?.message)) {
      return json(400, { error: error.message });
    }
    throw error;
  }
  return json(result.status, result.status === 200
    ? { recipes: result.recipes, ...(result.authorityMode ? { authorityMode: result.authorityMode } : {}) }
    : { error: result.error || 'recipe_mutation_failed' });
}
