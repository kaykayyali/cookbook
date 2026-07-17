import {
  canonicalName,
  normalizeIngredient,
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

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value) => Math.round((Number(value) + Number.EPSILON) * 1e9) / 1e9;

function hashText(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function ingredientEvidenceId(raw, occurrence = 0) {
  return `ingredient-${hashText(String(raw))}-${Math.max(0, Number(occurrence) || 0)}`;
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
  return record && typeof record === 'object'
    && typeof record.id === 'string'
    && typeof record.raw === 'string'
    && record.reviewStatus === 'reviewed'
    && Number.isInteger(record.parserVersion)
    && record.parserVersion > 0;
}

export function ingredientEvidence(recipe) {
  const lines = Array.isArray(recipe?.recipeIngredient)
    ? recipe.recipeIngredient.filter((line) => typeof line === 'string' && line.trim())
    : [];
  const occurrences = new Map();
  const existing = new Map((Array.isArray(recipe?.ingredientNormalizations) ? recipe.ingredientNormalizations : [])
    .filter(reviewedRecord).map((record) => [record.id, record]));
  return lines.map((raw) => {
    const occurrence = occurrences.get(raw) || 0;
    occurrences.set(raw, occurrence + 1);
    const id = ingredientEvidenceId(raw, occurrence);
    const saved = existing.get(id);
    return saved && saved.raw === raw
      ? clone(saved)
      : { id, raw, reviewStatus: 'unreviewed', parserVersion: NORMALIZATION_VERSION };
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
    .filter((item) => reviewedRecord(item) && item.id !== ingredientId);
  return { ok: true, recipe: { ...clone(recipe), ingredientNormalizations: [...records, built.record] }, record: built.record };
}

export function preserveReviewedIngredientCorrections(existingRecipe, incomingRecipe) {
  const incoming = clone(incomingRecipe || {});
  const saved = (Array.isArray(existingRecipe?.ingredientNormalizations) ? existingRecipe.ingredientNormalizations : []).filter(reviewedRecord);
  if (saved.length) incoming.ingredientNormalizations = saved.map(clone);
  else delete incoming.ingredientNormalizations;
  return incoming;
}

export function effectiveIngredientRecords(recipe) {
  return ingredientEvidence(recipe).map((evidence) => {
    if (evidence.reviewStatus === 'reviewed') return clone(evidence);
    const parsed = normalizeIngredient(evidence.raw);
    return {
      id: evidence.id,
      ...parsed,
      amountState: parsed.quantity == null ? 'qualitative' : 'numeric',
      measurementFamily: parsed.unit === 'count' ? 'count' : parsed.unit === 'ounce' ? 'volume' : null,
      sourceUnit: parsed.unit,
      reviewStatus: 'unreviewed',
      parserVersion: NORMALIZATION_VERSION,
    };
  });
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

export function buildRecipeUsageIndex(recipes) {
  const index = new Map();
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const id = String(recipe?._id || recipe?.id || '');
    for (const ingredient of effectiveIngredientRecords(recipe)) {
      if (!index.has(ingredient.name)) index.set(ingredient.name, []);
      index.get(ingredient.name).push({ recipeId: id, recipeName: String(recipe?.name || 'Untitled'), ingredient: clone(ingredient) });
    }
  }
  return {
    find(name) { return clone(index.get(canonicalName(name)) || []); },
    entries() { return [...index.entries()].map(([name, uses]) => [name, clone(uses)]); },
  };
}
