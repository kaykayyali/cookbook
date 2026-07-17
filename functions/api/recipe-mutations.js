import { json, misconfigured } from '../_lib/http.js';
import { authorFrom } from '../_lib/community.js';
import { createD1RecipeMutationStore } from '../_lib/recipe-mutations.js';

const RECIPE_OPS = new Set(['recipe.create', 'recipe.update', 'recipe.delete', 'recipe.ingredient.review']);
const MUTATION_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_STRUCTURE_DEPTH = 64;
const MAX_STRUCTURE_NODES = 10_000;
const MAX_BODY_BYTES = 50_000;

function hasValidStructure(root) {
  const stack = [{ value: root, depth: 0 }];
  const seen = new WeakSet();
  const encoder = new TextEncoder();
  let nodes = 0;
  let bytes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_STRUCTURE_NODES || depth > MAX_STRUCTURE_DEPTH) return false;
    if (value === null) { bytes += 4; continue; }
    const type = typeof value;
    if (type === 'string') bytes += encoder.encode(value).length + 2;
    else if (type === 'number') bytes += String(value).length;
    else if (type === 'boolean') bytes += 5;
    else if (type === 'object') {
      if (seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) {
        bytes += value.length + 2;
        for (const item of value) stack.push({ value: item, depth: depth + 1 });
      } else {
        bytes += 2;
        for (const key of Object.keys(value)) {
          if (DANGEROUS_KEYS.has(key)) return false;
          bytes += encoder.encode(key).length + 3;
          stack.push({ value: value[key], depth: depth + 1 });
        }
      }
    } else return false;
    if (bytes > MAX_BODY_BYTES) return false;
  }
  return true;
}

export async function onRequestPost(context) {
  if (!context.env?.DB) return misconfigured('db_binding');
  const householdId = context.data?.household?.household?.id;
  if (!householdId) return json(403, { error: 'household_required' });
  const author = authorFrom(context);
  if (!author) return json(401, { error: 'invalid_token' });
  let body;
  try { body = await context.request.json(); } catch { return json(400, { error: 'bad_json' }); }
  if (!hasValidStructure(body)) return json(400, { error: 'invalid_recipe_mutation' });
  let serialized = '';
  try { serialized = JSON.stringify(body); } catch { return json(400, { error: 'invalid_recipe_mutation' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.mutationId !== 'string' || !MUTATION_ID_RE.test(body.mutationId)
      || typeof body.op !== 'string' || !RECIPE_OPS.has(body.op)
      || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)
      || serialized.length > MAX_BODY_BYTES) {
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
