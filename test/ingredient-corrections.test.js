import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewedIngredientCorrection,
  buildRecipeUsageIndex,
  effectiveIngredientRecords,
  formatEffectiveIngredient,
  ingredientEvidence,
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
