import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  applyReviewedIngredientCorrection,
  buildRecipeUsageIndex,
  effectiveIngredientRecords,
  ingredientEditorProjection,
  ingredientEvidence,
  ingredientEvidenceId,
  reconcileReviewedRecipesInCart,
  reconcileReviewedShoppingChecked,
  recipeEffectiveSignature,
  validateIngredientCorrection,
} from '../docs/js/lib/ingredient-corrections.js';
import { aggregateCart, normalizeIngredient } from '../docs/js/lib/cart.js';
import { regeneratePlanRangeCart } from '../docs/js/lib/plan-range.js';
import { pickForUs } from '../docs/js/lib/suggestions.js';

const reviewer = { sub: 'member-1', name: 'Member One' };

function canonicalRecord(raw) {
  const recipe = { _id: `recipe-${raw}`, name: raw, recipeIngredient: [raw] };
  return { recipe, record: effectiveIngredientRecords(recipe)[0] };
}

function review(recipe, correction, reviewedAt = 100) {
  const [evidence] = ingredientEvidence(recipe);
  const result = applyReviewedIngredientCorrection(recipe, {
    ingredientId: evidence.id,
    correction,
    reviewer,
    reviewedAt,
  });
  assert.equal(result.ok, true, result.error);
  return result.recipe;
}

test('lossless editor projection reconstructs source units and name-only saves preserve canonical amounts', () => {
  const cases = [
    ['2 tbsp olive oil', '2', 'volume', 'tbsp'],
    ['3 tsp cumin', '3', 'volume', 'tsp'],
    ['1/2 cup milk', '1/2', 'volume', 'cup'],
    ['1 1/2 fl oz vanilla', '1 1/2', 'volume', 'fl-oz'],
    ['8 oz pasta', '8', 'weight', 'oz'],
    ['1 lb flour', '1', 'weight', 'lb'],
    ['250 g flour', '250', 'weight', 'g'],
    ['1/2 kg potatoes', '1/2', 'weight', 'kg'],
    ['250 ml stock', '250', 'volume', 'ml'],
    ['1 l water', '1', 'volume', 'l'],
  ];
  for (const [raw, amount, measurementFamily, sourceUnit] of cases) {
    const { record } = canonicalRecord(raw);
    const before = { quantity: record.quantity, quantityMin: record.quantityMin, unit: record.unit };
    const draft = ingredientEditorProjection(record);
    assert.deepEqual(
      { amount: draft.amount, measurementFamily: draft.measurementFamily, sourceUnit: draft.sourceUnit },
      { amount, measurementFamily, sourceUnit },
      raw,
    );
    const validated = validateIngredientCorrection({ ...draft, name: `${record.name} corrected` });
    assert.equal(validated.ok, true, `${raw}: ${validated.error}`);
    assert.deepEqual(
      { quantity: validated.correction.quantity, quantityMin: validated.correction.quantityMin, unit: validated.correction.unit },
      before,
      `name-only save must preserve canonical amount for ${raw}`,
    );
  }
});

test('editor projection preserves fractions and ranges and fails safe to explicit canonical ounces when raw is ambiguous', () => {
  const safe = {
    ...normalizeIngredient('1/2 to 1 1/2 cups milk'),
    quantityMin: 4,
    quantityState: 'range',
    amountState: 'numeric',
    measurementFamily: 'volume',
    reviewStatus: 'unreviewed',
  };
  const projected = ingredientEditorProjection(safe);
  assert.deepEqual({ amount: projected.amount, measurementFamily: projected.measurementFamily, sourceUnit: projected.sourceUnit }, {
    amount: '1/2 to 1 1/2', measurementFamily: 'volume', sourceUnit: 'cup',
  });
  const validated = validateIngredientCorrection(projected);
  assert.equal(validated.ok, true, validated.error);
  assert.deepEqual({ quantityMin: validated.correction.quantityMin, quantity: validated.correction.quantity }, { quantityMin: 4, quantity: 12 });

  const ambiguous = {
    raw: 'a splash of legacy oil', name: 'oil', displayName: 'Oil', quantity: 3.25,
    unit: 'ounce', kind: 'divisible', countLabel: '', category: 'pantry', confidence: 0.5,
    amountState: 'numeric', reviewStatus: 'unreviewed', parserVersion: 1,
  };
  const fallback = ingredientEditorProjection(ambiguous);
  assert.deepEqual({ amount: fallback.amount, measurementFamily: fallback.measurementFamily, sourceUnit: fallback.sourceUnit }, {
    amount: '3.25', measurementFamily: 'weight', sourceUnit: 'oz',
  });
  const roundTrip = validateIngredientCorrection({ ...fallback, name: 'olive oil' });
  assert.equal(roundTrip.ok, true, roundTrip.error);
  assert.equal(roundTrip.correction.quantity, 3.25);
});

test('reviewed source-unit and family toggles convert exactly once across repeated editor round trips', () => {
  const recipe = { _id: 'toggle', recipeIngredient: ['2 tbsp olive oil'] };
  const first = review(recipe, {
    name: 'olive oil', amountState: 'numeric', amount: '2', measurementFamily: 'volume', sourceUnit: 'tbsp', countLabel: '',
  });
  const firstRecord = effectiveIngredientRecords(first)[0];
  assert.equal(firstRecord.quantity, 1);
  const firstDraft = ingredientEditorProjection(firstRecord);
  assert.equal(validateIngredientCorrection(firstDraft).correction.quantity, 1);
  const changed = review(first, { ...firstDraft, measurementFamily: 'weight', sourceUnit: 'lb', amount: '1' }, 200);
  assert.equal(effectiveIngredientRecords(changed)[0].quantity, 16);
  const changedDraft = ingredientEditorProjection(effectiveIngredientRecords(changed)[0]);
  assert.equal(validateIngredientCorrection(changedDraft).correction.quantity, 16);
});

test('new evidence identity resists the deterministic 32-bit FNV collision and legacy collision overlays require raw evidence agreement', () => {
  const rawA = '10922 ingredient rx4755 salt';
  const rawB = '27804 ingredient 16y07cj salt';
  assert.notEqual(ingredientEvidenceId(rawA), ingredientEvidenceId(rawB));

  const recipe = { _id: 'collision', recipeIngredient: [rawA, rawB] };
  const corrected = review(recipe, {
    name: 'first salt', amountState: 'numeric', amount: '1', measurementFamily: 'count', sourceUnit: 'count', countLabel: '',
  });
  const projected = effectiveIngredientRecords(corrected);
  assert.equal(projected[0].name, 'first salt');
  assert.notEqual(projected[1].name, 'first salt');
  assert.equal(projected[0].raw, rawA);
  assert.equal(projected[1].raw, rawB);
});

test('duplicate identical source occurrences retain distinct identity through reorder, insertion, and reimport', () => {
  const first = ingredientEvidence({ recipeIngredient: ['salt', 'pepper', 'salt'] });
  const moved = ingredientEvidence({ recipeIngredient: ['oil', 'salt', 'salt', 'pepper'] });
  assert.equal(first[0].id, moved[1].id);
  assert.equal(first[2].id, moved[2].id);
  assert.notEqual(first[0].id, first[2].id);
  assert.deepEqual(ingredientEvidence({ recipeIngredient: ['salt', 'salt'] }).map((row) => row.id), first.filter((row) => row.raw === 'salt').map((row) => row.id));
});

test('usage index deduplicates each recipe ingredient and sorts deterministically with missing and duplicate recipe ids', () => {
  const recipes = [
    { _id: 'b', name: 'Beta', recipeIngredient: ['1 egg', '2 eggs'] },
    { _id: 'a', name: 'Alpha', recipeIngredient: ['1 egg'] },
    { name: 'No id one', recipeIngredient: ['1 egg'] },
    { name: 'No id two', recipeIngredient: ['1 egg'] },
    { _id: 'a', name: 'Duplicate id', recipeIngredient: ['1 egg'] },
    { _id: 'c', name: 'éclair', recipeIngredient: ['1 egg'] },
    { _id: 'd', name: 'Zulu', recipeIngredient: ['1 egg'] },
  ];
  const forward = buildRecipeUsageIndex(recipes).find('egg');
  const reverse = buildRecipeUsageIndex([...recipes].reverse()).find('egg');
  assert.deepEqual(forward, reverse);
  assert.equal(forward.filter((use) => use.recipeId === 'b').length, 1);
  assert.equal(new Set(forward.map((use) => use.recipeIdentity)).size, forward.length);
  assert.equal(forward.length, 7);
  assert.deepEqual(forward.map((use) => use.recipeName), [...forward.map((use) => use.recipeName)].sort());
});

test('cart aggregation keeps incompatible count package labels separate while aggregating identical labels', () => {
  const cart = [{ sourceServings: 1, targetServings: 1, ingredients: [
    { ...normalizeIngredient('2 bottles water'), name: 'water', countLabel: 'bottle' },
    { ...normalizeIngredient('3 bottles water'), name: 'water', countLabel: 'bottle' },
    { ...normalizeIngredient('4 cans water'), name: 'water', countLabel: 'can' },
    { ...normalizeIngredient('5 pieces water'), name: 'water', countLabel: 'piece' },
  ] }];
  const rows = aggregateCart(cart).filter((row) => row.name === 'water').sort((a, b) => a.countLabel.localeCompare(b.countLabel));
  assert.deepEqual(rows.map(({ countLabel, quantity, purchaseQuantity }) => ({ countLabel, quantity, purchaseQuantity })), [
    { countLabel: 'bottle', quantity: 5, purchaseQuantity: 6 },
    { countLabel: 'can', quantity: 4, purchaseQuantity: 5 },
    { countLabel: 'piece', quantity: 5, purchaseQuantity: 6 },
  ]);
});

test('cart reconciliation leaves AI-audited selections untouched until reviewed authority changes', () => {
  const recipe = { _id: 'audited', name: 'Audited', recipeIngredient: ['1 egg'] };
  const audited = [{
    recipeId: 'audited', recipeName: 'Audited', sourceServings: 1, targetServings: 3,
    normalizationVersion: 2,
    ingredients: [{ ...normalizeIngredient('1 egg'), displayName: 'Audited egg', confidence: 0.99 }],
  }];
  assert.deepEqual(reconcileReviewedRecipesInCart(audited, [recipe]), audited);
});

test('existing selected Shopping authority reconciles reviewed values without resurrecting removals or changing servings', () => {
  const base = { _id: 'soup', name: 'Soup', recipeYield: '2 servings', recipeIngredient: ['1 bottle stock', '1 onion'] };
  const reviewed = review(base, {
    name: 'vegetable stock', amountState: 'numeric', amount: '2', measurementFamily: 'count', sourceUnit: 'count', countLabel: 'bottle',
  });
  const cart = [{
    recipeId: 'soup', recipeName: 'Soup', sourceServings: 2, targetServings: 6, normalizationVersion: 2,
    removedIngredientNames: ['onion'],
    ingredients: [normalizeIngredient('1 bottle stock')],
  }];
  const next = reconcileReviewedRecipesInCart(cart, [reviewed]);
  assert.equal(next[0].targetServings, 6);
  assert.deepEqual(next[0].removedIngredientNames, ['onion']);
  assert.deepEqual(next[0].ingredients.map(({ name, quantity, countLabel }) => ({ name, quantity, countLabel })), [
    { name: 'vegetable stock', quantity: 2, countLabel: 'bottle' },
  ]);
  assert.notEqual(recipeEffectiveSignature(base), recipeEffectiveSignature(reviewed));
  assert.deepEqual(reconcileReviewedRecipesInCart(next, [reviewed]), next, 'reconciliation is idempotent across reload/two-tab refresh');
  assert.deepEqual(
    reconcileReviewedShoppingChecked(
      { stock: true, 'pantry-transfer:stock': true, 'manual:keep': true },
      cart,
      next,
    ),
    {
      stock: true,
      'vegetable stock': true,
      'pantry-transfer:stock': true,
      'pantry-transfer:vegetable stock': true,
      'manual:keep': true,
    },
    'checked and already-transferred state follows immutable evidence identity without deleting legacy keys',
  );
});

test('plan range shopping uses effective reviewed ingredients and preserves range tombstones', () => {
  const raw = { _id: 'r', name: 'Recipe', recipeYield: '2 servings', recipeIngredient: ['1 onion'] };
  const corrected = review(raw, {
    name: 'shallot', amountState: 'numeric', amount: '2', measurementFamily: 'count', sourceUnit: 'count', countLabel: 'piece',
  });
  const workspace = {
    plan: [{ id: 'p', date: '2026-07-17', type: 'recipe', status: 'active', recipeId: 'r', targetServings: 4 }],
    cart: [{ recipeId: 'plan:2026-07-17:2026-07-17:r', sourceRecipeId: 'r', origin: { kind: 'plan', rangeStart: '2026-07-17', rangeEnd: '2026-07-17' }, removedIngredientNames: ['onion'], ingredients: [] }],
  };
  const cart = regeneratePlanRangeCart(workspace, { rangeStart: '2026-07-17', rangeEnd: '2026-07-17' }, [corrected]);
  assert.deepEqual(cart[0].ingredients.map(({ name, quantity, countLabel }) => ({ name, quantity, countLabel })), [
    { name: 'shallot', quantity: 2, countLabel: 'piece' },
  ]);
  assert.deepEqual(cart[0].removedIngredientNames, ['onion']);
});

test('suggestion disliked-ingredient filter consumes reviewed names rather than immutable malformed evidence', () => {
  const raw = { _id: 'r', name: 'Soup', recipeIngredient: ['poison-looking parser text'] };
  const corrected = review(raw, {
    name: 'spinach', amountState: 'numeric', amount: '1', measurementFamily: 'count', sourceUnit: 'count', countLabel: 'bunch',
  });
  assert.equal(pickForUs({ recipes: [corrected], preferences: { dislikedIngredients: ['poison'] } }).length, 1);
  assert.equal(pickForUs({ recipes: [corrected], preferences: { dislikedIngredients: ['spinach'] } }).length, 0);
});

test('effective projection and usage indexing remain linear at issue-scale without mutating input', { timeout: 15_000 }, () => {
  const recipe = { _id: 'large', name: 'Large', recipeIngredient: Array.from({ length: 10_000 }, (_, index) => `${index + 1} pieces item ${index}`) };
  const before = structuredClone(recipe);
  const heapBefore = process.memoryUsage().heapUsed;
  const projectionStarted = performance.now();
  const projected = effectiveIngredientRecords(recipe);
  const projectionMs = performance.now() - projectionStarted;
  const projectionHeap = process.memoryUsage().heapUsed - heapBefore;
  assert.equal(projected.length, 10_000);
  assert.ok(projectionMs < 3_000, `10k projection took ${projectionMs}ms`);
  assert.ok(projectionHeap < 256 * 1024 * 1024, `10k projection retained/allocated ${projectionHeap} bytes`);
  assert.deepEqual(recipe, before);

  const duplicateRaw = '1 egg';
  const duplicateRecipe = {
    _id: 'duplicates',
    recipeIngredient: Array.from({ length: 10_000 }, () => duplicateRaw),
    ingredientNormalizations: Array.from({ length: 10_000 }, (_, occurrence) => ({
      ...normalizeIngredient(duplicateRaw),
      id: ingredientEvidenceId(duplicateRaw, occurrence),
    })),
  };
  const duplicateBaseline = {
    recipeIngredient: duplicateRecipe.recipeIngredient.slice(0, 2_500),
    ingredientNormalizations: duplicateRecipe.ingredientNormalizations.slice(0, 2_500),
  };
  const duplicateBaselineStarted = performance.now();
  effectiveIngredientRecords(duplicateBaseline);
  const duplicateBaselineMs = Math.max(performance.now() - duplicateBaselineStarted, 1);
  const duplicateStarted = performance.now();
  const duplicateProjection = effectiveIngredientRecords(duplicateRecipe);
  const duplicateMs = performance.now() - duplicateStarted;
  assert.equal(duplicateProjection.length, 10_000);
  assert.equal(new Set(duplicateProjection.map((record) => record.id)).size, 10_000);
  assert.ok(duplicateMs < duplicateBaselineMs * 8,
    `10k duplicate projection scaled quadratically: 2.5k=${duplicateBaselineMs}ms 10k=${duplicateMs}ms`);
  assert.ok(duplicateMs < 3_000, `10k duplicate-evidence projection took ${duplicateMs}ms`);

  const recipes = Array.from({ length: 5_000 }, (_, recipeIndex) => ({
    _id: `recipe-${recipeIndex}`, name: `Recipe ${String(recipeIndex).padStart(5, '0')}`,
    recipeIngredient: Array.from({ length: 20 }, (_, ingredientIndex) => `1 piece ingredient ${ingredientIndex}`),
  }));
  const indexStarted = performance.now();
  const index = buildRecipeUsageIndex(recipes);
  const indexMs = performance.now() - indexStarted;
  assert.equal(index.find('ingredient 1').length, 5_000);
  assert.ok(indexMs < 6_000, `5k x 20 usage index took ${indexMs}ms`);
});
