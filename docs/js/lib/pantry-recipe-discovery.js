import { canonicalIngredientIdentity } from './ingredient-corrections.js';
import {
  buildRecipeDiscoveryIndexSync,
  prepareRecipeDiscoveryIndex,
  prepareRecipeDiscoveryPage,
  queryRecipeDiscoveryIndex,
  recipeDiscoveryAuthority,
  safeRecipeImageUrlValue,
} from './recipe-discovery-projection.js';

function pantryCanonicalNames(pantry) {
  return new Set((Array.isArray(pantry) ? pantry : [])
    .map((item) => canonicalIngredientIdentity(item?.name || item)).filter(Boolean));
}

function availabilityFromCanonicalNames(ingredientNames, available) {
  const required = new Set((Array.isArray(ingredientNames) ? ingredientNames : [])
    .map(canonicalIngredientIdentity).filter(Boolean));
  let have = 0;
  for (const name of required) if (available.has(name)) have += 1;
  const total = required.size;
  const ratio = total ? have / total : 0;
  const label = total && have === total ? 'All' : ratio >= 0.5 ? 'Some' : 'Few';
  return { label, have, total, ratio };
}

export function pantryAvailability(ingredientNames, pantry) {
  return availabilityFromCanonicalNames(ingredientNames, pantryCanonicalNames(pantry));
}

/** Keep only bounded credential-free HTTP(S) image URLs without invoking accessors. */
export function safeRecipeImageUrl(value) {
  return safeRecipeImageUrlValue(value);
}

/**
 * One-entry discovery facade. The callable function preserves the historical
 * full synchronous API. `page()` is the responsive UI path: it never builds on
 * the caller stack, returns a bounded page, and exposes `ready` while a yielded
 * authority build is in flight. `prepare()` is useful for publication/runtime
 * prewarming and deterministic tests.
 */
export function createPantryRecipeDiscovery({ onIndexBuild = () => {} } = {}) {
  let authority = null;
  let authorityVersion;
  let record = null;
  let generation = 0;
  let notifiedRecord = null;
  let pageKey = '';
  let pageResult = null;
  let pagePromise = null;

  function select({ recipes, recipeAuthorityVersion } = {}) {
    const allRecipes = Array.isArray(recipes) ? recipes : [];
    const hasVersion = recipeAuthorityVersion !== undefined && recipeAuthorityVersion !== null;
    const changed = !record || (hasVersion
      ? authorityVersion !== recipeAuthorityVersion
      : authority !== allRecipes);
    if (changed) {
      authority = allRecipes;
      authorityVersion = recipeAuthorityVersion;
      record = recipeDiscoveryAuthority(allRecipes);
      generation += 1;
      pageKey = '';
      pageResult = null;
      pagePromise = null;
    }
    return { allRecipes, record, generation };
  }

  function notifyBuilt(selected) {
    if (selected.record.index && notifiedRecord !== selected.record) {
      notifiedRecord = selected.record;
      onIndexBuild(selected.allRecipes);
    }
  }

  async function prepare(options = {}) {
    const selected = select(options);
    await prepareRecipeDiscoveryIndex(selected.record);
    if (record === selected.record && generation === selected.generation) notifyBuilt(selected);
    return selected.record.index;
  }

  function page(options = {}) {
    const selected = select(options);
    if (!selected.record.index) {
      const ready = prepare(options);
      return { results: [], total: 0, hasMore: false, pending: true, ready };
    }
    notifyBuilt(selected);
    const pantryKey = [...pantryCanonicalNames(options.pantry)].sort().join('\u0000');
    const nextKey = `${generation}\u0001${canonicalIngredientIdentity(options.ingredientName)}\u0001${pantryKey}\u0001${options.offset || 0}\u0001${options.limit ?? 'all'}`;
    if (nextKey !== pageKey) {
      pageKey = nextKey;
      pageResult = null;
      pagePromise = null;
    }
    if (!pageResult) {
      if (!pagePromise) {
        const expectedKey = pageKey;
        pagePromise = prepareRecipeDiscoveryPage(selected.record.index, options.pantry, options.ingredientName, {
          offset: options.offset,
          limit: options.limit,
        }).then((result) => {
          if (pageKey === expectedKey) pageResult = result;
          return result;
        }).finally(() => { if (pageKey === expectedKey) pagePromise = null; });
      }
      return { results: [], total: 0, hasMore: false, pending: true, ready: pagePromise };
    }
    return pageResult;
  }

  function discover(options = {}) {
    const selected = select(options);
    const index = buildRecipeDiscoveryIndexSync(selected.record);
    notifyBuilt(selected);
    return queryRecipeDiscoveryIndex(index, options.pantry, options.ingredientName).results;
  }

  discover.page = page;
  discover.prepare = prepare;
  return discover;
}

export const discoverPantryRecipes = createPantryRecipeDiscovery();
