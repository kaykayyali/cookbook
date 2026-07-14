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

/** Ask Workers AI to review one complete recipe set in a single interpretation call. */
export async function normalizeRecipeIngredients(recipes, { onUnauthorized } = {}) {
  const input = Array.isArray(recipes) ? recipes : [];
  const totalLines = input.reduce((sum, recipe) => sum + (Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0), 0);
  if (!input.length || totalLines > 100 || JSON.stringify(input).length > 30_000) throw new Error('normalization_input_too_large');
  const res = await authFetch('/normalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: input }),
  }, { onUnauthorized });
  if (!res.ok) throw new Error('normalization_unavailable');
  const data = await res.json();
  if (data.version !== 2 || !Array.isArray(data.recipes) || data.recipes.length !== input.length) throw new Error('invalid_normalization');
  data.recipes.forEach((result, recipeIndex) => {
    const source = input[recipeIndex];
    if (result.recipeId !== source.recipeId || !Array.isArray(result.ingredients)
        || result.ingredients.length !== source.ingredients.length
        || result.ingredients.some((item, ingredientIndex) => !isNormalizedIngredient(item)
          || typeof item.displayName !== 'string' || typeof item.countLabel !== 'string' || typeof item.category !== 'string'
          || !Number.isFinite(item.confidence) || item.raw !== source.ingredients[ingredientIndex])) {
      throw new Error('invalid_normalization');
    }
  });
  return data.recipes;
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
