import {
  adoptRecipeDiscoveryRecord,
  equivalentWarmedRawRecipeAuthority,
  prepareRecipeDiscoveryIndex,
  recipeDiscoveryAuthority,
} from './recipe-discovery-projection.js';

const discoverySignatures = new WeakMap();
const discoveryRecords = new WeakMap();

function assertState(state) {
  if ((typeof state !== 'object' && typeof state !== 'function') || state === null) {
    throw new TypeError('Recipe authority state must be a non-null object.');
  }
}

function snapshotAuthority(recipes) {
  let array = false;
  try { array = Array.isArray(recipes); } catch { return { next: [], ok: false }; }
  if (!array) return { next: [], ok: true };
  let length = 0;
  let ok = true;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(recipes, 'length');
    length = Number.isSafeInteger(descriptor?.value) && descriptor.value >= 0
      ? descriptor.value : 0;
  } catch { ok = false; }
  let next;
  try { next = new Array(length); } catch { return { next: [], ok: false }; }
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
  const previousRecord = discoveryRecords.get(state);
  const equivalentLarge = snapshot.ok && !projection.ok
    && equivalentWarmedRawRecipeAuthority(previousRecord, next)
    && adoptRecipeDiscoveryRecord(projection, previousRecord);
  const ok = snapshot.ok && projection.ok;
  const changed = previous === undefined || (!equivalentLarge
    && (!previous.ok || !ok || previous.signature !== projection.signature));
  state.recipes = next;
  if (changed) {
    state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
    discoveryRecords.set(state, projection);
    void prepareRecipeDiscoveryIndex(projection).catch(() => {});
  } else {
    if (!equivalentLarge && previousRecord?.index) adoptRecipeDiscoveryRecord(projection, previousRecord);
    discoveryRecords.set(state, projection.index ? projection : previousRecord || projection);
  }
  discoverySignatures.set(state, changed
    ? { ok, signature: projection.signature }
    : previous || { ok: projection.ok, signature: projection.signature });
  return next;
}
