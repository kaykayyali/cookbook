// ════════════════════════════════════════════════════════
// api.js — Personal recipes API client (authFetch wrappers)
// ════════════════════════════════════════════════════════
import { authFetch } from './auth.js';
import { toSchema, fromSchema } from './schema.js';

/**
 * Fetch all user's recipes from the server.
 * @param {{ onUnauthorized?: () => void }} opts
 * @returns {Promise<{ok: boolean, recipes?: object[], hasMore?: boolean, seeded?: boolean, error?: string}>}
 */
export async function fetchRecipes({ onUnauthorized } = {}) {
  const res = await authFetch('/recipes', {}, { onUnauthorized });
  if (!res.ok) {
    try { const e = await res.json(); return { ok: false, error: e.error }; }
    catch { return { ok: false, error: 'fetch_failed' }; }
  }
  const data = await res.json();
  // Convert canonical JSON-LD to internal model
  const recipes = (data.recipes || []).map((item) => {
    const internal = fromSchema(item.recipe);
    internal._id = item.id;
    internal.dateCreated = new Date(item.createdAt).toISOString();
    if (item.updatedAt !== item.createdAt) {
      internal.dateModified = new Date(item.updatedAt).toISOString();
    }
    return internal;
  });
  return { ok: true, recipes, hasMore: data.hasMore, seeded: data.seeded };
}

/**
 * Create a new recipe.
 * @param {object} recipe - internal model
 * @param {{ onUnauthorized?: () => void }} opts
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function createRecipe(recipe, { onUnauthorized } = {}) {
  const res = await authFetch('/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: toSchema(recipe) }),
  }, { onUnauthorized });
  if (!res.ok) {
    try { const e = await res.json(); return { ok: false, error: e.error }; }
    catch { return { ok: false, error: 'create_failed' }; }
  }
  const data = await res.json();
  return { ok: true, id: data.id };
}

/**
 * Update an existing recipe.
 * @param {string} id - recipe server id
 * @param {object} recipe - internal model
 * @param {{ onUnauthorized?: () => void }} opts
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function updateRecipe(id, recipe, { onUnauthorized } = {}) {
  const res = await authFetch(`/recipes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: toSchema(recipe) }),
  }, { onUnauthorized });
  if (!res.ok) {
    try { const e = await res.json(); return { ok: false, error: e.error }; }
    catch { return { ok: false, error: 'update_failed' }; }
  }
  return { ok: true };
}

/**
 * Delete a recipe.
 * @param {string} id - recipe server id
 * @param {{ onUnauthorized?: () => void }} opts
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function deleteRecipeById(id, { onUnauthorized } = {}) {
  const res = await authFetch(`/recipes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }, { onUnauthorized });
  if (res.status === 204) return { ok: true };
  if (!res.ok) {
    try { const e = await res.json(); return { ok: false, error: e.error }; }
    catch { return { ok: false, error: 'delete_failed' }; }
  }
  return { ok: true };
}

/**
 * Import multiple recipes (e.g., from JSON-LD export file).
 * @param {object[]} recipes - array of canonical JSON-LD recipes
 * @param {{ onUnauthorized?: () => void }} opts
 * @returns {Promise<{ok: boolean, imported?: number, error?: string}>}
 */
export async function importRecipes(recipes, { onUnauthorized } = {}) {
  let imported = 0;
  for (const recipe of recipes) {
    const res = await authFetch('/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe }),
    }, { onUnauthorized });
    if (res.ok) imported++;
  }
  return { ok: true, imported };
}
