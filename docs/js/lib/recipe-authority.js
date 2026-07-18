const discoverySignatures = new WeakMap();

function normalizationDiscoveryProjection(record) {
  return {
    id: record?.id, raw: record?.raw, name: record?.name,
    reviewStatus: record?.reviewStatus, reviewVersion: record?.reviewVersion,
    amountState: record?.amountState, quantity: record?.quantity,
    quantityMin: record?.quantityMin, quantityState: record?.quantityState,
    unit: record?.unit, measurementFamily: record?.measurementFamily,
    sourceUnit: record?.sourceUnit, countLabel: record?.countLabel,
  };
}

function discoverySignature(recipes) {
  return JSON.stringify(recipes.map((recipe) => ({
    id: String(recipe?._id || recipe?.id || ''),
    name: String(recipe?.name || 'Untitled'),
    image: recipe?.image ?? null,
    ingredients: Array.isArray(recipe?.recipeIngredient) ? recipe.recipeIngredient : [],
    normalizations: (Array.isArray(recipe?.ingredientNormalizations)
      ? recipe.ingredientNormalizations : []).map(normalizationDiscoveryProjection),
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
