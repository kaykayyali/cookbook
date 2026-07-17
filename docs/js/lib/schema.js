// ════════════════════════════════════════════════════════
// schema.js — schema.org/Recipe ↔ internal model (no DOM)
//
// Internal model:
//   recipeIngredient:   string[]
//   recipeInstructions: string[]  (text only)
// JSON-LD export wraps instructions in HowToStep objects.
// ════════════════════════════════════════════════════════

const DIRECT_FIELDS = [
  'url', 'image', 'recipeCategory', 'recipeCuisine', 'recipeYield',
  'cookingMethod', 'suitableForDiet', 'prepTime', 'cookTime', 'totalTime',
];

const NUTRI_FIELDS = [
  'servingSize', 'calories', 'proteinContent', 'fatContent', 'carbohydrateContent',
];

/** Generate a UUID, falling back when crypto.randomUUID is unavailable (older test envs). */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Serialise an internal recipe to a schema.org/Recipe JSON-LD object.
 * @param {object} r internal recipe
 * @returns {object} JSON-LD
 */
export function toSchema(r) {
  const out = { '@context': 'https://schema.org', '@type': 'Recipe', name: r.name };

  DIRECT_FIELDS.forEach((k) => { if (r[k]) out[k] = r[k]; });

  if (r.dateCreated) out.datePublished = r.dateCreated.split('T')[0];
  if (r.dateModified) out.dateModified = r.dateModified.split('T')[0];

  if (r.recipeIngredient?.length) out.recipeIngredient = r.recipeIngredient;
  if (Array.isArray(r.ingredientNormalizations) && r.ingredientNormalizations.length) {
    out.ingredientNormalizations = r.ingredientNormalizations;
  }

  if (r.recipeInstructions?.length) {
    out.recipeInstructions = r.recipeInstructions
      .filter(Boolean)
      .map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text }));
  }

  const n = r.nutrition || {};
  if (n.calories || n.proteinContent || n.fatContent || n.carbohydrateContent) {
    out.nutrition = { '@type': 'NutritionInformation' };
    NUTRI_FIELDS.forEach((k) => { if (n[k]) out.nutrition[k] = n[k]; });
  }

  return out;
}

/**
 * Parse a schema.org/Recipe JSON-LD object into the internal model.
 * Tolerant of missing fields and string-or-HowToStep instructions.
 * @param {object} s JSON-LD
 * @returns {object} internal recipe
 */
export function fromSchema(s) {
  return {
    _id: s._id || uuid(),
    name: String(s.name || 'Untitled'),
    url: s.url || '',
    image: s.image || '',
    dateCreated: s.datePublished || new Date().toISOString(),
    dateModified: s.dateModified || '',
    recipeCategory: s.recipeCategory || '',
    recipeCuisine: s.recipeCuisine || '',
    recipeYield: s.recipeYield || '',
    cookingMethod: s.cookingMethod || '',
    suitableForDiet: s.suitableForDiet || '',
    prepTime: s.prepTime || '',
    cookTime: s.cookTime || '',
    totalTime: s.totalTime || '',
    recipeIngredient: Array.isArray(s.recipeIngredient) ? s.recipeIngredient : [],
    ingredientNormalizations: Array.isArray(s.ingredientNormalizations) ? s.ingredientNormalizations : [],
    recipeInstructions: Array.isArray(s.recipeInstructions)
      ? s.recipeInstructions.map((x) => (typeof x === 'string' ? x : x.text || ''))
      : s.recipeInstructions
      ? [String(s.recipeInstructions)]
      : [],
    nutrition: s.nutrition
      ? {
          servingSize: s.nutrition.servingSize || '',
          calories: s.nutrition.calories || '',
          proteinContent: s.nutrition.proteinContent || '',
          fatContent: s.nutrition.fatContent || '',
          carbohydrateContent: s.nutrition.carbohydrateContent || '',
        }
      : {},
  };
}

/**
 * Parse arbitrary imported JSON (single object or array) into internal recipes.
 * Filters to entries that look like recipes.
 * @param {object|Array} data
 * @returns {object[]} internal recipes
 */
export function parseImport(data) {
  const arr = Array.isArray(data) ? data : [data];
  return arr
    .filter((d) => d && (d['@type'] === 'Recipe' || d.name))
    .map(fromSchema);
}
