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
 * Matching uses canonical whole phrases: pantry "olive oil" matches
 * "2 tbsp extra virgin olive oil", but "egg" does not match "eggplant".
 * @param {string} ing recipe ingredient line
 * @param {string[]} pantry lowercase pantry names
 * @returns {boolean}
 */
export function haveIngredient(ing, pantry) {
  if (typeof ing !== 'string') return false;
  const ingredientName = normalizeIngredient(ing).name;
  return (Array.isArray(pantry) ? pantry : []).some((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (typeof name !== 'string') return false;
    const canonical = canonicalName(name);
    const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i').test(ingredientName);
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

export const PANTRY_RECORD_VERSION = 1;
export const PANTRY_CONFIDENCE_THRESHOLD = 0.7;
const MAX_PANTRY_NORMALIZATION_VERSION = 1_000;
const MAX_PANTRY_TIMESTAMP = 8_640_000_000_000_000;
const MAX_PANTRY_EDITOR_AMOUNT = 1_000_000;
const MAX_PANTRY_CANONICAL_QUANTITY = 1_000_000_000;
export const PANTRY_RAW_EVIDENCE_LIMITS = Object.freeze({
  maxPrimaryBytes: 512,
  maxEntryBytes: 512,
  maxTotalBytes: 4096,
  maxEntries: 16,
});

const PANTRY_EDITOR_UNIT_GROUPS = Object.freeze({
  count: Object.freeze([
    ['item', 'Items', 1, ''],
    ['clove', 'Cloves', 1, 'clove'],
    ['slice', 'Slices', 1, 'slice'],
    ['sheet', 'Sheets', 1, 'sheet'],
    ['portion', 'Portions', 1, 'portion'],
    ['can', 'Cans', 1, 'can'],
    ['jar', 'Jars', 1, 'jar'],
    ['bottle', 'Bottles', 1, 'bottle'],
    ['package', 'Packages', 1, 'package'],
    ['piece', 'Pieces', 1, 'piece'],
  ]),
  solid: Object.freeze([
    ['ounce', 'Ounces', 1],
    ['pound', 'Pounds', 16],
    ['gram', 'Grams', 0.035274],
    ['kilogram', 'Kilograms', 35.274],
  ]),
  fluid: Object.freeze([
    ['teaspoon', 'Teaspoons', 1 / 6],
    ['tablespoon', 'Tablespoons', 0.5],
    ['fluid-ounce', 'Fluid ounces', 1],
    ['cup', 'Cups', 8],
    ['milliliter', 'Milliliters', 0.035274],
    ['liter', 'Liters', 35.274],
  ]),
  unknown: Object.freeze([]),
});

const EDITOR_UNIT_BY_VALUE = new Map(Object.entries(PANTRY_EDITOR_UNIT_GROUPS)
  .flatMap(([family, units]) => units.map(([value, label, factor, countLabel = '']) => [
    value, { value, label, factor, countLabel, family },
  ])));
const EDITOR_DEFAULT_UNIT = Object.freeze({ count: 'item', solid: 'ounce', fluid: 'cup', unknown: '' });

/** Family-specific unit choices for the Pantry editor. */
export function pantryUnitsForFamily(family) {
  return (PANTRY_EDITOR_UNIT_GROUPS[family] || []).map(([value, label]) => ({ value, label }));
}

function editorRound(value) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(6));
}

/** Convert between editor units through the app's canonical water-equivalent ounce. */
export function convertPantryEditorAmount(quantity, fromUnit, toUnit) {
  const amount = Number(quantity);
  const from = EDITOR_UNIT_BY_VALUE.get(fromUnit);
  const to = EDITOR_UNIT_BY_VALUE.get(toUnit);
  if (!Number.isFinite(amount) || amount < 0 || !from || !to) throw new Error('invalid_pantry_editor_amount');
  return editorRound((amount * from.factor) / to.factor);
}

function inferredEditorUnit(record) {
  if (record.unit === 'count') {
    return [...EDITOR_UNIT_BY_VALUE.values()].find((unit) => unit.family === 'count'
      && unit.countLabel === record.countLabel)?.value || 'item';
  }
  const raw = String(record.raw || '').toLowerCase();
  const fluidPatterns = [
    ['fluid-ounce', /\b(?:fl\.?\s*oz|fluid ounces?)\b/],
    ['tablespoon', /\b(?:tbsp|tablespoons?)\b/],
    ['teaspoon', /\b(?:tsp|teaspoons?)\b/],
    ['milliliter', /\b(?:ml|milliliters?)\b/],
    ['liter', /\b(?:liters?|litres?)\b/],
    ['cup', /\bcups?\b/],
  ];
  const solidPatterns = [
    ['kilogram', /\b(?:kg|kilograms?)\b/],
    ['gram', /\b(?:g|grams?)\b/],
    ['pound', /\b(?:lb|lbs|pounds?)\b/],
    ['ounce', /\b(?:oz|ounces?)\b/],
  ];
  return fluidPatterns.find(([, pattern]) => pattern.test(raw))?.[0]
    || solidPatterns.find(([, pattern]) => pattern.test(raw))?.[0]
    || 'ounce';
}

/** Convert one normalized Pantry record to immediately editable display values. */
export function pantryEditorState(value) {
  const record = normalizePantryEntry(value);
  if (!record) return { name: '', quantity: '', family: 'unknown', unit: '', raw: '' };
  if (record.amountState !== 'known' || record.unit === 'qualitative') {
    return { name: record.displayName, quantity: '', family: 'unknown', unit: '', raw: record.raw };
  }
  const unit = inferredEditorUnit(record);
  const editorUnit = EDITOR_UNIT_BY_VALUE.get(unit);
  return {
    name: record.displayName,
    quantity: editorRound(record.quantity / editorUnit.factor),
    family: editorUnit.family,
    unit,
    raw: record.raw,
  };
}

function editorRaw(quantity, unit, displayName) {
  const descriptor = EDITOR_UNIT_BY_VALUE.get(unit);
  const label = descriptor?.label || '';
  const singular = Number(quantity) === 1 ? label.replace(/s$/, '') : label.toLowerCase();
  return `${editorRound(Number(quantity))} ${singular} ${displayName}`.trim();
}

/** Validate editor values and build a normalized-record-shaped correction payload. */
export function pantryRecordFromEditor(editor, original = null, options = {}) {
  const displayName = typeof editor?.name === 'string' ? editor.name.trim() : '';
  if (!displayName || displayName.length > 80 || /[<>\x00-\x1f\x7f]/.test(displayName)) {
    throw new Error('Pantry item name is required.');
  }
  const name = canonicalName(displayName);
  if (!name || name === 'uncertain ingredient') throw new Error('Pantry item name is required.');
  const family = ['count', 'solid', 'fluid', 'unknown'].includes(editor?.family) ? editor.family : '';
  if (!family) throw new Error('Choose a measurement family.');
  const source = original && typeof original === 'object' ? original : {};
  const updatedAt = finiteTimestamp(options.updatedAt) ?? finiteTimestamp(source.updatedAt) ?? 0;
  const metadata = {
    ...(safeRecordId(source.id) ? { id: source.id } : {}),
    name,
    displayName,
    category: INGREDIENT_CATEGORIES.includes(source.category) ? source.category : normalizeIngredient(displayName).category,
    confidence: family === 'unknown'
      ? (Number.isFinite(source.confidence) ? source.confidence : 0.95) : 1,
    amountSource: 'manual',
    normalizationVersion: Number.isSafeInteger(source.normalizationVersion)
      && source.normalizationVersion > 0 && source.normalizationVersion <= MAX_PANTRY_NORMALIZATION_VERSION
      ? source.normalizationVersion : PANTRY_RECORD_VERSION,
    updatedAt,
    rawEvidence: Array.isArray(source.rawEvidence) ? [...source.rawEvidence] : legacyRawValues(source.raw),
  };
  if (family === 'unknown') {
    return {
      ...metadata,
      raw: typeof source.raw === 'string' && source.raw.trim() ? source.raw.trim() : displayName,
      amountState: 'unknown',
      quantity: null,
      measurementFamily: 'unknown',
      unit: 'qualitative',
      kind: 'qualitative',
      countLabel: '',
    };
  }
  const descriptor = EDITOR_UNIT_BY_VALUE.get(editor?.unit || EDITOR_DEFAULT_UNIT[family]);
  if (!descriptor || descriptor.family !== family) throw new Error('Choose a valid unit for this measurement family.');
  const amount = Number(editor?.quantity);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PANTRY_EDITOR_AMOUNT) {
    throw new Error(`Enter an amount greater than zero and no more than ${MAX_PANTRY_EDITOR_AMOUNT}.`);
  }
  const canonicalQuantity = editorRound(amount * descriptor.factor);
  return {
    ...metadata,
    raw: editorRaw(amount, descriptor.value, displayName),
    amountState: 'known',
    quantity: canonicalQuantity,
    measurementFamily: family === 'count' ? 'count' : 'water-equivalent',
    unit: family === 'count' ? 'count' : 'ounce',
    kind: family === 'count' ? 'indivisible' : 'divisible',
    countLabel: family === 'count' ? descriptor.countLabel : '',
  };
}

const pantryKey = (item) => `${item.name}\u0000${item.unit}\u0000${item.unit === 'count' ? item.countLabel : ''}`;

/** True exactly when normal Pantry aggregation would collapse either record ordering. */
export function pantryRecordsWouldCoalesce(leftValue, rightValue) {
  const left = normalizePantryEntry(leftValue);
  const right = normalizePantryEntry(rightValue);
  if (!left || !right || left.name !== right.name) return false;
  return left.unit === 'qualitative'
    || right.unit === 'qualitative'
    || pantryKey(left) === pantryKey(right);
}

const finiteTimestamp = (value) => {
  const rounded = Math.round(Number(value));
  return Number.isSafeInteger(rounded) && rounded >= 0 && rounded <= MAX_PANTRY_TIMESTAMP
    ? rounded : null;
};

function safeRecordId(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return candidate && candidate.length <= 100 && !/[<>\x00-\x1f\x7f\s]/.test(candidate) ? candidate : '';
}

function stableHash(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deterministicRecordId(item) {
  const identity = pantryKey(item);
  return `pantry-${stableHash(identity, 2166136261)}-${stableHash([...identity].reverse().join(''), 2246822519)}`;
}

function withUniqueRecordId(item, records) {
  if (!records.some((entry) => entry.id === item.id && pantryKey(entry) !== pantryKey(item))) return item;
  const baseId = deterministicRecordId(item);
  let id = baseId;
  let suffix = 2;
  while (records.some((entry) => entry.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return { ...item, id };
}

function measurementFamily(unit) {
  if (unit === 'count') return 'count';
  if (unit === 'ounce') return 'water-equivalent';
  return 'unknown';
}

function generatedEvidence(value, source) {
  if (typeof value === 'string') return value.trim();
  const displayName = String(value?.displayName || source?.displayName || '').trim();
  const canonical = String(value?.name || source?.name || '').trim();
  const name = value?.quantity == null ? (canonical || displayName) : (displayName || canonical);
  if (!name) return '';
  if (typeof value?.quantity === 'string' && value.quantity.trim()) return `${value.quantity.trim()} ${name}`;
  if (value?.quantity != null && Number.isFinite(Number(value.quantity))) {
    const unit = String(value?.countLabel || value?.unit || '').trim();
    return `${Number(value.quantity)}${unit ? ` ${unit}` : ''} ${name}`;
  }
  return name;
}

function legacyRawValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split('; ').map((item) => item.trim()).filter(Boolean);
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function utf8Length(value) {
  return UTF8_ENCODER.encode(value).length;
}

function boundedUtf8(value, maxBytes) {
  const normalized = UTF8_DECODER.decode(UTF8_ENCODER.encode(String(value || ''))).trim();
  if (!normalized || utf8Length(normalized) <= maxBytes) return normalized;
  const output = [];
  let used = 0;
  for (const character of normalized) {
    const size = utf8Length(character);
    if (used + size > maxBytes) break;
    output.push(character);
    used += size;
  }
  return output.join('').trimEnd();
}

function sanitizedEvidenceValues(values) {
  return [...new Set(values
    .filter((value) => typeof value === 'string')
    .map((value) => boundedUtf8(value, PANTRY_RAW_EVIDENCE_LIMITS.maxEntryBytes))
    .filter(Boolean))];
}

function evidenceValues(value, source) {
  const explicit = Array.isArray(source?.rawEvidence) ? source.rawEvidence : [];
  const raw = explicit.length && typeof source?.raw === 'string'
    ? [source.raw]
    : legacyRawValues(source?.raw);
  const generated = explicit.length || raw.length ? '' : generatedEvidence(value, source);
  return sanitizedEvidenceValues([...explicit, ...raw, generated]);
}

function evidenceText(value, source, evidence) {
  if (typeof source?.raw === 'string' && source.raw.trim()) {
    if (Array.isArray(source.rawEvidence)) return source.raw;
    const legacy = legacyRawValues(source.raw);
    return legacy.at(-1) || source.raw;
  }
  if (Array.isArray(source?.raw)) return legacyRawValues(source.raw).at(-1) || '';
  if (typeof value === 'string') return value;
  return evidence.at(-1) || generatedEvidence(value, source);
}

function parsedKnownEvidence(record, value, { exactQuantity = false } = {}) {
  const parsed = normalizeIngredient(value);
  if (parsed.quantityState === 'range' || parsed.unit !== record.unit
      || canonicalName(parsed.name) !== record.name || !Number.isFinite(parsed.quantity)) return false;
  if (record.unit === 'count' && parsed.countLabel !== record.countLabel) return false;
  return !exactQuantity || Math.abs(parsed.quantity - record.quantity) < 1e-9;
}

function rankedPrimary(record, preferred, evidence) {
  const requested = boundedUtf8(preferred, PANTRY_RAW_EVIDENCE_LIMITS.maxPrimaryBytes);
  const candidates = sanitizedEvidenceValues([...evidence, requested]);
  if (record.amountState !== 'known') return requested || candidates.at(-1) || '';
  // Known amounts rank exact quantity/unit evidence first, then numeric evidence
  // from the same unit family. Qualitative context can never displace either.
  const exact = candidates.filter((value) => parsedKnownEvidence(record, value, { exactQuantity: true }));
  if (requested && exact.includes(requested)) return requested;
  if (exact.length) return exact.at(-1);
  if (requested && parsedKnownEvidence(record, requested)) return requested;
  const compatible = candidates.filter((value) => parsedKnownEvidence(record, value));
  if (compatible.length) return compatible.at(-1);
  return boundedUtf8(generatedEvidence(record, record), PANTRY_RAW_EVIDENCE_LIMITS.maxPrimaryBytes);
}

function boundedEvidence(evidence, primary) {
  const candidates = sanitizedEvidenceValues([...evidence, primary]);
  const selected = new Set();
  let totalBytes = 0;
  const retain = (value) => {
    if (!value || selected.has(value) || selected.size >= PANTRY_RAW_EVIDENCE_LIMITS.maxEntries) return;
    const size = utf8Length(value);
    if (totalBytes + size > PANTRY_RAW_EVIDENCE_LIMITS.maxTotalBytes) return;
    selected.add(value);
    totalBytes += size;
  };
  // Reserve the current primary and oldest legacy context, then spend the
  // remaining count/byte budget newest-first. Preserve chronological output.
  retain(primary);
  retain(candidates[0]);
  for (let index = candidates.length - 1; index >= 0; index -= 1) retain(candidates[index]);
  return candidates.filter((value) => selected.has(value));
}

function mergeEvidence(...records) {
  return sanitizedEvidenceValues(records.flatMap((record) => {
    if (Array.isArray(record?.rawEvidence)) return record.rawEvidence;
    return legacyRawValues(record?.raw);
  }));
}

function mergePrimary(existing, incoming) {
  const incomingRaw = typeof incoming?.raw === 'string' ? incoming.raw.trim() : '';
  const existingEvidence = mergeEvidence(existing);
  return incomingRaw && !existingEvidence.includes(incomingRaw) ? incomingRaw : existing.raw;
}

function legacyIngredient(entry) {
  if (typeof entry === 'string') return normalizeIngredient(entry.trim());
  const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
  if (!name) return null;
  if (typeof entry.quantity === 'string') {
    const normalized = normalizeIngredient(`${entry.quantity} ${name}`);
    return {
      ...entry,
      ...normalized,
      raw: typeof entry.raw === 'string' ? entry.raw : normalized.raw,
      displayName: entry.displayName || normalized.displayName,
    };
  }
  if (!['count', 'ounce', 'qualitative'].includes(entry.unit)) {
    const unit = typeof entry.unit === 'string' ? entry.unit.trim() : '';
    if (unit && Number.isFinite(Number(entry.quantity))) {
      const normalized = normalizeIngredient(`${entry.quantity} ${unit} ${name}`);
      return {
        ...entry,
        ...normalized,
        raw: typeof entry.raw === 'string' ? entry.raw : normalized.raw,
        displayName: entry.displayName || normalized.displayName,
      };
    }
    const normalized = normalizeIngredient(name);
    return {
      ...entry,
      ...normalized,
      raw: typeof entry.raw === 'string' ? entry.raw : normalized.raw,
      displayName: entry.displayName || normalized.displayName,
    };
  }
  return entry;
}

/** Normalize any historical Pantry value into a stable editable record. */
export function normalizePantryEntry(value, options = {}) {
  if (typeof value === 'string' && !value.trim()) return null;
  const source = legacyIngredient(value);
  if (!source || !String(source.name || '').trim()) return null;
  const fallback = normalizeIngredient(String(source.name));
  const primaryNormalization = typeof source.raw === 'string' ? normalizeIngredient(source.raw) : null;
  const ambiguousRange = source.quantityState === 'range'
    || primaryNormalization?.quantityState === 'range';
  const parsedUnit = ['count', 'ounce', 'qualitative'].includes(source.unit) ? source.unit : fallback.unit;
  const unit = ambiguousRange ? 'qualitative' : parsedUnit;
  const quantity = unit === 'qualitative' ? null : Number(source.quantity);
  if (unit !== 'qualitative'
      && (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_PANTRY_CANONICAL_QUANTITY)) return null;
  const name = canonicalName(source.name);
  if (!name || name === 'uncertain ingredient') return null;
  const countLabel = unit === 'count' && COUNT_LABELS.includes(source.countLabel)
    ? source.countLabel : unit === 'count' ? fallback.countLabel : '';
  const confidence = Number.isFinite(source.confidence) && source.confidence >= 0 && source.confidence <= 1
    ? source.confidence : unit === 'qualitative' ? 0.4 : 0.85;
  const amountState = unit === 'qualitative'
    || source.amountState === 'unknown'
    || ambiguousRange
    || confidence < PANTRY_CONFIDENCE_THRESHOLD ? 'unknown' : 'known';
  const candidate = {
    name,
    unit,
    countLabel,
  };
  const sourceUpdatedAt = finiteTimestamp(source.updatedAt);
  const optionUpdatedAt = finiteTimestamp(options.updatedAt);
  const updatedAt = options.overrideUpdatedAt === true
    ? optionUpdatedAt ?? sourceUpdatedAt ?? 0
    : sourceUpdatedAt ?? optionUpdatedAt ?? 0;
  const evidence = evidenceValues(value, source);
  const record = {
    id: safeRecordId(options.id) || safeRecordId(source.id) || deterministicRecordId(candidate),
    name,
    displayName: plainDisplayName(source.displayName, fallback.displayName),
    amountState,
    quantity,
    measurementFamily: measurementFamily(unit),
    unit,
    kind: unit === 'count' ? 'indivisible' : unit === 'ounce' ? 'divisible' : 'qualitative',
    countLabel,
    category: INGREDIENT_CATEGORIES.includes(source.category) ? source.category : fallback.category,
    confidence,
    normalizationVersion: Number.isSafeInteger(source.normalizationVersion)
      && source.normalizationVersion > 0 && source.normalizationVersion <= MAX_PANTRY_NORMALIZATION_VERSION
      ? source.normalizationVersion : PANTRY_RECORD_VERSION,
    updatedAt,
    ...(source.amountSource === 'manual' ? { amountSource: 'manual' } : {}),
  };
  const raw = rankedPrimary(record, evidenceText(value, source, evidence), evidence);
  return {
    ...record,
    raw,
    rawEvidence: boundedEvidence(evidence, raw),
  };
}

/** Stable optimistic/server precondition for one exact Pantry record version. */
export function pantryRecordFingerprint(value) {
  const record = normalizePantryEntry(value);
  if (!record) return '';
  const version = JSON.stringify([
    record.id, record.raw, record.rawEvidence, record.name, record.displayName,
    record.amountState, record.quantity, record.measurementFamily, record.unit,
    record.kind, record.countLabel, record.category, record.confidence,
    record.amountSource || '', record.normalizationVersion, record.updatedAt,
  ]);
  const first = stableHash(version, 2166136261).toString(16).padStart(8, '0');
  const second = stableHash(version, 2246822519).toString(16).padStart(8, '0');
  return `pantry-v1:${first}${second}`;
}

/** Restore only when both the stable ID and semantic identity remain absent. */
export function restorePantryRecord(pantry, value) {
  const current = normalizePantry(pantry);
  const item = normalizePantryEntry(value);
  if (!item || !safeRecordId(item.id)) throw new Error('invalid_pantry_item');
  const sameId = current.find((entry) => entry.id === item.id);
  if (sameId) {
    if (pantryRecordFingerprint(sameId) === pantryRecordFingerprint(item)) {
      return { pantry: current, restored: false, alreadyPresent: true, item: sameId };
    }
    throw new Error('pantry_restore_conflict');
  }
  if (current.some((entry) => pantryRecordsWouldCoalesce(entry, item))) {
    throw new Error('pantry_restore_conflict');
  }
  const next = [...current, item]
    .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  return { pantry: next, restored: true, alreadyPresent: false, item };
}

function mergeRecordEvidence(existing, incoming, { primary = mergePrimary(existing, incoming) } = {}) {
  return normalizePantryEntry({
    ...existing,
    raw: primary,
    rawEvidence: mergeEvidence(existing, incoming),
  });
}

function mergeNumericRecords(existing, incoming) {
  const confidence = Math.min(existing.confidence, incoming.confidence);
  return normalizePantryEntry({
    ...existing,
    ...incoming,
    id: existing.id,
    raw: mergePrimary(existing, incoming),
    rawEvidence: mergeEvidence(existing, incoming),
    quantity: existing.quantity + incoming.quantity,
    confidence,
    amountState: existing.amountState === 'unknown' || incoming.amountState === 'unknown'
      ? 'unknown' : 'known',
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  });
}

/** Pure add/accumulate for one normalized Pantry record. */
export function addToPantry(pantry, value, options = {}) {
  const item = normalizePantryEntry(value, options);
  const current = normalizePantry(pantry);
  if (!item) return { pantry: current, added: false, name: '', item: null };
  const sameName = current.findIndex((entry) => entry.name === item.name);
  const exact = current.findIndex((entry) => pantryKey(entry) === pantryKey(item));

  if (item.unit === 'qualitative' && sameName >= 0) {
    const existing = current[sameName];
    const merged = mergeRecordEvidence(existing, item);
    const changed = merged.raw !== existing.raw
      || merged.rawEvidence.length !== existing.rawEvidence.length;
    const next = changed
      ? current.map((entry, index) => index === sameName ? merged : entry)
      : current;
    return { pantry: next, added: changed, name: item.name, item: changed ? merged : existing };
  }
  if (item.unit !== 'qualitative' && sameName >= 0 && current[sameName].unit === 'qualitative') {
    const existing = current[sameName];
    const replacement = normalizePantryEntry({
      ...item,
      id: existing.id,
      rawEvidence: mergeEvidence(existing, item),
    }, { updatedAt: item.updatedAt });
    const next = current.map((entry, index) => index === sameName ? replacement : entry);
    return { pantry: next, added: true, name: item.name, item: replacement };
  }
  if (exact >= 0) {
    if (item.unit === 'qualitative') return { pantry: current, added: false, name: item.name, item: current[exact] };
    const merged = mergeNumericRecords(current[exact], item);
    const next = current.map((entry, index) => index === exact ? merged : entry);
    return { pantry: next, added: true, name: item.name, item: merged };
  }
  const uniqueItem = withUniqueRecordId(item, current);
  return { pantry: [...current, uniqueItem], added: true, name: uniqueItem.name, item: uniqueItem };
}

/** Replace one Pantry record while preserving its stable ID. */
export function updatePantryRecord(pantry, recordId, value, options = {}) {
  const current = normalizePantry(pantry);
  const id = safeRecordId(recordId);
  const index = current.findIndex((entry) => entry.id === id);
  if (index < 0) throw new Error('pantry_record_not_found');
  const source = typeof value === 'string' ? value : { ...current[index], ...(value || {}), id };
  if (source && typeof source === 'object'
      && !Object.prototype.hasOwnProperty.call(value || {}, 'amountState')) {
    delete source.amountState;
  }
  let updated = normalizePantryEntry(source, { ...options, id, overrideUpdatedAt: true });
  if (!updated) throw new Error('invalid_pantry_item');
  updated = normalizePantryEntry({
    ...updated,
    rawEvidence: mergeEvidence(current[index], updated),
  }, { ...options, id, overrideUpdatedAt: true });
  if (current.some((entry, entryIndex) => entryIndex !== index
      && pantryRecordsWouldCoalesce(entry, updated))) {
    throw new Error('pantry_record_conflict');
  }
  return current.map((entry, entryIndex) => entryIndex === index ? updated : entry)
    .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
}

/** Remove by stable ID, historical name, or historical name/unit identity. */
export function removeFromPantry(pantry, value) {
  const current = normalizePantry(pantry);
  const isObject = value && typeof value === 'object';
  const recordId = isObject ? safeRecordId(value.id) : '';
  if (recordId) return current.filter((entry) => entry.id !== recordId);
  const name = canonicalName(isObject ? value.name : value);
  if (!isObject) return current.filter((entry) => entry.name !== name);
  const unit = ['count', 'ounce', 'qualitative'].includes(value.unit) ? value.unit : '';
  const countLabelSpecified = unit === 'count'
    && Object.prototype.hasOwnProperty.call(value, 'countLabel');
  if (countLabelSpecified && !COUNT_LABELS.includes(value.countLabel)) return current;
  const countLabel = countLabelSpecified ? value.countLabel : '';
  return current.filter((entry) => entry.name !== name
    || (unit && entry.unit !== unit)
    || (countLabelSpecified && entry.countLabel !== countLabel));
}

/** Pure toggle: add if absent, remove if present. */
export function togglePantry(pantry, value) {
  const current = normalizePantry(pantry);
  const invalidCountLabel = value && typeof value === 'object'
    && value.unit === 'count'
    && Object.prototype.hasOwnProperty.call(value, 'countLabel')
    && !COUNT_LABELS.includes(value.countLabel);
  if (invalidCountLabel) {
    return { pantry: current, added: false, name: canonicalName(value.name) };
  }
  const item = normalizePantryEntry(value);
  if (!item) return { pantry: current, added: false, name: '' };
  const precise = item.unit !== 'qualitative';
  const matched = current.find((entry) => (precise
    ? pantryKey(entry) === pantryKey(item)
    : entry.name === item.name));
  if (matched) return {
    pantry: removeFromPantry(current, matched),
    added: false,
    name: item.name,
    item: matched,
  };
  return addToPantry(current, item);
}

/** Deterministically migrate legacy strings/objects and merge compatible records. */
export function normalizePantry(raw, options = {}) {
  if (!Array.isArray(raw)) return [];
  const output = [];
  for (const value of raw) {
    let item = normalizePantryEntry(value, options);
    if (!item) continue;
    item = withUniqueRecordId(item, output);
    const exact = output.findIndex((entry) => pantryKey(entry) === pantryKey(item));
    const sameName = output.findIndex((entry) => entry.name === item.name);
    const qualitative = output.findIndex((entry) => entry.name === item.name && entry.unit === 'qualitative');
    if (exact >= 0 && item.unit !== 'qualitative') {
      output[exact] = mergeNumericRecords(output[exact], item);
    } else if (exact >= 0) {
      output[exact] = mergeRecordEvidence(output[exact], item);
    } else if (item.unit !== 'qualitative' && qualitative >= 0) {
      output[qualitative] = normalizePantryEntry({
        ...item,
        id: output[qualitative].id,
        rawEvidence: mergeEvidence(output[qualitative], item),
      });
    } else if (item.unit === 'qualitative' && sameName >= 0) {
      output[sameName] = mergeRecordEvidence(output[sameName], item, {
        primary: output[sameName].unit === 'qualitative'
          ? mergePrimary(output[sameName], item)
          : output[sameName].raw,
      });
    } else {
      output.push(item);
    }
  }
  return output.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
}

/** Pantry never borrows Shopping's qualitative "as needed" wording. */
export function formatPantryAmount(item) {
  const record = normalizePantryEntry(item);
  if (!record || record.amountState !== 'known') return 'Not sure';
  const amount = formatCanonicalAmount(record.quantity, record.unit, {
    requiredQuantity: record.quantity,
    countLabel: record.countLabel,
    category: record.category,
  });
  return /^as needed$/i.test(amount) ? 'Not sure' : amount;
}
