import {
  prepareRecipeDiscoveryIndex,
  recipeDiscoveryAuthority,
} from './recipe-discovery-projection.js';

const discoverySignatures = new WeakMap();
const MAX_AUTHORITY_LENGTH = 10_000;

function assertState(state) {
  if ((typeof state !== 'object' && typeof state !== 'function') || state === null) {
    throw new TypeError('Recipe authority state must be a non-null object.');
  }
}

function snapshotAuthority(recipes) {
  if (!Array.isArray(recipes)) return { next: [], ok: true };
  let length = 0;
  let ok = true;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(recipes, 'length');
    length = Number.isSafeInteger(descriptor?.value) && descriptor.value >= 0
      ? descriptor.value : 0;
  } catch { ok = false; }
  if (length > MAX_AUTHORITY_LENGTH) { length = MAX_AUTHORITY_LENGTH; ok = false; }
  const next = new Array(length);
  for (let index = 0; index < length; index += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(recipes, String(index));
      if (!descriptor) continue;
      if (Object.hasOwn(descriptor, 'value')) next[index] = descriptor.value;
      else ok = false;
    } catch { ok = false; }
  }
  return { next, ok };
}

/**
 * Publish a new immutable recipe authority snapshot. The signature is derived
 * from the same bounded effective projection consumed by Pantry discovery.
 * Invalid/oversized projections always advance the generation so stale results
 * cannot survive, while the complete shallow authority array still publishes.
 */
export function publishRecipeAuthority(state, recipes) {
  assertState(state);
  const snapshot = snapshotAuthority(recipes);
  const { next } = snapshot;
  const projection = recipeDiscoveryAuthority(next);
  const previous = discoverySignatures.get(state);
  const ok = snapshot.ok && projection.ok;
  state.recipes = next;
  if (previous === undefined || !previous.ok || !ok || previous.signature !== projection.signature) {
    state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
  }
  discoverySignatures.set(state, { ok, signature: projection.signature });
  // Warm the compact index outside the publication stack. The yielded builder
  // keeps large remote refreshes from monopolizing the browser event loop.
  void prepareRecipeDiscoveryIndex(projection).catch(() => {});
  return next;
}
