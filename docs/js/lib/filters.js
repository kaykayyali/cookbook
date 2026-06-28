// ════════════════════════════════════════════════════════
// filters.js — recipe search & filtering (no DOM)
// ════════════════════════════════════════════════════════

import { eligibility } from './pantry.js';

/**
 * Does a recipe match a free-text search term?
 * Searches name, cuisine, category, and ingredient lines.
 * @param {object} r
 * @param {string} term already-lowercased, trimmed
 * @returns {boolean}
 */
export function matchesSearch(r, term) {
  if (!term) return true;
  const hay = [r.name, r.recipeCuisine, r.recipeCategory, ...(r.recipeIngredient || [])]
    .join(' ')
    .toLowerCase();
  return hay.includes(term);
}

/**
 * Filter a recipe list by search term, category, and eligibility toggle.
 * @param {object[]} recipes
 * @param {object} opts
 * @param {string} [opts.searchTerm]
 * @param {string} [opts.categoryFilter]
 * @param {boolean} [opts.eligibleOnly]
 * @param {string[]} [opts.pantry]
 * @returns {object[]}
 */
export function filterRecipes(recipes, opts = {}) {
  const {
    searchTerm = '',
    categoryFilter = '',
    eligibleOnly = false,
    pantry = [],
  } = opts;
  const term = searchTerm.toLowerCase().trim();

  return recipes.filter((r) => {
    if (!matchesSearch(r, term)) return false;
    if (categoryFilter && r.recipeCategory !== categoryFilter) return false;
    if (eligibleOnly) {
      const e = eligibility(r, pantry);
      if (e !== 'complete' && e !== 'partial') return false;
    }
    return true;
  });
}
