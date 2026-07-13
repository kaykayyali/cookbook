// ════════════════════════════════════════════════════════
// api.js — Primary cookbook API (community D1 only)
// ════════════════════════════════════════════════════════
import {
  fetchCommunity,
  shareRecipe,
  editCommunityRecipe,
  deleteCommunityRecipe,
  mapCommunityItem,
} from './community.js';

/** Fetch the complete shared cookbook and map D1 rows to the internal model. */
export async function fetchRecipes({ onUnauthorized } = {}) {
  const recipes = [];
  let cursor = null;
  do {
    const res = await fetchCommunity({ cursor, limit: 100, onUnauthorized });
    if (!res.ok) return { ok: false, error: res.error || 'fetch_failed' };
    recipes.push(...res.recipes.map(mapCommunityItem));
    cursor = res.nextCursor;
  } while (cursor);
  return { ok: true, recipes };
}

/** Create a recipe directly in the shared cookbook. */
export async function createRecipe(recipe, { onUnauthorized } = {}) {
  const res = await shareRecipe(recipe, { onUnauthorized });
  return res.ok ? { ok: true, item: res.recipe } : res;
}

/** Update a shared recipe; the server enforces author ownership. */
export async function updateRecipe(id, recipe, { onUnauthorized } = {}) {
  const res = await editCommunityRecipe(id, recipe, { onUnauthorized });
  return res.ok ? { ok: true, item: res.recipe } : res;
}

/** Delete a shared recipe; the server enforces author ownership. */
export function deleteRecipeById(id, { onUnauthorized } = {}) {
  return deleteCommunityRecipe(id, { onUnauthorized });
}

/** Import canonical JSON-LD recipes into the shared cookbook. */
export async function importRecipes(recipes, { onUnauthorized } = {}) {
  let imported = 0;
  for (const recipe of recipes) {
    const res = await shareRecipe(recipe, { onUnauthorized });
    if (res.ok) imported++;
  }
  return { ok: true, imported };
}
