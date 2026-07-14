import { applyWorkspace } from './store.js';

export async function hydrateOfflineState({ repo, authSub, state }) {
  if (!repo || !authSub) return { cached: false, householdId: null };
  const membership = await repo.getMembership(authSub);
  const householdId = membership?.household?.id;
  if (!householdId) return { cached: false, householdId: null };
  const [recipes, workspace] = await Promise.all([
    repo.getRecipes(authSub, householdId),
    repo.getWorkspace(authSub, householdId),
  ]);
  if (!Array.isArray(recipes) || !workspace) return { cached: false, householdId };
  state.household = membership;
  state.householdEligible = true;
  state.recipes = recipes;
  state.recipesLoaded = true;
  applyWorkspace(workspace, state);
  state.offlineCache = true;
  return { cached: true, householdId };
}
