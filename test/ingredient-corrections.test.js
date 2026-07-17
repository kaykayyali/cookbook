import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewedIngredientCorrection,
  buildRecipeUsageIndex,
  effectiveIngredientRecords,
  formatEffectiveIngredient,
  ingredientEvidence,
  ingredientEvidenceId,
  parseCorrectionAmount,
  preserveReviewedIngredientCorrections,
  validateIngredientCorrection,
} from '../docs/js/lib/ingredient-corrections.js';
import { addRecipeSelection, aggregateCart } from '../docs/js/lib/cart.js';
import { haveIngredient } from '../docs/js/lib/pantry.js';
import { matchesSearch } from '../docs/js/lib/filters.js';
import { fromSchema, toSchema } from '../docs/js/lib/schema.js';

const recipe = {
  _id: 'basil-pasta', name: 'Basil Pasta', recipeYield: '2 servings',
  recipeIngredient: ['to 4 basil leaves', '8 oz pasta'],
};
const numeric = {
  name: 'basil', amountState: 'numeric', amount: '2 to 4',
  measurementFamily: 'count', sourceUnit: 'count', countLabel: 'leaf',
};

const legacyStructuredIngredient = {
  raw: '2 bunches scallions', name: 'spring onion', displayName: 'Spring Onion',
  quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bunch',
  category: 'produce', confidence: 0.98,
};

function reviewed(base = recipe, correction = numeric, now = 1234) {
  const [evidence] = ingredientEvidence(base);
  const result = applyReviewedIngredientCorrection(base, {
    ingredientId: evidence.id, correction,
    reviewer: { sub: 'kay', name: 'Kaysser' }, reviewedAt: now,
  });
  assert.equal(result.ok, true, result.error);
  return result.recipe;
}

test('stable evidence identity survives reorder and distinguishes duplicate raw lines without using absolute array position', () => {
  const original = ingredientEvidence({ recipeIngredient: ['salt', 'pepper', 'salt'] });
  const reordered = ingredientEvidence({ recipeIngredient: ['pepper', 'salt', 'salt'] });
  assert.equal(original[0].id, reordered[1].id);
  assert.equal(original[1].id, reordered[0].id);
  assert.notEqual(original[0].id, original[2].id);
});

test('malformed prefix can be reviewed as a range while immutable raw evidence remains unchanged', () => {
  const corrected = reviewed();
  const [effective] = effectiveIngredientRecords(corrected);
  assert.deepEqual({ raw: effective.raw, name: effective.name, quantityMin: effective.quantityMin, quantity: effective.quantity, quantityState: effective.quantityState }, {
    raw: 'to 4 basil leaves', name: 'basil', quantityMin: 2, quantity: 4, quantityState: 'range',
  });
  assert.equal(formatEffectiveIngredient(effective), '2–4 basil leaves');
  assert.equal(corrected.recipeIngredient[0], 'to 4 basil leaves');
});

test('amount parser accepts canonical fractions, mixed numbers, and ranges and rejects reversed or adversarial values', () => {
  assert.deepEqual(parseCorrectionAmount('1/2 to 1 1/2'), { ok: true, quantityState: 'range', min: 0.5, max: 1.5, text: '1/2 to 1 1/2' });
  assert.deepEqual(parseCorrectionAmount('1 3/4'), { ok: true, quantityState: 'scalar', min: 1.75, max: 1.75, text: '1 3/4' });
  assert.equal(parseCorrectionAmount('4 to 2').ok, false);
  assert.equal(parseCorrectionAmount('Infinity').ok, false);
  assert.equal(parseCorrectionAmount('1/0').ok, false);
  assert.equal(parseCorrectionAmount('1000001').ok, false);
});

test('amount-state transitions and dependent measurement units produce valid canonical values', () => {
  const cases = [
    [{ name: 'salt', amountState: 'qualitative' }, { amountState: 'qualitative', quantity: null, unit: 'qualitative', countLabel: '' }],
    [{ name: 'salt', amountState: 'unknown' }, { amountState: 'unknown', quantity: null, unit: 'qualitative', countLabel: '' }],
    [{ name: 'milk', amountState: 'numeric', amount: '1/2', measurementFamily: 'volume', sourceUnit: 'cup', countLabel: 'leaf' }, { amountState: 'numeric', quantity: 4, unit: 'ounce', countLabel: '' }],
    [{ name: 'flour', amountState: 'numeric', amount: '1', measurementFamily: 'weight', sourceUnit: 'lb' }, { amountState: 'numeric', quantity: 16, unit: 'ounce', countLabel: '' }],
    [{ name: 'egg', amountState: 'numeric', amount: '1', measurementFamily: 'count', sourceUnit: 'dozen', countLabel: '' }, { amountState: 'numeric', quantity: 12, unit: 'count', countLabel: '' }],
  ];
  for (const [input, expected] of cases) {
    const result = validateIngredientCorrection(input);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map((key) => [key, result.correction[key]])), expected);
  }
  assert.equal(validateIngredientCorrection({ ...numeric, measurementFamily: 'weight', sourceUnit: 'cup' }).ok, false);
  assert.equal(validateIngredientCorrection({ ...numeric, name: '<img src=x onerror=alert(1)>' }).ok, false);
});

test('reviewed values take precedence over parser evolution and forged reparse values', () => {
  const corrected = reviewed();
  const forgedReparse = {
    ...recipe,
    ingredientNormalizations: [{
      ...corrected.ingredientNormalizations[0], name: 'poison', raw: 'forged', parserVersion: 999,
    }],
  };
  const preserved = preserveReviewedIngredientCorrections(corrected, forgedReparse);
  const [effective] = effectiveIngredientRecords(preserved);
  assert.equal(effective.name, 'basil');
  assert.equal(effective.raw, 'to 4 basil leaves');
  assert.equal(effective.parserVersion, 2);
});

test('schema round-trip persists reviewed status, parser version, reviewer, and raw evidence', () => {
  const corrected = reviewed();
  const roundTrip = fromSchema(toSchema(corrected));
  assert.deepEqual(roundTrip.ingredientNormalizations, corrected.ingredientNormalizations);
  assert.equal(roundTrip.recipeIngredient[0], recipe.recipeIngredient[0]);
});

test('reviewed correction deterministically feeds serving scale, Shopping aggregation, Pantry matching, search, and usage index', () => {
  const corrected = reviewed();
  const ingredients = effectiveIngredientRecords(corrected);
  const selection = addRecipeSelection([], corrected, ingredients);
  const scaled = [{ ...selection[0], targetServings: 4 }];
  const basil = aggregateCart(scaled).find((item) => item.name === 'basil');
  assert.deepEqual({ quantity: basil.quantity, purchaseQuantity: basil.purchaseQuantity, countLabel: basil.countLabel }, { quantity: 8, purchaseQuantity: 9, countLabel: 'leaf' });
  assert.equal(haveIngredient(ingredients[0], [{ name: 'basil' }]), true);
  assert.equal(matchesSearch(corrected, 'basil'), true);
  assert.equal(matchesSearch(corrected, 'to 4'), false, 'search consumes the effective reviewed value rather than malformed raw text');
  const index = buildRecipeUsageIndex([corrected]);
  assert.deepEqual(index.find('Basil').map(({ recipeId, ingredient }) => ({ recipeId, name: ingredient.name })), [{ recipeId: 'basil-pasta', name: 'basil' }]);
  assert.deepEqual(index.find('not basil'), []);
});

test('legacy structured recipe ingredients retain normalized identity and amount fields without review metadata', () => {
  const source = {
    _id: 'legacy-structured', name: 'Scallion pancakes', recipeYield: '2 servings',
    recipeIngredient: [legacyStructuredIngredient],
  };
  const before = structuredClone(source);
  const [effective] = effectiveIngredientRecords(source);

  assert.deepEqual({
    raw: effective.raw,
    name: effective.name,
    quantity: effective.quantity,
    unit: effective.unit,
    kind: effective.kind,
    countLabel: effective.countLabel,
    measurementFamily: effective.measurementFamily,
    amountState: effective.amountState,
    reviewStatus: effective.reviewStatus,
  }, {
    raw: '2 bunches scallions',
    name: 'spring onion',
    quantity: 2,
    unit: 'count',
    kind: 'indivisible',
    countLabel: 'bunch',
    measurementFamily: 'count',
    amountState: 'numeric',
    reviewStatus: 'unreviewed',
  });
  assert.deepEqual(source, before, 'effective projection never mutates imported source data');
});

test('old cached normalized ingredients remain effective and malformed reviewed metadata fails closed to the immutable base', () => {
  const raw = legacyStructuredIngredient.raw;
  const id = ingredientEvidenceId(raw);
  const recipeWithCache = {
    _id: 'legacy-cache', name: 'Scallion pancakes', recipeYield: '2 servings',
    recipeIngredient: [raw],
    ingredientNormalizations: [
      { id, ...legacyStructuredIngredient },
      {
        id, raw, name: '', displayName: 'Erased', quantity: null, unit: 'count', kind: 'indivisible',
        countLabel: 'bunch', category: 'produce', confidence: 1, amountState: 'numeric',
        measurementFamily: 'count', sourceUnit: 'count', amount: 'not-a-number',
        reviewStatus: 'reviewed', parserVersion: 2,
      },
    ],
  };
  const before = structuredClone(recipeWithCache);
  const [effective] = effectiveIngredientRecords(recipeWithCache);

  assert.deepEqual({ raw: effective.raw, name: effective.name, quantity: effective.quantity, countLabel: effective.countLabel }, {
    raw, name: 'spring onion', quantity: 2, countLabel: 'bunch',
  });
  assert.equal(effective.reviewStatus, 'unreviewed');
  assert.deepEqual(recipeWithCache, before, 'malformed override handling is immutable');
});

test('partial review metadata cannot disguise a normalized override as a legacy base record', () => {
  const raw = '1 egg';
  const recipeWithPartialReview = {
    recipeIngredient: [raw],
    ingredientNormalizations: [{
      id: ingredientEvidenceId(raw), raw, name: 'poison', displayName: 'Poison', quantity: 99,
      unit: 'count', kind: 'indivisible', countLabel: '', category: 'other', confidence: 1,
      reviewStatus: 'pending', parserVersion: 2,
    }],
  };
  const [effective] = effectiveIngredientRecords(recipeWithPartialReview);

  assert.deepEqual({ raw: effective.raw, name: effective.name, quantity: effective.quantity, reviewStatus: effective.reviewStatus }, {
    raw, name: 'egg', quantity: 1, reviewStatus: 'unreviewed',
  });
});

test('legacy normalized values remain visible to Pantry, Shopping scaling, search, and recipe usage', () => {
  const raw = legacyStructuredIngredient.raw;
  const legacy = {
    _id: 'legacy-downstream', name: 'Scallion pancakes', recipeYield: '2 servings',
    recipeIngredient: [raw],
    ingredientNormalizations: [{ id: ingredientEvidenceId(raw), ...legacyStructuredIngredient }],
  };
  const ingredients = effectiveIngredientRecords(legacy);

  assert.equal(haveIngredient(ingredients[0], [{ name: 'spring onion' }]), true, 'Pantry matches the cached canonical name');
  const selection = addRecipeSelection([], legacy, ingredients);
  const item = aggregateCart([{ ...selection[0], targetServings: 4 }])[0];
  assert.deepEqual({ name: item.name, quantity: item.quantity, purchaseQuantity: item.purchaseQuantity, countLabel: item.countLabel }, {
    name: 'spring onion', quantity: 4, purchaseQuantity: 5, countLabel: 'bunch',
  });
  assert.equal(matchesSearch(legacy, 'spring onion'), true, 'search includes the effective canonical name');
  assert.deepEqual(buildRecipeUsageIndex([legacy]).find('spring onion').map((use) => use.recipeId), ['legacy-downstream']);
});

test('legacy qualitative and unknown amount states survive the effective projection', () => {
  const rows = [
    { raw: 'salt to taste', name: 'salt', displayName: 'Salt', quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', category: 'pantry', confidence: 0.9, amountState: 'qualitative' },
    { raw: 'some saffron', name: 'saffron', displayName: 'Saffron', quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', category: 'pantry', confidence: 0.9, amountState: 'unknown' },
  ];
  const projected = effectiveIngredientRecords({ recipeIngredient: rows });
  assert.deepEqual(projected.map(({ name, quantity, unit, kind, amountState }) => ({ name, quantity, unit, kind, amountState })), [
    { name: 'salt', quantity: null, unit: 'qualitative', kind: 'qualitative', amountState: 'qualitative' },
    { name: 'saffron', quantity: null, unit: 'qualitative', kind: 'qualitative', amountState: 'unknown' },
  ]);
});

test('correction payload cannot replace immutable raw/source evidence and missing stable identity fails closed', () => {
  const [evidence] = ingredientEvidence(recipe);
  const attempt = applyReviewedIngredientCorrection(recipe, {
    ingredientId: evidence.id,
    correction: { ...numeric, raw: 'forged raw', sourceUrl: 'javascript:alert(1)' },
    reviewer: { sub: 'kay', name: 'Kaysser' }, reviewedAt: 100,
  });
  assert.equal(attempt.ok, true);
  assert.equal(attempt.record.raw, 'to 4 basil leaves');
  assert.equal(Object.hasOwn(attempt.record, 'sourceUrl'), false);
  assert.equal(applyReviewedIngredientCorrection(recipe, { ingredientId: 'missing', correction: numeric }).ok, false);
});
