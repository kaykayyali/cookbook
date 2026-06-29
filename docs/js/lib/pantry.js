// ════════════════════════════════════════════════════════
// pantry.js — pantry matching & eligibility (no DOM)
//
// Pantry is always string[] of lowercase ingredient names.
// ════════════════════════════════════════════════════════

const LEADING_QTY = /^[\d¼½¾⅓⅔⅛⅜⅝⅞\s.,/-]+/;
const LEADING_UNIT =
  /^(tablespoons?|tbsps?|tbs|teaspoons?|tsps?|cups?|oz|g|kg|ml|l|lbs?|pounds?|pinch|bunch|cloves?|medium|large|small|cans?)\s+/i;

/**
 * True if the given recipe-ingredient string is satisfied by any pantry entry.
 * Matching is substring-based: pantry "olive oil" matches "2 tbsp olive oil".
 * @param {string} ing recipe ingredient line
 * @param {string[]} pantry lowercase pantry names
 * @returns {boolean}
 */
export function haveIngredient(ing, pantry) {
  if (typeof ing !== 'string') return false;
  const low = ing.toLowerCase();
  return pantry.some((p) => low.includes(p));
}

/**
 * Eligibility of a recipe given the pantry.
 * @param {object} recipe internal recipe
 * @param {string[]} pantry
 * @returns {'complete'|'partial'|'none'}
 */
export function eligibility(recipe, pantry) {
  const ings = recipe.recipeIngredient || [];
  if (!ings.length) return 'none';
  const have = ings.filter((i) => haveIngredient(i, pantry)).length;
  if (have === ings.length) return 'complete';
  return have ? 'partial' : 'none';
}

/**
 * Count how many of a recipe's ingredients are in the pantry.
 * @param {object} recipe
 * @param {string[]} pantry
 * @returns {{have:number,total:number}}
 */
export function ingredientCounts(recipe, pantry) {
  const ings = recipe.recipeIngredient || [];
  const have = ings.filter((i) => haveIngredient(i, pantry)).length;
  return { have, total: ings.length };
}

/**
 * Parse a raw ingredient line into its leading quantity/unit snippet and the
 * remaining base name. Reuses the same LEADING_QTY / LEADING_UNIT regexes as
 * the previous baseName, but captures the stripped run instead of discarding
 * it. "2 tablespoons olive oil" → { qtyText: "2 tablespoons", name: "olive oil" }.
 * "6 large eggs" → { qtyText: "6 large", name: "eggs" } (large is a unit here).
 * @param {string} raw
 * @returns {{qtyText:string, name:string}} name is lowercase; non-strings yield empty strings
 */
export function parseIngredient(raw) {
  if (typeof raw !== 'string') return { qtyText: '', name: '' };
  let s = raw;
  let qtyText = '';
  const m1 = s.match(LEADING_QTY);
  if (m1) { qtyText += m1[0]; s = s.slice(m1[0].length); }
  const m2 = s.match(LEADING_UNIT);
  if (m2) { qtyText += m2[0]; s = s.slice(m2[0].length); }
  return { qtyText: qtyText.trim(), name: s.trim().toLowerCase() };
}

/**
 * Reduce a raw ingredient line to its base noun by stripping leading
 * quantity and unit. "2 tablespoons olive oil" → "olive oil".
 * Thin wrapper over parseIngredient so cart and pantry share one parser.
 * @param {string} raw
 * @returns {string} lowercase base name
 */
export function baseName(raw) {
  return parseIngredient(raw).name;
}

/**
 * Build a sorted, deduplicated list of ingredient suggestions drawn from all
 * recipes — both the base noun and the full normalised line. Used for the
 * pantry autocomplete datalist.
 * @param {object[]} recipes
 * @returns {string[]}
 */
export function allRecipeIngredients(recipes) {
  const seen = new Set();
  recipes.forEach((r) => {
    (r.recipeIngredient || []).forEach((raw) => {
      const base = baseName(raw);
      if (base) seen.add(base);
      const full = raw.trim().toLowerCase();
      if (full) seen.add(full);
    });
  });
  return [...seen].sort();
}

/**
 * Pure add: returns a new pantry array with `name` added (if not present).
 * @param {string[]} pantry
 * @param {string} name
 * @returns {{pantry:string[], added:boolean, name:string}}
 */
export function addToPantry(pantry, name) {
  const key = name.trim().toLowerCase();
  if (!key) return { pantry, added: false, name: key };
  if (pantry.includes(key)) return { pantry, added: false, name: key };
  return { pantry: [...pantry, key], added: true, name: key };
}

/**
 * Pure remove: returns a new pantry array without `name`.
 * @param {string[]} pantry
 * @param {string} name
 * @returns {string[]}
 */
export function removeFromPantry(pantry, name) {
  const key = name.toLowerCase();
  return pantry.filter((p) => p !== key);
}

/**
 * Pure toggle: add if absent, remove if present.
 * @param {string[]} pantry
 * @param {string} name
 * @returns {{pantry:string[], added:boolean, name:string}}
 */
export function togglePantry(pantry, name) {
  const key = name.toLowerCase();
  if (pantry.includes(key)) {
    return { pantry: removeFromPantry(pantry, key), added: false, name: key };
  }
  return { pantry: [...pantry, key], added: true, name: key };
}

/**
 * Normalise possibly-legacy persisted pantry data into string[].
 * Older versions stored {name, quantity} objects.
 * @param {Array} raw
 * @returns {string[]}
 */
export function normalizePantry(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => (p && typeof p === 'object' ? p.name || '' : String(p)))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
