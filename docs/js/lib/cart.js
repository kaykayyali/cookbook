// cart.js — deterministic normalized shopping-cart logic (no DOM)
const FRACTIONS = {
  '¼': .25, '½': .5, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875,
};
const OUNCE_FACTORS = {
  ml: .035274, milliliter: .035274, milliliters: .035274,
  g: .035274, gram: .035274, grams: .035274,
  oz: 1, ounce: 1, ounces: 1, 'fl oz': 1, 'fluid ounce': 1, 'fluid ounces': 1,
  cup: 8, cups: 8, tbsp: .5, tablespoon: .5, tablespoons: .5,
  tsp: 1 / 6, teaspoon: 1 / 6, teaspoons: 1 / 6,
  lb: 16, lbs: 16, pound: 16, pounds: 16,
  kg: 35.274, kilogram: 35.274, kilograms: 35.274,
};
const COUNT_UNITS = new Set(['dozen', 'count', 'piece', 'pieces', 'item', 'items', 'clove', 'cloves', 'package', 'packages', 'pkg', 'can', 'cans', 'jar', 'jars', 'bottle', 'bottles']);
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
  if (/^\d+\/\d+$/.test(token)) {
    const [a, b] = token.split('/').map(Number);
    return b ? a / b : null;
  }
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
  const range = text.match(new RegExp(`^${quantityPattern}\\s*-\\s*${quantityPattern}\\s*`));
  if (range) return {
    quantity: Math.max(numericExpression(range[1]), numericExpression(range[2])),
    rest: text.slice(range[0].length),
    confidence: .8,
  };
  const one = text.match(new RegExp(`^${quantityPattern}\\s*`));
  if (!one) return null;
  return { quantity: numericExpression(one[1]), rest: text.slice(one[0].length) };
}

export function canonicalName(value) {
  let name = String(value || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, ' ')
    .replace(/\b(to taste|as needed|for garnish)\b/g, ' ')
    .replace(/^of\s+/, '')
    .replace(/\s+/g, ' ').trim();
  const words = name.split(' ').filter((word) => !DESCRIPTORS.has(word));
  name = words.join(' ').trim();
  if (NAME_ALIASES.has(name)) return NAME_ALIASES.get(name);
  if (/^[a-z]+s$/.test(name) && !/(ss|us)$/.test(name)) name = name.slice(0, -1);
  return name || 'uncertain ingredient';
}

export function parseServings(recipeYield) {
  const value = Array.isArray(recipeYield) ? recipeYield[0] : recipeYield;
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function normalizeIngredient(rawValue) {
  const raw = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
  const text = raw.toLowerCase().trim().replace(/[–—]/g, '-');
  const packageWeight = text.match(/^(\d+(?:\.\d+)?)\s*\(\s*(\d+(?:\.\d+)?)\s*[- ]?\s*(oz|ounce|ounces|g|gram|grams)\s*\)\s*(?:cans?|jars?|packages?|pkgs?)?\s*(.+)$/)
    || text.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*[- ]\s*(oz|ounce|ounces|g|gram|grams)\s+(?:cans?|jars?|packages?|pkgs?)\s+(.+)$/);
  if (packageWeight) {
    const count = Number(packageWeight[1]);
    const size = Number(packageWeight[2]);
    return {
      raw,
      name: canonicalName(packageWeight[4]),
      quantity: round(count * size * OUNCE_FACTORS[packageWeight[3]]),
      unit: 'ounce',
      kind: 'divisible',
      confidence: .75,
    };
  }
  const leading = readLeadingQuantity(text);
  if (!leading) {
    const qualitativeName = text.replace(/^(?:a\s+)?(?:pinch|dash|handful)\s+(?:of\s+)?/, '');
    return { raw, name: canonicalName(qualitativeName), quantity: null, unit: 'qualitative', kind: 'qualitative', confidence: .4 };
  }

  let quantity = leading.quantity;
  let rest = leading.rest.trim();
  const unitNames = [...Object.keys(OUNCE_FACTORS), ...COUNT_UNITS].sort((a, b) => b.length - a.length);
  const unit = unitNames.find((candidate) => rest === candidate || rest.startsWith(candidate + ' ')) || '';
  if (unit) rest = rest.slice(unit.length).trim();

  if (unit === 'dozen') quantity *= 12;
  if (OUNCE_FACTORS[unit] != null) {
    return { raw, name: canonicalName(rest), quantity: round(quantity * OUNCE_FACTORS[unit]), unit: 'ounce', kind: 'divisible', confidence: leading.confidence || .9 };
  }
  return { raw, name: canonicalName(rest), quantity: round(quantity), unit: 'count', kind: 'indivisible', confidence: leading.confidence || .85 };
}

export function normalizeIngredientsLocal(lines) {
  return (Array.isArray(lines) ? lines : []).map(normalizeIngredient);
}

export function isNormalizedIngredient(item) {
  if (!item || typeof item !== 'object' || typeof item.raw !== 'string' || typeof item.name !== 'string') return false;
  if (!['count', 'ounce', 'qualitative'].includes(item.unit)) return false;
  if (!['indivisible', 'divisible', 'qualitative'].includes(item.kind)) return false;
  if (item.confidence != null && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) return false;
  if (item.unit === 'qualitative') return item.quantity == null;
  return Number.isFinite(item.quantity) && item.quantity >= 0;
}

export function addRecipeSelection(cart, recipe, ingredients) {
  const sourceServings = parseServings(recipe?.recipeYield);
  const recipeId = String(recipe?._id || recipe?.id || recipe?.name || 'recipe');
  const existing = (Array.isArray(cart) ? cart : []).find((item) => item.recipeId === recipeId);
  const selection = {
    recipeId,
    recipeName: String(recipe?.name || 'Untitled recipe'),
    sourceServings,
    targetServings: existing?.targetServings || sourceServings,
    normalizationVersion: 1,
    ingredients: (Array.isArray(ingredients) ? ingredients : []).filter(isNormalizedIngredient).map((item) => ({
      ...item,
      confidence: Number.isFinite(item.confidence) ? item.confidence : .5,
    })),
  };
  return [...(Array.isArray(cart) ? cart : []).filter((item) => item.recipeId !== selection.recipeId), selection];
}

export function setTargetServings(cart, recipeId, target) {
  const next = Math.max(1, Math.round(Number(target) || 1));
  return (Array.isArray(cart) ? cart : []).map((selection) => selection.recipeId === recipeId
    ? { ...selection, targetServings: next }
    : selection);
}

export function removeRecipeSelection(cart, recipeId) {
  return (Array.isArray(cart) ? cart : []).filter((selection) => selection.recipeId !== recipeId);
}

export function removeShoppingItem(cart, name) {
  return (Array.isArray(cart) ? cart : []).map((selection) => ({
    ...selection,
    ingredients: (Array.isArray(selection.ingredients) ? selection.ingredients : [])
      .filter((ingredient) => ingredient.name !== name),
  }));
}

export function aggregateCart(cart) {
  const groups = new Map();
  const qualitative = new Map();
  for (const selection of Array.isArray(cart) ? cart : []) {
    const scale = (Number(selection.targetServings) || 1) / (Number(selection.sourceServings) || 1);
    for (const ingredient of Array.isArray(selection.ingredients) ? selection.ingredients : []) {
      if (!isNormalizedIngredient(ingredient)) continue;
      const confidence = Number.isFinite(ingredient.confidence) ? ingredient.confidence : .5;
      if (ingredient.unit === 'qualitative') {
        if (!qualitative.has(ingredient.name)) qualitative.set(ingredient.name, { raw: [], confidence: 1 });
        const note = qualitative.get(ingredient.name);
        if (!note.raw.includes(ingredient.raw)) note.raw.push(ingredient.raw);
        note.confidence = Math.min(note.confidence, confidence);
        continue;
      }
      const key = `${ingredient.name}\u0000${ingredient.unit}`;
      if (!groups.has(key)) groups.set(key, {
        name: ingredient.name, unit: ingredient.unit, kind: ingredient.kind,
        quantity: 0, raw: [], confidence: 1,
      });
      const group = groups.get(key);
      if (!group.raw.includes(ingredient.raw)) group.raw.push(ingredient.raw);
      group.quantity += ingredient.quantity * scale;
      group.confidence = Math.min(group.confidence, confidence);
    }
  }
  for (const [name, note] of qualitative) {
    const numeric = [...groups.values()].find((group) => group.name === name);
    if (numeric) {
      for (const raw of note.raw) if (!numeric.raw.includes(raw)) numeric.raw.push(raw);
      numeric.confidence = Math.min(numeric.confidence, note.confidence);
      numeric.uncertain = true;
    } else {
      groups.set(`${name}\u0000qualitative`, {
        name, unit: 'qualitative', kind: 'qualitative', quantity: 0,
        raw: note.raw, confidence: note.confidence, uncertain: true,
      });
    }
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

export function formatCanonicalAmount(quantity, unit) {
  if (unit === 'qualitative' || quantity == null) return 'as needed';
  if (unit === 'count') return `${cleanNumber(quantity)} ${quantity === 1 ? 'item' : 'items'}`;
  const candidates = [
    [16, 'lb'], [8, 'cup'], [.5, 'tbsp'], [1 / 6, 'tsp'], [1, 'oz'],
  ];
  for (const [factor, label] of candidates) {
    const converted = quantity / factor;
    if (converted >= 1 && Math.abs(converted - Math.round(converted)) < 1e-6) return `${cleanNumber(converted)} ${label}`;
  }
  return `${cleanNumber(quantity)} oz`;
}

function selectionFromLegacyRows(rows, recipeId, recipeName) {
  return {
    recipeId,
    recipeName,
    sourceServings: 1,
    targetServings: 1,
    normalizationVersion: 1,
    ingredients: rows.map((row) => normalizeIngredient(typeof row?.line === 'string' ? row.line : JSON.stringify(row))),
  };
}

export function normalizeCart(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const legacyGroups = new Map();
  value.forEach((item, index) => {
    if (item && typeof item === 'object' && Array.isArray(item.ingredients)) {
      const sourceServings = parseServings(item.sourceServings);
      output.push({
        recipeId: String(item.recipeId || `migrated-${index}`),
        recipeName: String(item.recipeName || 'Migrated recipe'),
        sourceServings,
        targetServings: Math.max(1, Math.round(Number(item.targetServings) || sourceServings)),
        normalizationVersion: Number(item.normalizationVersion) || 1,
        ingredients: item.ingredients.map((ingredient) => isNormalizedIngredient(ingredient)
          ? {
            ...ingredient,
            name: canonicalName(ingredient.name),
            confidence: Number.isFinite(ingredient.confidence) ? ingredient.confidence : .5,
          }
          : normalizeIngredient(typeof ingredient?.raw === 'string' ? ingredient.raw : JSON.stringify(ingredient))),
      });
      return;
    }
    const recoverableId = item && typeof item === 'object' && item.recipeId ? String(item.recipeId) : `migrated-${index}`;
    if (!legacyGroups.has(recoverableId)) legacyGroups.set(recoverableId, []);
    legacyGroups.get(recoverableId).push(item);
  });
  for (const [recipeId, rows] of legacyGroups) {
    output.push(selectionFromLegacyRows(rows, recipeId, String(rows[0]?.recipeName || 'Migrated cart items')));
  }
  return output;
}

export function clearCart() { return []; }
