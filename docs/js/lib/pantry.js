// ════════════════════════════════════════════════════════
// pantry.js — pantry matching & eligibility (no DOM)
//
// Pantry entries use the same canonical quantity/unit contract as Shopping.
// ════════════════════════════════════════════════════════

import {
  canonicalName,
  normalizeIngredient,
  formatCanonicalAmount,
  COUNT_LABELS,
  INGREDIENT_CATEGORIES,
} from './cart.js';

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
  return (Array.isArray(pantry) ? pantry : []).some((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.name;
    return typeof name === 'string' && low.includes(name.toLowerCase());
  });
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

function plainDisplayName(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 80 && !/[<>\x00-\x1f\x7f]/.test(text) ? text : fallback;
}

function legacyIngredient(entry) {
  if (typeof entry === 'string') return normalizeIngredient(entry.trim());
  const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
  if (!name) return null;
  if (typeof entry.quantity === 'string') return normalizeIngredient(`${entry.quantity} ${name}`);
  if (!['count', 'ounce', 'qualitative'].includes(entry.unit)) {
    const unit = typeof entry.unit === 'string' ? entry.unit.trim() : '';
    if (unit && Number.isFinite(Number(entry.quantity))) {
      return normalizeIngredient(`${entry.quantity} ${unit} ${name}`);
    }
    return normalizeIngredient(name);
  }
  return entry;
}

/** Normalize a Pantry value into Shopping's canonical quantity/unit shape. */
export function normalizePantryEntry(value) {
  if (typeof value === 'string' && !value.trim()) return null;
  const source = legacyIngredient(value);
  if (!source || !String(source.name || '').trim()) return null;
  const fallback = normalizeIngredient(String(source.name));
  const unit = ['count', 'ounce', 'qualitative'].includes(source.unit) ? source.unit : fallback.unit;
  const quantity = unit === 'qualitative' ? null : Number(source.quantity);
  if (unit !== 'qualitative' && (!Number.isFinite(quantity) || quantity < 0)) return null;
  const name = canonicalName(source.name);
  if (!name || name === 'uncertain ingredient') return null;
  return {
    name,
    displayName: plainDisplayName(source.displayName, fallback.displayName),
    quantity,
    unit,
    kind: unit === 'count' ? 'indivisible' : unit === 'ounce' ? 'divisible' : 'qualitative',
    countLabel: COUNT_LABELS.includes(source.countLabel) ? source.countLabel : fallback.countLabel,
    category: INGREDIENT_CATEGORIES.includes(source.category) ? source.category : fallback.category,
  };
}

const pantryKey = (item) => `${item.name}\u0000${item.unit}`;

/** Pure add/accumulate for one normalized Pantry entry. */
export function addToPantry(pantry, value) {
  const item = normalizePantryEntry(value);
  const current = normalizePantry(pantry);
  if (!item) return { pantry: current, added: false, name: '', item: null };
  const sameName = current.findIndex((entry) => entry.name === item.name);
  const exact = current.findIndex((entry) => pantryKey(entry) === pantryKey(item));

  if (item.unit === 'qualitative' && sameName >= 0) {
    return { pantry: current, added: false, name: item.name, item: current[sameName] };
  }
  if (item.unit !== 'qualitative' && sameName >= 0 && current[sameName].unit === 'qualitative') {
    const next = current.map((entry, index) => index === sameName ? item : entry);
    return { pantry: next, added: true, name: item.name, item };
  }
  if (exact >= 0) {
    if (item.unit === 'qualitative') return { pantry: current, added: false, name: item.name, item: current[exact] };
    const merged = { ...current[exact], ...item, quantity: current[exact].quantity + item.quantity };
    const next = current.map((entry, index) => index === exact ? merged : entry);
    return { pantry: next, added: true, name: item.name, item: merged };
  }
  return { pantry: [...current, item], added: true, name: item.name, item };
}

/** Remove all entries for a name, or one compatible name/unit entry for an object. */
export function removeFromPantry(pantry, value) {
  const current = normalizePantry(pantry);
  const isObject = value && typeof value === 'object';
  const item = normalizePantryEntry(value);
  const name = item?.name || canonicalName(value);
  return current.filter((entry) => entry.name !== name || (isObject && item && entry.unit !== item.unit));
}

/** Pure toggle: add if absent, remove if present. */
export function togglePantry(pantry, value) {
  const current = normalizePantry(pantry);
  const item = normalizePantryEntry(value);
  if (!item) return { pantry: current, added: false, name: '' };
  const present = current.some((entry) => entry.name === item.name
    && (typeof value === 'string' || entry.unit === item.unit));
  if (present) return { pantry: removeFromPantry(current, value), added: false, name: item.name, item };
  return addToPantry(current, item);
}

/** Migrate legacy strings/objects and merge compatible entries. */
export function normalizePantry(raw) {
  if (!Array.isArray(raw)) return [];
  const output = [];
  for (const value of raw) {
    const item = normalizePantryEntry(value);
    if (!item) continue;
    const exact = output.findIndex((entry) => pantryKey(entry) === pantryKey(item));
    const qualitative = output.findIndex((entry) => entry.name === item.name && entry.unit === 'qualitative');
    if (exact >= 0 && item.unit !== 'qualitative') {
      output[exact] = { ...output[exact], ...item, quantity: output[exact].quantity + item.quantity };
    } else if (exact < 0 && item.unit !== 'qualitative' && qualitative >= 0) {
      output[qualitative] = item;
    } else if (exact < 0 && !(item.unit === 'qualitative' && output.some((entry) => entry.name === item.name))) {
      output.push(item);
    }
  }
  return output.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
}

export function formatPantryAmount(item) {
  return formatCanonicalAmount(item?.quantity, item?.unit, {
    requiredQuantity: item?.quantity,
    countLabel: item?.countLabel,
    category: item?.category,
  });
}
