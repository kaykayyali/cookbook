import { ingredientDiscoveryProjection } from './ingredient-corrections.js';

const discoverySignatures = new WeakMap();

function discoverySignature(recipes) {
  return JSON.stringify(recipes.map((recipe) => ({
    id: String(recipe?._id || recipe?.id || ''),
    name: String(recipe?.name || 'Untitled'),
    image: recipe?.image ?? null,
    ingredients: ingredientDiscoveryProjection(recipe),
  })));
}

/**
 * Publish a new immutable recipe authority snapshot and advance its cheap cache
 * generation only when fields consumed by Pantry discovery changed. Full
 * authority still publishes for metadata-only acknowledgements; ordinary
 * rerenders must not publish.
 */
export function publishRecipeAuthority(state, recipes) {
  const next = Array.isArray(recipes) ? [...recipes] : [];
  const signature = discoverySignature(next);
  const previous = discoverySignatures.get(state);
  state.recipes = next;
  if (previous === undefined || previous !== signature) {
    state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
  }
  discoverySignatures.set(state, signature);
  return next;
}
