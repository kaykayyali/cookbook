// cart.js — deterministic normalized shopping-cart logic (no DOM)
export const NORMALIZATION_VERSION = 2;
export const INGREDIENT_CATEGORIES = ['produce', 'meat-seafood', 'dairy-eggs', 'bakery', 'pantry', 'frozen', 'other'];
export const COUNT_LABELS = ['', 'clove', 'leaf', 'bunch', 'slice', 'sheet', 'portion', 'can', 'jar', 'bottle', 'package', 'piece'];

const FRACTIONS = { '¼': .25, '½': .5, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };
const OUNCE_FACTORS = {
  ml: .035274, milliliter: .035274, milliliters: .035274,
  l: 35.274, liter: 35.274, liters: 35.274, litre: 35.274, litres: 35.274,
  g: .035274, gram: .035274, grams: .035274,
  oz: 1, ounce: 1, ounces: 1, 'fl oz': 1, 'fluid ounce': 1, 'fluid ounces': 1,
  cup: 8, cups: 8, tbsp: .5, tablespoon: .5, tablespoons: .5,
  tsp: 1 / 6, teaspoon: 1 / 6, teaspoons: 1 / 6,
  lb: 16, lbs: 16, pound: 16, pounds: 16,
  kg: 35.274, kilogram: 35.274, kilograms: 35.274,
};
const COUNT_UNIT_LABELS = new Map([
  ['dozen', ''], ['count', ''], ['item', ''], ['items', ''],
  ['piece', 'piece'], ['pieces', 'piece'], ['clove', 'clove'], ['cloves', 'clove'],
  ['slice', 'slice'], ['slices', 'slice'], ['sheet', 'sheet'], ['sheets', 'sheet'],
  ['portion', 'portion'], ['portions', 'portion'], ['serving', 'portion'], ['servings', 'portion'],
  ['package', 'package'], ['packages', 'package'], ['pkg', 'package'], ['pkgs', 'package'],
  ['can', 'can'], ['cans', 'can'], ['jar', 'jar'], ['jars', 'jar'],
  ['bottle', 'bottle'], ['bottles', 'bottle'],
]);
const DESCRIPTORS = new Set(['large', 'small', 'medium', 'fresh', 'whole', 'peeled', 'seeded', 'chopped', 'diced', 'minced', 'sliced', 'grated', 'shredded', 'packed', 'heaping', 'level', 'divided']);
const NAME_ALIASES = new Map([
  ['eggs', 'egg'], ['egg', 'egg'], ['tomatoes', 'tomato'], ['potatoes', 'potato'],
  ['cloves garlic', 'garlic'], ['garlic cloves', 'garlic'], ['extra virgin olive oil', 'olive oil'],
]);

function round(value, places = 9) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return numeric;
  if (numeric !== 0 && Math.abs(numeric) < 10 ** -places) return Number(numeric.toPrecision(places));
  const p = 10 ** places;
  return Math.round((numeric + Number.EPSILON) * p) / p;
}

function numericToken(token) {
  if (FRACTIONS[token] != null) return FRACTIONS[token];
  if (/^\d+\/\d+$/.test(token)) { const [a, b] = token.split('/').map(Number); return b ? a / b : null; }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function numericExpression(value) {
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 2) {
    const whole = numericToken(parts[0]);
    const fraction = numericToken(parts[1]);
    return whole != null && fraction != null ? whole + fraction : null;
  }
  return numericToken(parts[0]);
}

function readLeadingQuantity(text) {
  const quantityPattern = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const range = text.match(new RegExp(`^${quantityPattern}\\s*(?:-|to\\b)\\s*${quantityPattern}\\s*`));
  if (range) return {
    quantity: Math.max(numericExpression(range[1]), numericExpression(range[2])),
    rest: text.slice(range[0].length),
    confidence: .8,
    quantityState: 'range',
  };
  const one = text.match(new RegExp(`^${quantityPattern}\\s*`));
  if (!one) return null;
  return { quantity: numericExpression(one[1]), rest: text.slice(one[0].length) };
}

function cleanNameText(value) {
  let text = String(value || '').replace(/[–—]/g, '-').trim();
  text = text.replace(/^(?:as desired|to serve|for serving)\s*[,;:\-]?\s*/i, '');
  text = text.replace(/^\d+(?:\.\d+)?\s+(?:servings?|portions?)\s+(?:of\s+)?/i, '');
  text = text.replace(/^(?:cloves?|slices?|sheets?|servings?|portions?|cans?|jars?|bottles?|packages?|pieces?)\s+(?:of\s+)?/i, '');
  const opens = (text.match(/\(/g) || []).length;
  const closes = (text.match(/\)/g) || []).length;
  if (opens !== closes) text = text.replace(/\s*\([^)]*$/, '');
  return text.replace(/\s*\)+\s*$/, '').replace(/\s+/g, ' ').trim();
}

export function canonicalName(value) {
  let name = cleanNameText(value).toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, ' ')
    .replace(/\b(to taste|as needed|for garnish|to serve|for serving|as desired)\b/g, ' ')
    .replace(/^(?:\d+(?:\.\d+)?\s+)?(?:servings?|portions?)\s+(?:of\s+)?/, '')
    .replace(/^of\s+/, '').replace(/\s+/g, ' ').trim();
  const words = name.split(' ').filter((word) => !DESCRIPTORS.has(word));
  name = words.join(' ').trim();
  if (NAME_ALIASES.has(name)) return NAME_ALIASES.get(name);
  if (/^[a-z]+s$/.test(name) && !/(ss|us)$/.test(name)) name = name.slice(0, -1);
  return name || 'uncertain ingredient';
}

function titleCase(name) {
  return String(name || '').split(/\s+/).map((word) => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}

function properlyCasedDisplayName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[<>\x00-\x1f\x7f]/.test(value)) return false;
  if (/^(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞])|^(?:as desired|to serve|for serving|cloves?|slices?|sheets?|servings?|portions?)\b/i.test(value)) return false;
  if ((value.match(/\(/g) || []).length !== (value.match(/\)/g) || []).length) return false;
  const firstLetter = value.match(/[A-Za-z]/)?.[0];
  return !firstLetter || firstLetter === firstLetter.toUpperCase();
}

function inferCategory(name) {
  const value = canonicalName(name);
  if (/\b(chicken|beef|pork|lamb|turkey|fish|salmon|tuna|shrimp|prawn|crab|meat|pancetta|guanciale)\b/.test(value)) return 'meat-seafood';
  if (/\b(milk|cream|cheese|butter|yogurt|egg|pecorino|parmesan)\b/.test(value)) return 'dairy-eggs';
  if (/\b(bread|roll|bun|tortilla|pita)\b/.test(value)) return 'bakery';
  if (/\b(frozen|ice cream)\b/.test(value)) return 'frozen';
  if (/\b(black pepper|white pepper|peppercorn|cayenne pepper)\b/.test(value)) return 'pantry';
  if (/\b(onion|garlic|tomato|potato|pepper|parsley|cilantro|lettuce|carrot|celery|apple|lemon|lime|herb|fruit|vegetable)\b/.test(value)) return 'produce';
  if (/\b(flour|sugar|salt|oil|vinegar|spice|paprika|cumin|rice|pasta|stock)\b/.test(value)) return 'pantry';
  return 'other';
}

function metadata(name, countLabel = '', supplied = {}) {
  const canonical = canonicalName(name);
  const displayName = properlyCasedDisplayName(supplied.displayName) ? supplied.displayName.trim() : titleCase(canonical);
  return {
    name: canonical,
    displayName,
    countLabel: COUNT_LABELS.includes(supplied.countLabel) ? supplied.countLabel : (COUNT_LABELS.includes(countLabel) ? countLabel : ''),
    category: INGREDIENT_CATEGORIES.includes(supplied.category) ? supplied.category : inferCategory(canonical),
  };
}

export function parseServings(recipeYield) {
  const value = Array.isArray(recipeYield) ? recipeYield[0] : recipeYield;
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function normalizeIngredient(rawValue) {
  const raw = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
  const cleaned = cleanNameText(raw);
  const text = cleaned.toLowerCase();
  const packageWeight = text.match(/^(\d+(?:\.\d+)?)\s*\(\s*(\d+(?:\.\d+)?)\s*[- ]?\s*(oz|ounce|ounces|g|gram|grams)\s*\)\s*(?:cans?|jars?|packages?|pkgs?)?\s*(.+)$/)
    || text.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*[- ]\s*(oz|ounce|ounces|g|gram|grams)\s+(?:cans?|jars?|packages?|pkgs?)\s+(.+)$/);
  if (packageWeight) {
    const count = Number(packageWeight[1]);
    const size = Number(packageWeight[2]);
    return { raw, ...metadata(packageWeight[4]), quantity: round(count * size * OUNCE_FACTORS[packageWeight[3]]), unit: 'ounce', kind: 'divisible', confidence: .75 };
  }
  const leading = readLeadingQuantity(text);
  if (!leading) {
    const qualitativeName = text.replace(/^(?:a\s+)?(?:pinch|dash|handful)\s+(?:of\s+)?/, '');
    return { raw, ...metadata(qualitativeName), quantity: null, unit: 'qualitative', kind: 'qualitative', confidence: .4 };
  }
  let quantity = leading.quantity;
  let rest = leading.rest.trim();
  const unitNames = [...Object.keys(OUNCE_FACTORS), ...COUNT_UNIT_LABELS.keys()].sort((a, b) => b.length - a.length);
  const unit = unitNames.find((candidate) => rest === candidate || rest.startsWith(candidate + ' ')) || '';
  if (unit) rest = rest.slice(unit.length).trim();
  if (unit === 'dozen') quantity *= 12;
  const quantityState = leading.quantityState ? { quantityState: leading.quantityState } : {};
  if (OUNCE_FACTORS[unit] != null) return { raw, ...metadata(rest), quantity: round(quantity * OUNCE_FACTORS[unit]), unit: 'ounce', kind: 'divisible', confidence: leading.confidence || .9, ...quantityState };
  return { raw, ...metadata(rest, COUNT_UNIT_LABELS.get(unit) || ''), quantity: round(quantity), unit: 'count', kind: 'indivisible', confidence: leading.confidence || .85, ...quantityState };
}

export function normalizeIngredientsLocal(lines) { return (Array.isArray(lines) ? lines : []).map(normalizeIngredient); }

export function isNormalizedIngredient(item) {
  if (!item || typeof item !== 'object' || typeof item.raw !== 'string' || typeof item.name !== 'string') return false;
  if (!['count', 'ounce', 'qualitative'].includes(item.unit) || !['indivisible', 'divisible', 'qualitative'].includes(item.kind)) return false;
  if (item.displayName != null && !properlyCasedDisplayName(item.displayName)) return false;
  if (item.countLabel != null && !COUNT_LABELS.includes(item.countLabel)) return false;
  if (item.category != null && !INGREDIENT_CATEGORIES.includes(item.category)) return false;
  if (item.confidence != null && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) return false;
  if (item.unit === 'qualitative') return item.quantity == null && item.kind === 'qualitative';
  if (item.unit === 'count' && item.kind !== 'indivisible') return false;
  if (item.unit === 'ounce' && item.kind !== 'divisible') return false;
  return Number.isFinite(item.quantity) && item.quantity >= 0;
}

function enrichIngredient(item) { return { ...item, ...metadata(item.name, item.countLabel, item), confidence: Number.isFinite(item.confidence) ? item.confidence : .5 }; }

export function addRecipeSelection(cart, recipe, ingredients) {
  const sourceServings = parseServings(recipe?.recipeYield);
  const recipeId = String(recipe?._id || recipe?.id || recipe?.recipeId || recipe?.name || 'recipe');
  const existing = (Array.isArray(cart) ? cart : []).find((item) => item.recipeId === recipeId);
  const removedIngredientNames = [...new Set((existing?.removedIngredientNames || []).map(canonicalName).filter(Boolean))];
  const selection = {
    recipeId, recipeName: String(recipe?.name || recipe?.recipeName || 'Untitled recipe'),
    sourceServings, targetServings: existing?.targetServings || sourceServings,
    normalizationVersion: NORMALIZATION_VERSION,
    ingredients: (Array.isArray(ingredients) ? ingredients : []).filter(isNormalizedIngredient).map(enrichIngredient)
      .filter((ingredient) => !removedIngredientNames.includes(ingredient.name)),
    ...(removedIngredientNames.length ? { removedIngredientNames } : {}),
  };
  return [...(Array.isArray(cart) ? cart : []).filter((item) => item.recipeId !== recipeId), selection];
}

export function setTargetServings(cart, recipeId, target) {
  const next = Math.max(1, Math.round(Number(target) || 1));
  return (Array.isArray(cart) ? cart : []).map((selection) => selection.recipeId === recipeId ? { ...selection, targetServings: next } : selection);
}
export function removeRecipeSelection(cart, recipeId) { return (Array.isArray(cart) ? cart : []).filter((selection) => selection.recipeId !== recipeId); }
export function removeShoppingItem(cart, name) {
  const canonical = canonicalName(name);
  return (Array.isArray(cart) ? cart : []).map((selection) => {
    const ingredients = selection.ingredients || [];
    if (!ingredients.some((ingredient) => ingredient.name === canonical)) return selection;
    const removedIngredientNames = [...new Set([...(selection.removedIngredientNames || []).map(canonicalName), canonical].filter(Boolean))];
    return { ...selection, removedIngredientNames, ingredients: ingredients.filter((ingredient) => ingredient.name !== canonical) };
  });
}

export function recipeSetSignature(recipes) {
  const rows = (Array.isArray(recipes) ? recipes : []).map((recipe) => ({
    recipeId: String(recipe.recipeId || recipe._id || recipe.id || ''),
    raw: (Array.isArray(recipe.ingredients) ? recipe.ingredients : Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [])
      .map((item) => typeof item === 'string' ? item : item?.raw).filter((item) => typeof item === 'string'),
    effective: String(recipe.effectiveSignature || ''),
    normalized: (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).filter((item) => item && typeof item === 'object')
      .map((item) => [item.name, item.quantity, item.quantityMin, item.unit, item.countLabel, item.reviewVersion || 0, item.reviewedAt || 0]),
  })).sort((a, b) => a.recipeId.localeCompare(b.recipeId));
  return `v${NORMALIZATION_VERSION}:${JSON.stringify(rows)}`;
}

export function aggregateCart(cart) {
  const groups = new Map();
  const qualitative = new Map();
  for (const selection of Array.isArray(cart) ? cart : []) {
    const scale = (Number(selection.targetServings) || 1) / (Number(selection.sourceServings) || 1);
    for (const rawIngredient of Array.isArray(selection.ingredients) ? selection.ingredients : []) {
      if (!isNormalizedIngredient(rawIngredient)) continue;
      const ingredient = enrichIngredient(rawIngredient);
      const confidence = ingredient.confidence;
      if (ingredient.unit === 'qualitative') {
        if (!qualitative.has(ingredient.name)) qualitative.set(ingredient.name, { raw: [], confidence: 1, ...metadata(ingredient.name, ingredient.countLabel, ingredient) });
        const note = qualitative.get(ingredient.name);
        if (!note.raw.includes(ingredient.raw)) note.raw.push(ingredient.raw);
        note.confidence = Math.min(note.confidence, confidence);
        continue;
      }
      const packageIdentity = ingredient.unit === 'count' ? ingredient.countLabel || '' : '';
      const key = `${ingredient.name}\u0000${ingredient.unit}\u0000${packageIdentity}`;
      if (!groups.has(key)) groups.set(key, { ...metadata(ingredient.name, ingredient.countLabel, ingredient), unit: ingredient.unit, kind: ingredient.kind, quantity: 0, raw: [], confidence: 1 });
      const group = groups.get(key);
      if (!group.raw.includes(ingredient.raw)) group.raw.push(ingredient.raw);
      group.quantity += ingredient.quantity * scale;
      group.confidence = Math.min(group.confidence, confidence);
      if (!group.countLabel && ingredient.countLabel) group.countLabel = ingredient.countLabel;
    }
  }
  for (const [name, note] of qualitative) {
    const numeric = [...groups.values()].find((group) => group.name === name);
    if (numeric) {
      for (const raw of note.raw) if (!numeric.raw.includes(raw)) numeric.raw.push(raw);
      numeric.confidence = Math.min(numeric.confidence, note.confidence);
      numeric.uncertain = true;
    } else groups.set(`${name}\u0000qualitative`, { ...note, unit: 'qualitative', kind: 'qualitative', quantity: 0, uncertain: true });
  }
  return [...groups.values()].map((group) => {
    const uncertain = group.uncertain || group.confidence < .7;
    if (group.unit === 'qualitative') return { ...group, uncertain, quantity: null, purchaseQuantity: null };
    const quantity = round(group.quantity);
    const buffered = round(quantity * 1.1);
    return { ...group, uncertain, quantity, purchaseQuantity: group.kind === 'indivisible' ? Math.ceil(buffered) : buffered };
  });
}

function cleanNumber(value) {
  const numeric = Number(value);
  if (numeric > 0 && numeric < .1) return String(Number(numeric.toPrecision(4)));
  return String(round(numeric, 2)).replace(/\.0+$/, '');
}

function eighthAmount(value) {
  const eighths = Math.round(value * 8);
  const whole = Math.floor(eighths / 8);
  const remainder = eighths % 8;
  const labels = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];
  return [whole || '', labels[remainder]].filter(String).join(' ');
}

function practicalCookingAmount(required, buffered) {
  const [factor, label] = required >= 2 ? [8, 'cup'] : required >= .5 ? [.5, 'tbsp'] : [1 / 6, 'tsp'];
  const requiredUnits = required / factor;
  const bufferedUnits = buffered / factor;
  const safeEighths = Math.ceil((requiredUnits - 1e-10) * 8);
  const practical = safeEighths / 8;
  if (practical > bufferedUnits + 1e-9) return null;
  const unicode = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
  const whole = Math.floor(safeEighths / 8);
  const fraction = unicode[safeEighths % 8];
  const amount = `${whole || ''}${fraction}` || '0';
  const plural = label === 'cup' && practical > 1 ? 's' : '';
  return `${amount} ${label}${plural}`;
}

export function formatCanonicalAmount(quantity, unit, options = {}) {
  if (unit === 'qualitative' || quantity == null) return 'as needed';
  if (unit === 'count') {
    const number = cleanNumber(quantity);
    const label = COUNT_LABELS.includes(options.countLabel) ? options.countLabel : '';
    const plural = Number(quantity) === 1 ? label : label === 'leaf' ? 'leaves' : label ? `${label}s` : '';
    return label ? `${number} ${plural}` : number;
  }
  const required = Number(options.requiredQuantity);
  const buffered = Number(quantity);
  if (options.category === 'meat-seafood') return `${cleanNumber(buffered)} oz`;
  if (Number.isFinite(required) && required > 0
      && ['pantry', 'dairy-eggs', 'bakery', 'frozen', 'other'].includes(options.category)) {
    const practical = practicalCookingAmount(required, buffered);
    if (practical) return practical;
  }
  const candidates = [[16, 'lb'], [8, 'cup'], [.5, 'tbsp'], [1 / 6, 'tsp'], [1, 'oz']];
  for (const [factor, label] of candidates) {
    const converted = buffered / factor;
    if (converted >= 1 && Math.abs(converted - Math.round(converted)) < 1e-6) return `${cleanNumber(converted)} ${label}`;
  }
  if (Number.isFinite(required) && required >= 1) {
    const practical = Math.ceil((required - Number.EPSILON) * 8) / 8;
    if (practical >= required - 1e-9 && practical <= buffered + 1e-9) return `${eighthAmount(practical)} oz`;
  }
  return `${cleanNumber(buffered)} oz`;
}

function selectionFromLegacyRows(rows, recipeId, recipeName) {
  return { recipeId, recipeName, sourceServings: 1, targetServings: 1, normalizationVersion: 1, ingredients: rows.map((row) => normalizeIngredient(typeof row?.line === 'string' ? row.line : JSON.stringify(row))) };
}

export function normalizeCart(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const legacyGroups = new Map();
  value.forEach((item, index) => {
    if (item && typeof item === 'object' && Array.isArray(item.ingredients)) {
      const sourceServings = parseServings(item.sourceServings);
      const removedIngredientNames = [...new Set((item.removedIngredientNames || []).map(canonicalName).filter(Boolean))];
      output.push({
        recipeId: String(item.recipeId || `migrated-${index}`), recipeName: String(item.recipeName || 'Migrated recipe'),
        sourceServings, targetServings: Math.max(1, Math.round(Number(item.targetServings) || sourceServings)),
        normalizationVersion: Number(item.normalizationVersion) || 1,
        ingredients: item.ingredients.map((ingredient) => isNormalizedIngredient(ingredient)
          ? enrichIngredient({ ...ingredient, name: canonicalName(ingredient.name) })
          : normalizeIngredient(typeof ingredient?.raw === 'string' ? ingredient.raw : JSON.stringify(ingredient)))
          .filter((ingredient) => !removedIngredientNames.includes(ingredient.name)),
        ...(removedIngredientNames.length ? { removedIngredientNames } : {}),
      });
      return;
    }
    const recoverableId = item && typeof item === 'object' && item.recipeId ? String(item.recipeId) : `migrated-${index}`;
    if (!legacyGroups.has(recoverableId)) legacyGroups.set(recoverableId, []);
    legacyGroups.get(recoverableId).push(item);
  });
  for (const [recipeId, rows] of legacyGroups) output.push(selectionFromLegacyRows(rows, recipeId, String(rows[0]?.recipeName || 'Migrated cart items')));
  return output;
}

export function clearCart() { return []; }
