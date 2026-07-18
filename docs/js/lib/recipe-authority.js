import {
  prepareRecipeDiscoveryIndex,
  recipeDiscoveryAuthority,
} from './recipe-discovery-projection.js';

const discoverySignatures = new WeakMap();

function assertState(state) {
  if ((typeof state !== 'object' && typeof state !== 'function') || state === null) {
    throw new TypeError('Recipe authority state must be a non-null object.');
  }
}

/**
 * Publish a new immutable recipe authority snapshot. The signature is derived
 * from the same bounded effective projection consumed by Pantry discovery.
 * Invalid/oversized projections always advance the generation so stale results
 * cannot survive, while the complete shallow authority array still publishes.
 */
export function publishRecipeAuthority(state, recipes) {
  assertState(state);
  const next = Array.isArray(recipes) ? [...recipes] : [];
  const projection = recipeDiscoveryAuthority(next);
  const previous = discoverySignatures.get(state);
  state.recipes = next;
  if (previous === undefined || !previous.ok || !projection.ok || previous.signature !== projection.signature) {
    state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
  }
  discoverySignatures.set(state, { ok: projection.ok, signature: projection.signature });
  // Warm the compact index outside the publication stack. The yielded builder
  // keeps large remote refreshes from monopolizing the browser event loop.
  void prepareRecipeDiscoveryIndex(projection).catch(() => {});
  return next;
}
