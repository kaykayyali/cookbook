import {
  adoptRecipeDiscoveryRecord,
  equivalentRecipeDiscoveryAuthority,
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
  let isArray;
  try { isArray = Array.isArray(recipes); } catch { return { next: [], ok: false }; }
  if (!isArray) return { next: [], ok: true };
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
  let ok = snapshot.ok && projection.ok;
  const signatureChanged = previous === undefined
    || !previous.ok || !ok || previous.signature !== projection.signature;
  let equivalent = false;
  if (snapshot.ok && previousRecord && signatureChanged) {
    try {
      equivalent = equivalentRecipeDiscoveryAuthority(previousRecord, projection);
      if (equivalent) adoptRecipeDiscoveryRecord(projection, previousRecord);
    } catch { equivalent = false; }
    ok = snapshot.ok && projection.ok;
  }
  const changed = previous === undefined || (signatureChanged && !equivalent);
  state.recipes = next;
  if (changed) state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
  if (!changed && !equivalent && previousRecord) {
    try { adoptRecipeDiscoveryRecord(projection, previousRecord); } catch {}
  }
  discoveryRecords.set(state, projection);
  discoverySignatures.set(state, changed
    ? { ok, signature: projection.signature }
    : previous || { ok, signature: projection.signature });

  // Warm (or follow an equivalent in-flight warm) outside the publication stack.
  // Only the current publication may certify its eventual asynchronous signature.
  void prepareRecipeDiscoveryIndex(projection).then(() => {
    if (discoveryRecords.get(state) === projection) {
      discoverySignatures.set(state, {
        ok: snapshot.ok && projection.ok,
        signature: projection.signature,
      });
    }
  }).catch(() => {
    if (discoveryRecords.get(state) === projection) {
      discoverySignatures.set(state, { ok: false, signature: '' });
    }
  });
  return next;
}
