import { NORMALIZATION_VERSION, normalizeIngredient } from './cart.js';
import {
  canonicalIngredientIdentity,
  effectiveIngredientRecords,
} from './ingredient-corrections.js';

const MAX_RECIPES = 10_000;
const MAX_INGREDIENTS_PER_RECIPE = 20_000;
const MAX_TOTAL_INGREDIENTS = 200_000;
const MAX_TEXT = 4_096;
const MAX_IMAGE_TEXT = 2_048;
const MAX_IMAGE_NODES = 64;
const MAX_IMAGE_DEPTH = 8;
const SYNC_RECIPE_LIMIT = 200;
const YIELD_INGREDIENT_CHUNK = 100;
const MISSING = Symbol('missing');
const cache = new WeakMap();

const EFFECTIVE_FIELDS = Object.freeze(['raw', 'name']);
const INPUT_FIELDS = Object.freeze([
  'id', 'raw', 'name', 'displayName', 'reviewStatus', 'reviewVersion',
  'reviewedAt', 'parserVersion', 'amount', 'amountState', 'quantity',
  'quantityMin', 'quantityState', 'measurementFamily', 'sourceUnit', 'unit',
  'kind', 'countLabel', 'category', 'confidence', 'evidenceOccurrence',
]);
const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1;

function ownValue(value, key, context) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return MISSING;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return MISSING;
    if (!Object.hasOwn(descriptor, 'value')) {
      context.ok = false;
      return MISSING;
    }
    return descriptor.value;
  } catch {
    context.ok = false;
    return MISSING;
  }
}

function boundedText(value, fallback, context, max = MAX_TEXT) {
  if (value === MISSING || value === undefined || value === null) return fallback;
  let text;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = String(value);
  else {
    context.ok = false;
    return fallback;
  }
  if (text.length > max) {
    context.ok = false;
    return fallback;
  }
  return text;
}

function primitiveField(value, context) {
  if (value === MISSING) return MISSING;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string' && value.length > MAX_TEXT) {
      context.ok = false;
      return MISSING;
    }
    return value;
  }
  // BigInt and objects are invalid field values. Omit them so downstream
  // validation fails closed without ever handing them to JSON serialization.
  context.ok = false;
  return MISSING;
}

function sanitizeRecord(value, context) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
  const output = Object.create(null);
  for (const field of INPUT_FIELDS) {
    const safe = primitiveField(ownValue(value, field, context), context);
    if (safe !== MISSING) output[field] = safe;
  }
  return output;
}

function sanitizeArray(value, context, limit, mapper) {
  if (!Array.isArray(value)) return [];
  let length;
  try { length = value.length; } catch { context.ok = false; return []; }
  if (!Number.isSafeInteger(length) || length < 0 || length > limit) {
    context.ok = false;
    length = Math.min(Number.isSafeInteger(length) && length > 0 ? length : 0, limit);
  }
  const output = [];
  for (let index = 0; index < length; index += 1) {
    const item = ownValue(value, String(index), context);
    if (item === MISSING) continue;
    const mapped = mapper(item);
    if (mapped !== null && mapped !== undefined) output.push(mapped);
  }
  return output;
}

function imageCandidate(value, context, seen = new Set(), depth = 0, counter = { nodes: 0 }) {
  if (typeof value === 'string') {
    if (value.length > MAX_IMAGE_TEXT) context.ok = false;
    return value.length <= MAX_IMAGE_TEXT ? value : '';
  }
  if (value === null || value === undefined || value === MISSING) return '';
  if ((typeof value !== 'object' && typeof value !== 'function') || depth >= MAX_IMAGE_DEPTH) {
    if (typeof value === 'object' || typeof value === 'function') context.ok = false;
    return '';
  }
  if (seen.has(value) || ++counter.nodes > MAX_IMAGE_NODES) {
    context.ok = false;
    return '';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    let length;
    try { length = value.length; } catch { context.ok = false; return ''; }
    if (!Number.isSafeInteger(length) || length > MAX_IMAGE_NODES) {
      context.ok = false;
      length = Math.min(Number.isSafeInteger(length) ? length : 0, MAX_IMAGE_NODES);
    }
    for (let index = 0; index < length; index += 1) {
      const candidate = imageCandidate(ownValue(value, String(index), context), context, seen, depth + 1, counter);
      if (candidate) return candidate;
    }
    return '';
  }
  return imageCandidate(ownValue(value, 'url', context), context, seen, depth + 1, counter)
    || imageCandidate(ownValue(value, 'contentUrl', context), context, seen, depth + 1, counter);
}

export function safeRecipeImageUrlValue(value, context = { ok: true }) {
  const candidate = imageCandidate(value, context).trim();
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function effectiveRow(record) {
  const row = Object.create(null);
  for (const field of EFFECTIVE_FIELDS) {
    if (Object.hasOwn(record, field)) row[field] = record[field];
  }
  return row;
}

function sanitizeRecipe(value, context, totals) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
  const id = boundedText(ownValue(value, '_id', context), '', context)
    || boundedText(ownValue(value, 'id', context), '', context);
  const name = boundedText(ownValue(value, 'name', context), 'Untitled', context);
  const image = safeRecipeImageUrlValue(ownValue(value, 'image', context), context);
  const ingredientValue = ownValue(value, 'recipeIngredient', context);
  const recipeIngredient = sanitizeArray(ingredientValue, context, MAX_INGREDIENTS_PER_RECIPE, (item) => {
    totals.ingredients += 1;
    if (totals.ingredients > MAX_TOTAL_INGREDIENTS) { context.ok = false; return null; }
    if (typeof item === 'string') {
      if (item.length > MAX_TEXT) { context.ok = false; return null; }
      return item;
    }
    return sanitizeRecord(item, context);
  });
  const normalizationValue = ownValue(value, 'ingredientNormalizations', context);
  const ingredientNormalizations = sanitizeArray(normalizationValue, context, MAX_INGREDIENTS_PER_RECIPE, (item) => {
    totals.ingredients += 1;
    if (totals.ingredients > MAX_TOTAL_INGREDIENTS) { context.ok = false; return null; }
    return sanitizeRecord(item, context);
  });
  const rawOnly = recipeIngredient.every((item) => typeof item === 'string') && ingredientNormalizations.length === 0;
  const sanitized = { _id: id, name, image, recipeIngredient, ingredientNormalizations };
  let effective = null;
  let signatureIngredients;
  if (rawOnly) {
    // Raw evidence plus the parser version is a complete effective projection for
    // unstructured, unreviewed ingredients and avoids eagerly parsing 100k lines.
    signatureIngredients = ['raw-v', NORMALIZATION_VERSION, ...[...new Set(recipeIngredient)].sort(compareText)];
  } else {
    try {
      effective = effectiveIngredientRecords(sanitized).map(effectiveRow);
      signatureIngredients = ['effective', ...effective];
    } catch {
      context.ok = false;
      effective = [];
      signatureIngredients = ['invalid'];
    }
  }
  const signatureRow = { id, name, image, ingredients: signatureIngredients };
  const candidateKey = JSON.stringify(signatureRow);
  // Missing-ID data is uncommon and bounded. Keep its exact deterministic key;
  // truncating it to a non-cryptographic hash can silently merge real recipes.
  const identity = id ? `id:${id}` : `derived:${name}\u0000${candidateKey}`;
  return { id, name, image, identity, candidateKey, recipe: sanitized, effective, rawOnly, signatureRow };
}

function finishAuthorityRecord(record, context, projected) {
  const winners = new Map();
  for (const item of projected) {
    const current = winners.get(item.identity);
    if (!current || compareText(item.candidateKey, current.candidateKey) < 0) winners.set(item.identity, item);
  }
  record.snapshot = [...winners.values()].sort((left, right) => compareText(left.identity, right.identity));
  try { record.signature = JSON.stringify(record.snapshot.map((item) => item.signatureRow)); } catch { context.ok = false; }
  record.ok = context.ok;
  record.source = null;
  return record;
}

function makeAuthorityRecord(recipes) {
  const context = { ok: true };
  const totals = { ingredients: 0 };
  let length = recipes.length;
  if (length > MAX_RECIPES) { context.ok = false; length = MAX_RECIPES; }
  const projected = [];
  for (let index = 0; index < length; index += 1) {
    const value = ownValue(recipes, String(index), context);
    if (value === MISSING) continue;
    const item = sanitizeRecipe(value, context, totals);
    if (item) projected.push(item);
  }
  return finishAuthorityRecord({ ok: false, signature: '', snapshot: null, source: recipes, index: null, promise: null, authorityPromise: null }, context, projected);
}

export function recipeDiscoveryAuthority(recipes) {
  if (!Array.isArray(recipes)) throw new TypeError('Recipe authority must be an array.');
  let record = cache.get(recipes);
  if (!record) {
    record = recipes.length <= SYNC_RECIPE_LIMIT
      ? makeAuthorityRecord(recipes)
      : { ok: false, signature: '', snapshot: null, source: recipes, index: null, promise: null, authorityPromise: null };
    cache.set(recipes, record);
  }
  return record;
}

function effectiveForIndex(item, caches) {
  if (item.effective) return item.effective;
  const records = [];
  for (const raw of item.recipe.recipeIngredient) {
    let parsed = caches.parsed.get(raw);
    if (!parsed) {
      try {
        parsed = normalizeIngredient(raw);
        caches.parsed.set(raw, parsed);
      } catch { parsed = null; }
    }
    if (parsed) records.push(parsed);
  }
  return records;
}

function addCompactRecipe(build, item, caches) {
  const unique = new Map();
  for (const ingredient of effectiveForIndex(item, caches)) {
    const sourceName = typeof ingredient?.name === 'string' ? ingredient.name : '';
    let identity = caches.identities.get(sourceName);
    if (identity === undefined) {
      identity = canonicalIngredientIdentity(sourceName);
      caches.identities.set(sourceName, identity);
    }
    if (!identity) continue;
    const raw = typeof ingredient?.raw === 'string' ? ingredient.raw : '';
    const current = unique.get(identity);
    if (current === undefined || compareText(raw, current) < 0) unique.set(identity, raw);
  }
  const names = [...unique.keys()].sort(compareText);
  build.push({
    recipeId: item.id || item.identity,
    recipeIdentity: item.identity,
    recipeName: item.name,
    imageUrl: item.image,
    canOpen: Boolean(item.id),
    names,
    raws: names.map((name) => unique.get(name) || ''),
  });
}

function finishIndex(build) {
  build.sort((left, right) => compareText(left.recipeName.toLocaleLowerCase('en-US'), right.recipeName.toLocaleLowerCase('en-US'))
    || compareText(left.recipeName, right.recipeName)
    || compareText(left.recipeIdentity, right.recipeIdentity));
  const byIngredient = new Map();
  for (let recipeIndex = 0; recipeIndex < build.length; recipeIndex += 1) {
    for (const name of build[recipeIndex].names) {
      let refs = byIngredient.get(name);
      if (!refs) { refs = []; byIngredient.set(name, refs); }
      refs.push(recipeIndex);
    }
  }
  return Object.freeze({ recipes: build, byIngredient });
}

export function buildRecipeDiscoveryIndexSync(record) {
  if (record.index) return record.index;
  if (!record.snapshot) {
    const materialized = makeAuthorityRecord(record.source || []);
    Object.assign(record, materialized);
  }
  const build = [];
  const caches = { parsed: new Map(), identities: new Map() };
  for (const item of record.snapshot) addCompactRecipe(build, item, caches);
  record.index = finishIndex(build);
  return record.index;
}

const yieldTask = () => {
  if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
  if (typeof globalThis.setImmediate === 'function') return new Promise((resolve) => globalThis.setImmediate(resolve));
  if (typeof globalThis.MessageChannel === 'function') return new Promise((resolve) => {
    const channel = new globalThis.MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
  return new Promise((resolve) => setTimeout(resolve, 0));
};

function prepareAuthoritySnapshot(record) {
  if (record.snapshot) return Promise.resolve(record.snapshot);
  if (record.authorityPromise) return record.authorityPromise;
  record.authorityPromise = (async () => {
    await yieldTask();
    const recipes = record.source || [];
    const context = { ok: true };
    const totals = { ingredients: 0 };
    const projected = [];
    let lastYieldIngredients = 0;
    const length = Math.min(recipes.length, MAX_RECIPES);
    if (recipes.length > MAX_RECIPES) context.ok = false;
    for (let index = 0; index < length; index += 1) {
      const value = ownValue(recipes, String(index), context);
      if (value !== MISSING) {
        const item = sanitizeRecipe(value, context, totals);
        if (item) projected.push(item);
      }
      if (totals.ingredients - lastYieldIngredients >= YIELD_INGREDIENT_CHUNK) {
        lastYieldIngredients = totals.ingredients;
        await yieldTask();
      }
    }
    finishAuthorityRecord(record, context, projected);
    return record.snapshot;
  })().finally(() => { record.authorityPromise = null; });
  return record.authorityPromise;
}

export function prepareRecipeDiscoveryIndex(record) {
  if (record.index) return Promise.resolve(record.index);
  if (record.promise) return record.promise;
  record.promise = (async () => {
    await prepareAuthoritySnapshot(record);
    const build = [];
    const caches = { parsed: new Map(), identities: new Map() };
    let ingredientBudget = 0;
    for (let index = 0; index < record.snapshot.length; index += 1) {
      if (record.index) return record.index;
      addCompactRecipe(build, record.snapshot[index], caches);
      ingredientBudget += build[build.length - 1]?.names.length || 1;
      if (ingredientBudget >= YIELD_INGREDIENT_CHUNK) {
        ingredientBudget = 0;
        await yieldTask();
      }
    }
    if (!record.index) record.index = finishIndex(build);
    return record.index;
  })().finally(() => { record.promise = null; });
  return record.promise;
}

function rankedRecipe(source, canonical, available) {
    let have = 0;
    for (const name of source.names) if (available.has(name)) have += 1;
    const total = source.names.length;
    const ratio = total ? have / total : 0;
    const label = total && have === total ? 'All' : ratio >= 0.5 ? 'Some' : 'Few';
    const rank = label === 'All' ? 0 : label === 'Some' ? 1 : 2;
    const matchIndex = source.names.indexOf(canonical);
  return { rank, item: { source, matchingLine: matchIndex >= 0 ? source.raws[matchIndex] : '', availability: { label, have, total, ratio } } };
}

function pageFromBuckets(buckets, total, offset, limit) {
  const start = Math.max(0, Number(offset) || 0);
  const count = Number.isFinite(limit) ? Math.max(0, Number(limit) || 0) : total;
  const selected = [];
  let skipped = 0;
  for (const bucket of buckets) {
    for (const item of bucket) {
      if (skipped++ < start) continue;
      if (selected.length >= count) break;
      selected.push(item);
    }
    if (selected.length >= count) break;
  }
  const results = selected.map(({ source, matchingLine, availability }) => ({
    recipeId: source.recipeId,
    recipeIdentity: source.recipeIdentity,
    recipeName: source.recipeName,
    matchingLine,
    availability,
    imageUrl: source.imageUrl,
    canOpen: source.canOpen,
  }));
  return { results, total, hasMore: start + results.length < total, pending: false };
}

function queryInputs(index, pantryNames, ingredientName, offset, limit) {
  const canonical = canonicalIngredientIdentity(ingredientName);
  const refs = index.byIngredient.get(canonical) || [];
  const available = new Set((Array.isArray(pantryNames) ? pantryNames : [])
    .map((item) => canonicalIngredientIdentity(item?.name || item)).filter(Boolean));
  const start = Math.max(0, Number(offset) || 0);
  const count = Number.isFinite(limit) ? Math.max(0, Number(limit) || 0) : refs.length;
  return { canonical, refs, available, cap: Math.min(refs.length, start + count) };
}

export function queryRecipeDiscoveryIndex(index, pantryNames, ingredientName, { offset = 0, limit = Infinity } = {}) {
  const { canonical, refs, available, cap } = queryInputs(index, pantryNames, ingredientName, offset, limit);
  const buckets = [[], [], []];
  for (const ref of refs) {
    const ranked = rankedRecipe(index.recipes[ref], canonical, available);
    if (buckets[ranked.rank].length < cap) buckets[ranked.rank].push(ranked.item);
  }
  return pageFromBuckets(buckets, refs.length, offset, limit);
}

export async function prepareRecipeDiscoveryPage(index, pantryNames, ingredientName, { offset = 0, limit = Infinity } = {}) {
  const { canonical, refs, available, cap } = queryInputs(index, pantryNames, ingredientName, offset, limit);
  const buckets = [[], [], []];
  let ingredientBudget = 0;
  await yieldTask();
  for (const ref of refs) {
    const source = index.recipes[ref];
    const ranked = rankedRecipe(source, canonical, available);
    if (buckets[ranked.rank].length < cap) buckets[ranked.rank].push(ranked.item);
    ingredientBudget += source.names.length || 1;
    if (ingredientBudget >= YIELD_INGREDIENT_CHUNK) {
      ingredientBudget = 0;
      await yieldTask();
    }
  }
  return pageFromBuckets(buckets, refs.length, offset, limit);
}
