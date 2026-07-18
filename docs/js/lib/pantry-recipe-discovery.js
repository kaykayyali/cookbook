import {
  buildRecipeUsageIndex,
  canonicalIngredientIdentity,
  effectiveIngredientRecords,
  recipeUsageCandidateKey,
  recipeUsageIdentity,
} from './ingredient-corrections.js';

const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const AVAILABILITY_RANK = Object.freeze({ All: 2, Some: 1, Few: 0 });

function imageCandidate(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = imageCandidate(item);
      if (candidate) return candidate;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    return imageCandidate(value.url) || imageCandidate(value.contentUrl);
  }
  return '';
}

/** Keep only bounded credential-free HTTP(S) image URLs. */
export function safeRecipeImageUrl(value) {
  const candidate = imageCandidate(value).trim();
  if (!candidate || candidate.length > 2_048) return '';
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Availability is informational name coverage only. Unknown, qualitative, and
 * count units do not imply quantity sufficiency. Thresholds: All = 100%, Some =
 * at least half, Few = below half (including an empty ingredient list).
 */
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

function recipeSources(recipes) {
  const sources = new Map();
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const effective = effectiveIngredientRecords(recipe);
    const identity = recipeUsageIdentity(recipe, effective);
    const candidateKey = recipeUsageCandidateKey(recipe, effective);
    const imageUrl = safeRecipeImageUrl(recipe?.image);
    const key = `${candidateKey}\u0000${imageUrl ? '0' : '1'}\u0000${imageUrl}`;
    const current = sources.get(identity);
    if (!current || compareText(key, current.key) < 0) sources.set(identity, { key, recipe, effective });
  }
  return sources;
}

/** Build the recipe-only half once per authority snapshot. */
function buildDiscoveryIndex(recipes) {
  const allRecipes = Array.isArray(recipes) ? recipes : [];
  return Object.freeze({
    sources: recipeSources(allRecipes),
    usage: buildRecipeUsageIndex(allRecipes),
  });
}

function discoverWithIndex(index, pantry, ingredientName) {
  const uses = index.usage.find(ingredientName);
  const available = pantryCanonicalNames(pantry);
  return uses.map((use) => {
    const source = index.sources.get(use.recipeIdentity);
    const recipe = source?.recipe || null;
    const effective = source?.effective || [];
    const availability = availabilityFromCanonicalNames(effective.map((ingredient) => ingredient.name), available);
    const stableId = String(recipe?._id || recipe?.id || '');
    return {
      recipeId: stableId || use.recipeId,
      recipeIdentity: use.recipeIdentity,
      recipeName: use.recipeName,
      matchingLine: String(use.ingredient?.raw || ''),
      availability,
      imageUrl: safeRecipeImageUrl(recipe?.image),
      canOpen: Boolean(stableId),
    };
  }).sort((left, right) => AVAILABILITY_RANK[right.availability.label] - AVAILABILITY_RANK[left.availability.label]
    || compareText(left.recipeName.toLocaleLowerCase('en-US'), right.recipeName.toLocaleLowerCase('en-US'))
    || compareText(left.recipeName, right.recipeName)
    || compareText(left.recipeIdentity, right.recipeIdentity));
}

/**
 * Create a bounded one-entry recipe index cache. Pantry coverage is intentionally
 * recomputed on every call, while recipe parsing/indexing is reused until the
 * explicit discovery-authority version changes. Callers without a version fall
 * back to array identity for backwards compatibility.
 */
export function createPantryRecipeDiscovery({ onIndexBuild = () => {} } = {}) {
  let authority = null;
  let authorityVersion;
  let index = null;
  return function discover({ recipes, pantry, ingredientName, recipeAuthorityVersion } = {}) {
    const allRecipes = Array.isArray(recipes) ? recipes : [];
    const hasVersion = recipeAuthorityVersion !== undefined && recipeAuthorityVersion !== null;
    const changed = hasVersion
      ? authorityVersion !== recipeAuthorityVersion
      : authority !== allRecipes;
    if (!index || changed) {
      index = buildDiscoveryIndex(allRecipes);
      onIndexBuild(allRecipes);
    }
    authority = allRecipes;
    authorityVersion = recipeAuthorityVersion;
    return discoverWithIndex(index, pantry, ingredientName);
  };
}

/** Discover one deterministic, immutable result per recipe. */
export const discoverPantryRecipes = createPantryRecipeDiscovery();
