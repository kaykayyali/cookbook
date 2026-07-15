// Pure Workers AI whole-recipe-set ingredient interpretation and validation.
const UNITS = new Set(['count', 'ounce', 'qualitative']);
const KINDS = new Set(['indivisible', 'divisible', 'qualitative']);
const CATEGORIES = new Set(['produce', 'meat-seafood', 'dairy-eggs', 'bakery', 'pantry', 'frozen', 'other']);
const COUNT_LABELS = new Set(['', 'clove', 'slice', 'sheet', 'portion', 'can', 'jar', 'bottle', 'package', 'piece']);
const MAX_INGREDIENTS = 100;
const MAX_INPUT_CHARS = 30_000;

function canonicalName(value) {
  let name = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name === 'eggs') return 'egg';
  if (name === 'tomatoes') return 'tomato';
  if (/^[a-z]+s$/.test(name) && !/(ss|us)$/.test(name)) name = name.slice(0, -1);
  return name;
}

function safeDisplayName(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0 || value.length > 80
      || /[<>\x00-\x1f\x7f]/.test(value)) return false;
  if (/^(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞])|^(?:as desired|to serve|for serving|cloves?|slices?|sheets?|servings?|portions?)\b/i.test(value)) return false;
  if ((value.match(/\(/g) || []).length !== (value.match(/\)/g) || []).length) return false;
  const firstLetter = value.match(/[A-Za-z]/)?.[0];
  return !firstLetter || firstLetter === firstLetter.toUpperCase();
}

function validRecipes(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) return false;
  let count = 0;
  for (const recipe of value) {
    if (!recipe || typeof recipe !== 'object' || typeof recipe.recipeId !== 'string' || !recipe.recipeId.trim() || recipe.recipeId.length > 200) return false;
    if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) return false;
    count += recipe.ingredients.length;
    if (count > MAX_INGREDIENTS || recipe.ingredients.some((line) => typeof line !== 'string' || !line.trim() || line.length > 500)) return false;
  }
  return JSON.stringify(value).length <= MAX_INPUT_CHARS;
}

export function buildNormalizationPrompt(recipes) {
  return [
    {
      role: 'system',
      content: 'Interpret the complete combined ingredient list across all recipes. Return one JSON array item for every input line with recipeIndex, ingredientIndex, name, displayName, countLabel, category, quantity, unit, kind, and confidence. name is a lowercase singular canonical merge key. displayName is safe, concise, properly cased grocery display text and may preserve culinary or proper casing. countLabel must be empty or one of clove, slice, sheet, portion, can, jar, bottle, package, piece; preserve useful count nouns. category must be one of produce, meat-seafood, dairy-eggs, bakery, pantry, frozen, other. Remove size, preparation, purpose, count, and serving prefixes from names. Never scale, aggregate, round, add a safety buffer, or change serving sizes. The only arithmetic allowed is converting each individual raw line to a canonical quantity. unit must be count, ounce, or qualitative; kind must be indivisible, divisible, or qualitative. Convert every mass or volume line to unit ounce using water-equivalent factors exactly: 1 milliliter = 0.035274 ounce, 1 gram = 0.035274 ounce, 1 fluid ounce = 1 ounce, 1 cup = 8 ounces, 1 tablespoon = 0.5 ounce, 1 teaspoon = 1/6 ounce, 1 pound = 16 ounces, and 1 kilogram = 35.274 ounces. Apply the same water-equivalent factors to ordinary liquids and oils. Never return cup, tablespoon, teaspoon, gram, kilogram, pound, milliliter, or fluid ounce as unit. Use null quantity for qualitative amounts. Return JSON only.',
    },
    { role: 'user', content: JSON.stringify({ recipes }) },
  ];
}

export function parseNormalizedIngredients(output, recipes) {
  if (typeof output !== 'string' || !validRecipes(recipes)) return null;
  let text = output.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const expectedCount = recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0);
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;
  const result = recipes.map((recipe) => ({ recipeId: recipe.recipeId, ingredients: Array(recipe.ingredients.length) }));
  const seen = new Set();
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.recipeIndex) || !Number.isInteger(item.ingredientIndex)) return null;
    const recipe = recipes[item.recipeIndex];
    if (!recipe || item.ingredientIndex < 0 || item.ingredientIndex >= recipe.ingredients.length) return null;
    const key = `${item.recipeIndex}:${item.ingredientIndex}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const name = canonicalName(item.name);
    if (!name || name.length > 100 || /[<>\x00-\x1f\x7f]/.test(name)) return null;
    if (!safeDisplayName(item.displayName) || !COUNT_LABELS.has(item.countLabel) || !CATEGORIES.has(item.category)) return null;
    if (!UNITS.has(item.unit) || !KINDS.has(item.kind)) return null;
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) return null;
    if (item.unit === 'qualitative') {
      if (item.quantity != null || item.kind !== 'qualitative' || item.countLabel !== '') return null;
    } else if (!Number.isFinite(item.quantity) || item.quantity < 0) return null;
    if (item.unit === 'count' && item.kind !== 'indivisible') return null;
    if (item.unit === 'ounce' && (item.kind !== 'divisible' || item.countLabel !== '')) return null;
    result[item.recipeIndex].ingredients[item.ingredientIndex] = {
      raw: recipe.ingredients[item.ingredientIndex], name, displayName: item.displayName,
      countLabel: item.countLabel, category: item.category, quantity: item.quantity,
      unit: item.unit, kind: item.kind, confidence: item.confidence,
    };
  }
  if (result.some((recipe) => recipe.ingredients.some((item) => !item))) return null;
  return result;
}

export async function handleNormalize(body, deps) {
  const recipes = body?.recipes;
  if (!validRecipes(recipes)) return { status: 400, body: { error: 'invalid_ingredients' } };
  const safeRecipes = recipes.map((recipe) => ({
    recipeId: recipe.recipeId,
    recipeName: typeof recipe.recipeName === 'string' ? recipe.recipeName.slice(0, 200) : '',
    recipeYield: typeof recipe.recipeYield === 'string' || typeof recipe.recipeYield === 'number' ? String(recipe.recipeYield).slice(0, 100) : '',
    ingredients: [...recipe.ingredients],
  }));
  let output;
  try { output = await deps.runLLM(buildNormalizationPrompt(safeRecipes)); }
  catch { return { status: 503, body: { error: 'normalization_unavailable' } }; }
  const normalized = parseNormalizedIngredients(output, safeRecipes);
  if (!normalized) return { status: 422, body: { error: 'invalid_normalization' } };
  return { status: 200, body: { recipes: normalized, version: 2 } };
}
