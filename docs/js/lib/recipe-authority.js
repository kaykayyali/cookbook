import {
  adoptRecipeDiscoveryRecord,
  certifyRecipeDiscoveryAuthority,
  equivalentRecipeDiscoveryAuthority,
  prepareRecipeDiscoveryIndex,
  recipeDiscoveryAuthority,
  replaceRecipeDiscoveryRecord,
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
  const ok = snapshot.ok && projection.ok;
  const signatureChanged = previous === undefined
    || !previous.ok || !ok || previous.signature !== projection.signature;
  let equivalence = false;
  if (snapshot.ok && previousRecord && signatureChanged) {
    try { equivalence = equivalentRecipeDiscoveryAuthority(previousRecord, projection); }
    catch { equivalence = false; }
  }
  const certificationPending = equivalence === null && Boolean(projection.source);

  state.recipes = next;
  discoveryRecords.set(state, projection);

  if (certificationPending) {
    // Keep serving the last certified index while an isolated candidate is
    // prepared cooperatively. The detached candidate retains the new source;
    // provisional adoption therefore cannot erase evidence needed to certify it.
    const certification = certifyRecipeDiscoveryAuthority(previousRecord, projection);
    adoptRecipeDiscoveryRecord(projection, previousRecord);
    discoverySignatures.set(state, previous);
    projection.certificationPromise = certification.then(({ equivalent, record }) => {
      if (discoveryRecords.get(state) !== projection) return { stale: true, equivalent };
      if (equivalent) {
        adoptRecipeDiscoveryRecord(projection, previousRecord);
        discoverySignatures.set(state, previous);
      } else {
        replaceRecipeDiscoveryRecord(projection, record);
        state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
        discoverySignatures.set(state, {
          ok: snapshot.ok && record.ok,
          signature: record.signature,
        });
      }
      return { stale: false, equivalent };
    }).catch(() => {
      if (discoveryRecords.get(state) === projection) {
        projection.ok = false;
        projection.signature = '';
        projection.snapshot = [];
        projection.index = null;
        projection.source = null;
        projection.promise = null;
        projection.authorityPromise = null;
        state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
        discoverySignatures.set(state, { ok: false, signature: '' });
      }
      return { stale: discoveryRecords.get(state) !== projection, equivalent: false };
    });
    return next;
  }

  const changed = previous === undefined || (signatureChanged && equivalence !== true);
  if (changed) state.recipeAuthorityVersion = (Number(state.recipeAuthorityVersion) || 0) + 1;
  if (equivalence === true) adoptRecipeDiscoveryRecord(projection, previousRecord);
  else if (!changed && previousRecord) adoptRecipeDiscoveryRecord(projection, previousRecord);
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
