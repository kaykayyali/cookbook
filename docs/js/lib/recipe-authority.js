/**
 * Publish a new immutable recipe authority snapshot and advance its cheap cache
 * generation. Call once per accepted authority change; ordinary rerenders must
 * not publish.
 */
export function publishRecipeAuthority(state, recipes) {
  const next = Array.isArray(recipes) ? [...recipes] : [];
  state.recipes = next;
  state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
  return next;
}
