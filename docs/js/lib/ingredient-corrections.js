import {
  canonicalName,
  normalizeIngredient,
  isNormalizedIngredient,
  NORMALIZATION_VERSION,
  COUNT_LABELS,
} from './cart.js';

export const INGREDIENT_REVIEW_VERSION = 1;
export const AMOUNT_STATES = Object.freeze(['numeric', 'qualitative', 'unknown']);
export const MEASUREMENT_FAMILIES = Object.freeze(['count', 'volume', 'weight']);
export const FAMILY_UNITS = Object.freeze({
  count: ['count', 'dozen'],
  volume: ['tsp', 'tbsp', 'cup', 'fl-oz', 'ml', 'l'],
  weight: ['oz', 'lb', 'g', 'kg'],
});

const UNIT_FACTORS = Object.freeze({
  count: 1, dozen: 12,
  tsp: 1 / 6, tbsp: 0.5, cup: 8, 'fl-oz': 1, ml: 0.035274, l: 35.274,
  oz: 1, lb: 16, g: 0.035274, kg: 35.274,
});
const FRACTIONS = Object.freeze({ '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 });
const MAX_AMOUNT = 1_000_000;
const SAFE_TEXT = /^[^<>\x00-\x1f\x7f]{1,80}$/;

// Leaf words are ingredient identity, not generic packaging/count suffixes. Only
// culinary plants whose plain and leaf forms are unambiguous aliases opt in.
const LEAF_BASE_ALIASES = new Set([
  'basil', 'cilantro', 'coriander', 'dill', 'kale', 'mint', 'oregano',
  'parsley', 'rosemary', 'sage', 'spinach', 'thyme',
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const round = (value) => Math.round((Number(value) + Number.EPSILON) * 1e9) / 1e9;

/**
 * Exact normalized identities plus explicit culinary leaf aliases. Compounds
 * remain intact, so basil cannot match basilisk or sauce and bottle gourd does
 * not collapse to gourd.
 */
export function canonicalIngredientVariants(value) {
  const exact = canonicalName(value);
  if (!exact || exact === 'uncertain ingredient') return [];
  const variants = new Set([exact]);
  const words = exact.split(/\s+/).filter(Boolean);
  const leafSuffix = words.length > 1 && ['leaf', 'leaves'].includes(words.at(-1));
  const leafBase = leafSuffix ? canonicalName(words.slice(0, -1).join(' ')) : '';
  if (leafSuffix) variants.add(`${leafBase} ${words.at(-1) === 'leaf' ? 'leaves' : 'leaf'}`);
  if (leafBase && LEAF_BASE_ALIASES.has(leafBase)) variants.add(leafBase);
  if (LEAF_BASE_ALIASES.has(exact)) {
    variants.add(`${exact} leaf`);
    variants.add(`${exact} leaves`);
  }
  return [...variants].sort(compareText);
}

export function canonicalIngredientIdentity(value) {
  return canonicalIngredientVariants(value)
    .sort((left, right) => left.split(' ').length - right.split(' ').length
      || left.length - right.length || compareText(left, right))[0] || '';
}

export function canonicalIngredientsMatch(left, right) {
  const rightVariants = new Set(canonicalIngredientVariants(right));
  return canonicalIngredientVariants(left).some((variant) => rightVariants.has(variant));
}

function legacyHashText(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// Four independently mixed 32-bit lanes provide 128 bits of identity space
// while remaining synchronous in every supported browser. The prior 32-bit
// FNV ID remains only as a migration key and is never trusted without matching
// immutable raw evidence.
function hash128(value) {
  const text = String(value);
  let a = 0x9e3779b9; let b = 0x243f6a88; let c = 0xb7e15162; let d = 0xdeadbeef;
  for (const character of text) {
    const code = character.codePointAt(0);
    a = Math.imul(a ^ code, 0x85ebca6b);
    b = Math.imul(b ^ code, 0xc2b2ae35);
    c = Math.imul(c ^ code, 0x27d4eb2f);
    d = Math.imul(d ^ code, 0x165667b1);
    a ^= b >>> 13; b ^= c >>> 11; c ^= d >>> 17; d ^= a >>> 15;
  }
  return [a, b, c, d].map((lane, index, all) => {
    let mixed = lane ^ (text.length + index);
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
    mixed ^= mixed >>> 16;
    mixed ^= all[(index + 1) % all.length] >>> ((index + 3) * 3);
    return (mixed >>> 0).toString(16).padStart(8, '0');
  }).join('');
}

function legacyEvidenceId(raw, occurrence = 0) {
  return `ingredient-${legacyHashText(String(raw))}-${Math.max(0, Number(occurrence) || 0)}`;
}

export function ingredientEvidenceId(raw, occurrence = 0) {
  return `ingredient-v2-${hash128(String(raw))}-${Math.max(0, Number(occurrence) || 0)}`;
}

function numberToken(value) {
  const token = String(value || '').trim();
  if (FRACTIONS[token] != null) return FRACTIONS[token];
  if (/^\d+\/\d+$/.test(token)) {
    const [numerator, denominator] = token.split('/').map(Number);
    return denominator ? numerator / denominator : null;
  }
  const numeric = Number(token);
  return Number.isFinite(numeric) ? numeric : null;
}

function quantityPart(value) {
  const parts = String(value || '').trim().split(/\s+/);
  if (!parts.length || parts.length > 2) return null;
  const first = numberToken(parts[0]);
  if (first == null) return null;
  if (parts.length === 1) return first;
  const second = numberToken(parts[1]);
  return second == null ? null : first + second;
}

export function parseCorrectionAmount(value) {
  const text = String(value || '').trim().replace(/[–—]/g, '-');
  const range = text.match(/^(.+?)\s*(?:-|\bto\b)\s*(.+)$/i);
  const values = range ? [quantityPart(range[1]), quantityPart(range[2])] : [quantityPart(text)];
  if (values.some((item) => item == null || item <= 0 || item > MAX_AMOUNT)) {
    return { ok: false, error: 'Enter a positive number, fraction, mixed number, or range.' };
  }
  if (values.length === 2 && values[0] > values[1]) {
    return { ok: false, error: 'The start of the range must not exceed the end.' };
  }
  return values.length === 2
    ? { ok: true, quantityState: 'range', min: values[0], max: values[1], text }
    : { ok: true, quantityState: 'scalar', min: values[0], max: values[0], text };
}

function displayName(name) {
  return name.split(/\s+/).map((word) => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}

export function validateIngredientCorrection(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rawName = typeof source.name === 'string' ? source.name.trim() : '';
  if (!SAFE_TEXT.test(rawName)) return { ok: false, field: 'name', error: 'Enter an ingredient name without markup or control characters.' };
  const name = canonicalName(rawName);
  if (!name || name === 'uncertain ingredient') return { ok: false, field: 'name', error: 'Enter a specific ingredient name.' };
  const amountState = AMOUNT_STATES.includes(source.amountState) ? source.amountState : '';
  if (!amountState) return { ok: false, field: 'amountState', error: 'Choose how the amount is expressed.' };
  const base = {
    name,
    displayName: displayName(name),
    amountState,
    category: normalizeIngredient(name).category,
    confidence: 1,
    reviewVersion: INGREDIENT_REVIEW_VERSION,
  };
  if (amountState !== 'numeric') {
    return {
      ok: true,
      correction: {
        ...base,
        quantity: null,
        quantityState: amountState,
        measurementFamily: null,
        sourceUnit: null,
        unit: 'qualitative',
        kind: 'qualitative',
        countLabel: '',
      },
    };
  }

  const amount = parseCorrectionAmount(source.amount);
  if (!amount.ok) return { ok: false, field: 'amount', error: amount.error };
  const measurementFamily = MEASUREMENT_FAMILIES.includes(source.measurementFamily) ? source.measurementFamily : '';
  if (!measurementFamily) return { ok: false, field: 'measurementFamily', error: 'Choose count, volume, or weight.' };
  const sourceUnit = FAMILY_UNITS[measurementFamily].includes(source.sourceUnit) ? source.sourceUnit : '';
  if (!sourceUnit) return { ok: false, field: 'sourceUnit', error: 'Choose a unit for this measurement family.' };
  const factor = UNIT_FACTORS[sourceUnit];
  const countLabel = measurementFamily === 'count' && COUNT_LABELS.includes(source.countLabel) ? source.countLabel : '';
  return {
    ok: true,
    correction: {
      ...base,
      amount: amount.text,
      quantity: round(amount.max * factor),
      ...(amount.quantityState === 'range' ? { quantityMin: round(amount.min * factor) } : {}),
      quantityState: amount.quantityState,
      measurementFamily,
      sourceUnit,
      unit: measurementFamily === 'count' ? 'count' : 'ounce',
      kind: measurementFamily === 'count' ? 'indivisible' : 'divisible',
      countLabel,
    },
  };
}

function reviewedRecord(record) {
  if (!record || typeof record !== 'object'
      || typeof record.id !== 'string' || !record.id
      || typeof record.raw !== 'string' || !record.raw.trim()
      || record.reviewStatus !== 'reviewed'
      || !Number.isInteger(record.parserVersion) || record.parserVersion <= 0
      || !Number.isFinite(record.reviewedAt) || record.reviewedAt <= 0
      || !isNormalizedIngredient(record)) return false;
  const validated = validateIngredientCorrection(record);
  if (!validated.ok) return false;
  const expected = validated.correction;
  return [
    'name', 'displayName', 'amountState', 'quantity', 'quantityMin', 'quantityState',
    'measurementFamily', 'sourceUnit', 'unit', 'kind', 'countLabel', 'category',
    'confidence', 'reviewVersion',
  ].every((key) => Object.is(record[key], expected[key]));
}

function reviewedWinner(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (right.reviewedAt !== left.reviewedAt) return right.reviewedAt > left.reviewedAt ? right : left;
  const correctionKey = (record) => {
    const validated = validateIngredientCorrection(record);
    return JSON.stringify({
      id: record.id,
      raw: record.raw,
      parserVersion: record.parserVersion,
      reviewVersion: record.reviewVersion ?? null,
      correction: validated.ok ? validated.correction : null,
    });
  };
  return correctionKey(right) < correctionKey(left) ? right : left;
}

function legacyNormalizedRecord(record) {
  const hasReviewMetadata = ['reviewStatus', 'reviewVersion', 'reviewedAt', 'reviewedBy', 'parserVersion']
    .some((key) => Object.hasOwn(record || {}, key));
  if (!record || typeof record !== 'object' || hasReviewMetadata || !isNormalizedIngredient(record)) return false;
  const name = canonicalName(record.name);
  return Boolean(name && name !== 'uncertain ingredient');
}

function compatibilityMetadata(record) {
  const amountState = AMOUNT_STATES.includes(record.amountState)
    ? record.amountState
    : record.quantity == null ? 'qualitative' : 'numeric';
  const measurementFamily = MEASUREMENT_FAMILIES.includes(record.measurementFamily)
    ? record.measurementFamily : record.unit === 'count' ? 'count' : null;
  const compatibleSourceUnit = measurementFamily && FAMILY_UNITS[measurementFamily]?.includes(record.sourceUnit)
    ? record.sourceUnit : record.unit === 'count' ? 'count' : null;
  return {
    ...clone(record),
    amountState,
    measurementFamily,
    sourceUnit: compatibleSourceUnit,
    reviewStatus: 'unreviewed',
    parserVersion: Number.isInteger(record.parserVersion) && record.parserVersion > 0
      ? record.parserVersion
      : NORMALIZATION_VERSION,
  };
}

function ingredientSources(recipe) {
  return (Array.isArray(recipe?.recipeIngredient) ? recipe.recipeIngredient : [])
    .filter((entry) => (typeof entry === 'string' && entry.trim())
      || (entry && typeof entry === 'object' && typeof entry.raw === 'string' && entry.raw.trim()));
}

function baseIngredientEvidence(recipe) {
  const normalizations = Array.isArray(recipe?.ingredientNormalizations) ? recipe.ingredientNormalizations : [];
  const normalizationByEvidence = new Map();
  const anonymousByRaw = new Map();
  for (const record of normalizations) {
    if (typeof record?.raw !== 'string' || !legacyNormalizedRecord(record)) continue;
    if (typeof record.id === 'string' && record.id) {
      const key = `${record.raw}\u0000${record.id}`;
      if (!normalizationByEvidence.has(key)) normalizationByEvidence.set(key, record);
    } else if (!anonymousByRaw.has(record.raw)) {
      anonymousByRaw.set(record.raw, record);
    }
  }
  const occurrences = new Map();
  return ingredientSources(recipe).map((source) => {
    const raw = typeof source === 'string' ? source : source.raw;
    const occurrence = occurrences.get(raw) || 0;
    occurrences.set(raw, occurrence + 1);
    const id = ingredientEvidenceId(raw, occurrence);
    const legacyId = legacyEvidenceId(raw, occurrence);
    const cached = normalizationByEvidence.get(`${raw}\u0000${id}`)
      || normalizationByEvidence.get(`${raw}\u0000${legacyId}`)
      || anonymousByRaw.get(raw);
    const structured = typeof source === 'object' && legacyNormalizedRecord(source) ? source : null;
    const parsed = normalizeIngredient(raw);
    return {
      ...compatibilityMetadata(cached || structured || parsed),
      raw,
      id,
      evidenceOccurrence: occurrence,
    };
  });
}

export function ingredientEvidence(recipe) {
  const normalizations = Array.isArray(recipe?.ingredientNormalizations) ? recipe.ingredientNormalizations : [];
  const reviewedByEvidence = new Map();
  for (const record of normalizations) {
    if (!reviewedRecord(record)) continue;
    const key = `${record.raw}\u0000${record.id}`;
    const current = reviewedByEvidence.get(key);
    reviewedByEvidence.set(key, reviewedWinner(current, record));
  }
  return baseIngredientEvidence(recipe).map((base) => {
    const legacyId = legacyEvidenceId(base.raw, base.evidenceOccurrence);
    const current = reviewedByEvidence.get(`${base.raw}\u0000${base.id}`);
    const legacy = reviewedByEvidence.get(`${base.raw}\u0000${legacyId}`);
    const reviewed = reviewedWinner(current, legacy);
    return reviewed ? { ...clone(reviewed), id: base.id, evidenceOccurrence: base.evidenceOccurrence } : base;
  });
}

export function buildReviewedIngredientRecord({ id, raw, correction, reviewer, reviewedAt = Date.now() } = {}) {
  const validation = validateIngredientCorrection(correction);
  if (!validation.ok || typeof id !== 'string' || !id || typeof raw !== 'string' || !raw.trim()) return validation.ok ? { ok: false, error: 'Ingredient evidence was not found.' } : validation;
  const actor = reviewer && typeof reviewer.sub === 'string' && reviewer.sub
    ? { sub: reviewer.sub, name: typeof reviewer.name === 'string' && reviewer.name.trim() ? reviewer.name.trim().slice(0, 100) : 'Household member' }
    : null;
  return {
    ok: true,
    record: {
      id,
      raw,
      ...validation.correction,
      reviewStatus: 'reviewed',
      parserVersion: NORMALIZATION_VERSION,
      reviewedAt: Number(reviewedAt),
      ...(actor ? { reviewedBy: actor } : {}),
    },
  };
}

export function applyReviewedIngredientCorrection(recipe, { ingredientId, correction, reviewer, reviewedAt } = {}) {
  const evidence = ingredientEvidence(recipe).find((item) => item.id === ingredientId);
  if (!evidence) return { ok: false, error: 'Ingredient evidence changed. Reload and try again.' };
  const built = buildReviewedIngredientRecord({ id: evidence.id, raw: evidence.raw, correction, reviewer, reviewedAt });
  if (!built.ok) return built;
  const records = (Array.isArray(recipe?.ingredientNormalizations) ? recipe.ingredientNormalizations : [])
    .filter((item) => {
      if (!(reviewedRecord(item) || legacyNormalizedRecord(item))) return false;
      if (item.raw !== evidence.raw) return true;
      return item.id !== ingredientId && item.id !== legacyEvidenceId(evidence.raw, evidence.evidenceOccurrence);
    });
  return { ok: true, recipe: { ...clone(recipe), ingredientNormalizations: [...records.map(clone), built.record] }, record: built.record };
}

export function preserveReviewedIngredientCorrections(existingRecipe, incomingRecipe) {
  const incoming = clone(incomingRecipe || {});
  const saved = (Array.isArray(existingRecipe?.ingredientNormalizations) ? existingRecipe.ingredientNormalizations : []).filter(reviewedRecord);
  const savedIds = new Set(saved.map((record) => record.id));
  const compatibleIncoming = (Array.isArray(incoming.ingredientNormalizations) ? incoming.ingredientNormalizations : [])
    .filter((record) => legacyNormalizedRecord(record) && !savedIds.has(record.id));
  const records = [...compatibleIncoming.map(clone), ...saved.map(clone)];
  if (records.length) incoming.ingredientNormalizations = records;
  else delete incoming.ingredientNormalizations;
  return incoming;
}

export function effectiveIngredientRecords(recipe) {
  return ingredientEvidence(recipe);
}

/**
 * Async equivalent used by responsive discovery projection. The callback returns
 * a promise only when the shared ingredient budget is exhausted, avoiding one
 * microtask per ingredient while preserving the synchronous public path.
 */
export async function effectiveIngredientRecordsYielded(recipe, yieldIngredient = null) {
  const normalizations = Array.isArray(recipe?.ingredientNormalizations) ? recipe.ingredientNormalizations : [];
  const reviewedByEvidence = new Map();
  const normalizationByEvidence = new Map();
  const anonymousByRaw = new Map();

  for (const record of normalizations) {
    if (reviewedRecord(record)) {
      const key = `${record.raw}\u0000${record.id}`;
      reviewedByEvidence.set(key, reviewedWinner(reviewedByEvidence.get(key), record));
    }
    if (typeof record?.raw === 'string' && legacyNormalizedRecord(record)) {
      if (typeof record.id === 'string' && record.id) {
        const key = `${record.raw}\u0000${record.id}`;
        if (!normalizationByEvidence.has(key)) normalizationByEvidence.set(key, record);
      } else if (!anonymousByRaw.has(record.raw)) {
        anonymousByRaw.set(record.raw, record);
      }
    }
    const pending = yieldIngredient?.();
    if (pending) await pending;
  }

  const occurrences = new Map();
  const baseRecords = [];
  const sources = Array.isArray(recipe?.recipeIngredient) ? recipe.recipeIngredient : [];
  for (const source of sources) {
    const valid = (typeof source === 'string' && source.trim())
      || (source && typeof source === 'object' && typeof source.raw === 'string' && source.raw.trim());
    if (valid) {
      const raw = typeof source === 'string' ? source : source.raw;
      const occurrence = occurrences.get(raw) || 0;
      occurrences.set(raw, occurrence + 1);
      const id = ingredientEvidenceId(raw, occurrence);
      const legacyId = legacyEvidenceId(raw, occurrence);
      const cached = normalizationByEvidence.get(`${raw}\u0000${id}`)
        || normalizationByEvidence.get(`${raw}\u0000${legacyId}`)
        || anonymousByRaw.get(raw);
      const structured = typeof source === 'object' && legacyNormalizedRecord(source) ? source : null;
      const parsed = normalizeIngredient(raw);
      baseRecords.push({
        ...compatibilityMetadata(cached || structured || parsed),
        raw,
        id,
        evidenceOccurrence: occurrence,
      });
    }
    const pending = yieldIngredient?.();
    if (pending) await pending;
  }

  const effective = [];
  for (const base of baseRecords) {
    const legacyId = legacyEvidenceId(base.raw, base.evidenceOccurrence);
    const current = reviewedByEvidence.get(`${base.raw}\u0000${base.id}`);
    const legacy = reviewedByEvidence.get(`${base.raw}\u0000${legacyId}`);
    const reviewed = reviewedWinner(current, legacy);
    effective.push(reviewed
      ? { ...clone(reviewed), id: base.id, evidenceOccurrence: base.evidenceOccurrence }
      : base);
    const pending = yieldIngredient?.();
    if (pending) await pending;
  }
  return effective;
}

const SOURCE_UNIT_ALIASES = Object.freeze({
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', 'fl oz': 'fl-oz', 'fluid ounce': 'fl-oz', 'fluid ounces': 'fl-oz',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg', count: 'count', dozen: 'dozen',
});
const QUANTITY_SOURCE = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])';

function sourceProjection(record) {
  const raw = String(record?.raw || '').trim().replace(/[–—]/g, '-');
  const units = Object.keys(SOURCE_UNIT_ALIASES).sort((a, b) => b.length - a.length)
    .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = raw.match(new RegExp(`^(${QUANTITY_SOURCE}(?:\\s*(?:-|to\\b)\\s*${QUANTITY_SOURCE})?)\\s*(${units})\\b`, 'i'));
  if (!match) return null;
  const sourceUnit = SOURCE_UNIT_ALIASES[match[2].toLowerCase()];
  const measurementFamily = sourceUnit === 'count' || sourceUnit === 'dozen' ? 'count'
    : ['tsp', 'tbsp', 'cup', 'fl-oz', 'ml', 'l'].includes(sourceUnit) ? 'volume' : 'weight';
  const parsed = parseCorrectionAmount(match[1]);
  if (!parsed.ok) return null;
  const factor = UNIT_FACTORS[sourceUnit];
  if (record.quantity == null || Math.abs(Number(record.quantity) - round(parsed.max * factor)) > 1e-7) return null;
  if (record.quantityMin != null && Math.abs(Number(record.quantityMin) - round(parsed.min * factor)) > 1e-7) return null;
  return { amount: match[1], measurementFamily, sourceUnit };
}

export function ingredientEditorProjection(record) {
  const amountState = AMOUNT_STATES.includes(record?.amountState)
    ? record.amountState : record?.quantity == null ? 'qualitative' : 'numeric';
  const base = { name: canonicalName(record?.name), amountState, countLabel: record?.countLabel || '' };
  if (amountState !== 'numeric') return base;
  if (record?.reviewStatus === 'reviewed'
      && MEASUREMENT_FAMILIES.includes(record.measurementFamily)
      && FAMILY_UNITS[record.measurementFamily]?.includes(record.sourceUnit)) {
    return { ...base,
      amount: String(record.amount || (record.quantityState === 'range' && record.quantityMin != null
        ? `${record.quantityMin} to ${record.quantity}` : record.quantity)),
      measurementFamily: record.measurementFamily, sourceUnit: record.sourceUnit };
  }
  const reconstructed = sourceProjection(record);
  if (reconstructed) return { ...base, ...reconstructed };
  if (record?.unit === 'count') return { ...base, amount: String(record.quantity), measurementFamily: 'count', sourceUnit: 'count' };
  // Legacy canonical ounces omit the source family. Literal canonical ounces
  // are lossless; selecting a teaspoon default is not.
  return { ...base, amount: String(record?.quantity), measurementFamily: 'weight', sourceUnit: 'oz' };
}

function effectiveSignature(records) {
  return JSON.stringify(records.map((item) => ({
    id: item.id, raw: item.raw, name: item.name, amountState: item.amountState,
    quantity: item.quantity, quantityMin: item.quantityMin, quantityState: item.quantityState,
    unit: item.unit, measurementFamily: item.measurementFamily, sourceUnit: item.sourceUnit,
    countLabel: item.countLabel, reviewVersion: item.reviewVersion || 0, reviewedAt: item.reviewedAt || 0,
  })));
}

export function recipeEffectiveSignature(recipe) {
  return effectiveSignature(effectiveIngredientRecords(recipe));
}

export function applyIngredientTombstones(ingredients, removedIngredientNames) {
  const normalizedNames = [...new Set((Array.isArray(removedIngredientNames) ? removedIngredientNames : [])
    .map(canonicalName).filter(Boolean))];
  const removed = new Set(normalizedNames);
  return {
    removedIngredientNames: normalizedNames,
    ingredients: (Array.isArray(ingredients) ? ingredients : []).filter((ingredient) => {
      const effectiveName = canonicalName(ingredient?.name);
      const rawName = canonicalName(normalizeIngredient(ingredient?.raw).name);
      return !removed.has(effectiveName) && !removed.has(rawName);
    }).map(clone),
  };
}

export function reconcileReviewedRecipesInCart(cart, recipes) {
  const recipeMap = new Map((Array.isArray(recipes) ? recipes : []).map((recipe) => [String(recipe?._id || recipe?.id || recipe?.recipeId || ''), recipe]));
  return (Array.isArray(cart) ? cart : []).map((selection) => {
    const recipe = recipeMap.get(String(selection?.sourceRecipeId || selection?.recipeId || ''));
    if (!recipe) return clone(selection);
    const effective = effectiveIngredientRecords(recipe);
    const signature = recipeEffectiveSignature(recipe);
    if (!effective.some((ingredient) => ingredient.reviewStatus === 'reviewed') && !selection.effectiveSignature) {
      return clone(selection);
    }
    if (selection.effectiveSignature === signature) return clone(selection);
    const projected = applyIngredientTombstones(effective, selection.removedIngredientNames);
    const reconciled = { ...clone(selection), recipeName: String(recipe.name || selection.recipeName),
      ingredients: projected.ingredients, effectiveSignature: signature };
    if (projected.removedIngredientNames.length || Object.hasOwn(selection, 'removedIngredientNames')) {
      reconciled.removedIngredientNames = projected.removedIngredientNames;
    }
    return reconciled;
  });
}

export function reviewedShoppingCheckedKeys(shoppingChecked, previous, next) {
  const checked = shoppingChecked && typeof shoppingChecked === 'object' ? shoppingChecked : {};
  const migrated = new Set();
  const nextByRaw = new Map();
  for (const ingredient of Array.isArray(next?.ingredients) ? next.ingredients : []) {
    const raw = String(ingredient?.raw || '');
    const rows = nextByRaw.get(raw) || [];
    rows.push(ingredient);
    nextByRaw.set(raw, rows);
  }
  const occurrences = new Map();
  for (const ingredient of Array.isArray(previous?.ingredients) ? previous.ingredients : []) {
    const raw = String(ingredient?.raw || '');
    const occurrence = occurrences.get(raw) || 0;
    occurrences.set(raw, occurrence + 1);
    const replacement = nextByRaw.get(raw)?.[occurrence];
    const previousName = canonicalName(ingredient?.name);
    const nextName = canonicalName(replacement?.name);
    if (!previousName || !nextName || previousName === nextName) continue;
    if (checked[previousName] === true) migrated.add(nextName);
    if (checked[`pantry-transfer:${previousName}`] === true) migrated.add(`pantry-transfer:${nextName}`);
  }
  return [...migrated].sort(compareText);
}

export function reconcileReviewedShoppingChecked(shoppingChecked, previousCart, reconciledCart) {
  const checked = clone(shoppingChecked && typeof shoppingChecked === 'object' ? shoppingChecked : {});
  const nextByRecipe = new Map((Array.isArray(reconciledCart) ? reconciledCart : []).map((selection) => [
    String(selection?.recipeId || ''), selection,
  ]));
  for (const previous of Array.isArray(previousCart) ? previousCart : []) {
    const next = nextByRecipe.get(String(previous?.recipeId || ''));
    if (!next) continue;
    for (const key of reviewedShoppingCheckedKeys(checked, previous, next)) checked[key] = true;
  }
  return checked;
}

function pluralCountLabel(label, quantity) {
  if (!label) return '';
  if (Number(quantity) === 1) return label;
  if (label === 'leaf') return 'leaves';
  return `${label}s`;
}

export function formatEffectiveIngredient(record) {
  if (!record || typeof record !== 'object') return '';
  if (record.reviewStatus !== 'reviewed') return String(record.raw || '');
  if (record.amountState === 'unknown') return `${record.name} — amount unknown`;
  if (record.amountState === 'qualitative') return `${record.name} — as needed`;
  const amount = String(record.amount || record.quantity || '').replace(/\s+(?:to|-|–|—)\s+/i, '–');
  if (record.measurementFamily === 'count') {
    const label = pluralCountLabel(record.countLabel, record.quantityState === 'range' ? 2 : record.quantity);
    if (record.sourceUnit === 'dozen') return `${amount} dozen ${record.name}`.replace(/\s+/g, ' ').trim();
    return `${amount} ${record.name}${label ? ` ${label}` : ''}`.replace(/\s+/g, ' ').trim();
  }
  const units = { tsp: 'tsp', tbsp: 'tbsp', cup: 'cup', 'fl-oz': 'fl oz', ml: 'ml', l: 'l', oz: 'oz', lb: 'lb', g: 'g', kg: 'kg' };
  return `${amount} ${units[record.sourceUnit] || record.sourceUnit} ${record.name}`.replace(/\s+/g, ' ').trim();
}

export function effectiveIngredientLines(recipe) {
  return effectiveIngredientRecords(recipe).map(formatEffectiveIngredient);
}

export function recipeUsageIdentity(recipe, effective = effectiveIngredientRecords(recipe)) {
  const id = String(recipe?._id || recipe?.id || '');
  if (id) return `id:${id}`;
  const recipeName = String(recipe?.name || 'Untitled');
  return `derived:${hash128(`${recipeName}\u0000${effectiveSignature(effective)}`)}`;
}

export function recipeUsageCandidateKey(recipe, effective = effectiveIngredientRecords(recipe)) {
  return `${String(recipe?.name || 'Untitled')}\u0000${effectiveSignature(effective)}`;
}

export function buildRecipeUsageIndex(recipes) {
  const byRecipe = new Map();
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const id = String(recipe?._id || recipe?.id || '');
    const recipeName = String(recipe?.name || 'Untitled');
    const effective = effectiveIngredientRecords(recipe);
    const recipeIdentity = recipeUsageIdentity(recipe, effective);
    const unique = new Map();
    for (const ingredient of effective) {
      const identity = canonicalIngredientIdentity(ingredient.name);
      if (!identity) continue;
      const current = unique.get(identity);
      if (!current || compareText(JSON.stringify(ingredient), JSON.stringify(current)) < 0) unique.set(identity, ingredient);
    }
    const candidate = { recipeId: id || recipeIdentity, recipeIdentity, recipeName, unique };
    const current = byRecipe.get(recipeIdentity);
    const candidateKey = recipeUsageCandidateKey(recipe, effective);
    if (!current || compareText(candidateKey, current.key) < 0) byRecipe.set(recipeIdentity, { key: candidateKey, candidate });
  }

  const index = new Map();
  for (const { candidate } of byRecipe.values()) {
    const { recipeId, recipeIdentity, recipeName, unique } = candidate;
    for (const [identity, ingredient] of unique.entries()) {
      if (!index.has(identity)) index.set(identity, []);
      index.get(identity).push({ recipeId, recipeIdentity, recipeName, ingredient: clone(ingredient) });
    }
  }
  for (const uses of index.values()) uses.sort((a, b) => compareText(a.recipeName, b.recipeName)
    || compareText(a.recipeIdentity, b.recipeIdentity));
  return {
    find(name) { return clone(index.get(canonicalIngredientIdentity(name)) || []); },
    entries() { return [...index.entries()].sort(([a], [b]) => compareText(a, b)).map(([name, uses]) => [name, clone(uses)]); },
  };
}
