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
import { authFetch } from './auth.js';
import { isNormalizedIngredient } from './cart.js';

/** Ask the authenticated Workers AI route to interpret ingredient lines. */
export async function normalizeRecipeIngredients(lines, recipe = {}, { onUnauthorized } = {}) {
  const raw = Array.isArray(lines) ? lines : [];
  const res = await authFetch('/normalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingredients: raw,
      recipeName: String(recipe?.name || ''),
      recipeYield: Array.isArray(recipe?.recipeYield) ? recipe.recipeYield.join(', ') : String(recipe?.recipeYield || ''),
    }),
  }, { onUnauthorized });
  if (!res.ok) throw new Error('normalization_unavailable');
  const data = await res.json();
  if (!Array.isArray(data.ingredients) || data.ingredients.length !== raw.length
      || data.ingredients.some((item, index) => !isNormalizedIngredient(item)
        || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1
        || item.raw !== raw[index])) {
    throw new Error('invalid_normalization');
  }
  return data.ingredients;
}

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
