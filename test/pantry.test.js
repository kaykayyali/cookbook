// Tests for lib/pantry.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haveIngredient,
  eligibility,
  ingredientCounts,
  baseName,
  parseIngredient,
  allRecipeIngredients,
  addToPantry,
  removeFromPantry,
  togglePantry,
  normalizePantry,
  normalizePantryEntry,
  formatPantryAmount,
  updatePantryRecord,
} from '../docs/js/lib/pantry.js';

test('haveIngredient matches by substring', () => {
  const pantry = [
    { name: 'olive oil', quantity: 8, unit: 'ounce', kind: 'divisible' },
    { name: 'egg', quantity: 6, unit: 'count', kind: 'indivisible' },
  ];
  assert.equal(haveIngredient('2 tablespoons olive oil', pantry), true);
  assert.equal(haveIngredient('6 large eggs', pantry), true);
  assert.equal(haveIngredient('1 cup flour', pantry), false);
});

test('haveIngredient is case-insensitive on the recipe side', () => {
  assert.equal(haveIngredient('2 tbsp OLIVE OIL', ['olive oil']), true);
});

test('haveIngredient matches whole canonical ingredient phrases, not substrings inside other foods', () => {
  assert.equal(haveIngredient('1 eggplant', normalizePantry(['eggs'])), false);
  assert.equal(haveIngredient('2 tablespoons extra virgin olive oil', ['olive oil']), true);
});

test('haveIngredient rejects non-strings', () => {
  assert.equal(haveIngredient(null, ['x']), false);
  assert.equal(haveIngredient(undefined, ['x']), false);
  assert.equal(haveIngredient(42, ['x']), false);
});

test('eligibility classifies complete / partial / none', () => {
  const recipe = { recipeIngredient: ['olive oil', 'eggs', 'flour'] };
  assert.equal(eligibility(recipe, ['olive oil', 'eggs', 'flour']), 'complete');
  assert.equal(eligibility(recipe, ['olive oil']), 'partial');
  assert.equal(eligibility(recipe, ['butter']), 'none');
});

test('eligibility of an empty recipe is none', () => {
  assert.equal(eligibility({ recipeIngredient: [] }, ['anything']), 'none');
  assert.equal(eligibility({}, ['anything']), 'none');
});

test('ingredientCounts returns have/total', () => {
  const r = { recipeIngredient: ['a', 'b', 'c'] };
  assert.deepEqual(ingredientCounts(r, ['a', 'c']), { have: 2, total: 3 });
});

test('baseName strips quantities and units', () => {
  assert.equal(baseName('2 tablespoons olive oil'), 'olive oil');
  assert.equal(baseName('400g spaghetti'), 'spaghetti');
  assert.equal(baseName('¼ tsp chili powder'), 'chili powder');
  assert.equal(baseName('4 garlic cloves, finely chopped'), 'garlic cloves, finely chopped');
  assert.equal(baseName('1 (28-oz) can whole peeled tomatoes'), '(28-oz) can whole peeled tomatoes');
});

test('baseName lowercases output', () => {
  assert.equal(baseName('2 cups FLOUR'), 'flour');
});

test('parseIngredient captures leading qty+unit and lowercases the name', () => {
  assert.deepEqual(parseIngredient('2 tablespoons olive oil'), { qtyText: '2 tablespoons', name: 'olive oil' });
  assert.deepEqual(parseIngredient('400g spaghetti'), { qtyText: '400g', name: 'spaghetti' });
  assert.deepEqual(parseIngredient('6 large eggs'), { qtyText: '6 large', name: 'eggs' });
  assert.deepEqual(parseIngredient('salt and pepper to taste'), { qtyText: '', name: 'salt and pepper to taste' });
});

test('parseIngredient tolerates non-strings', () => {
  assert.deepEqual(parseIngredient(null), { qtyText: '', name: '' });
  assert.deepEqual(parseIngredient(undefined), { qtyText: '', name: '' });
});

test('allRecipeIngredients dedupes and sorts base + full forms', () => {
  const recipes = [
    { recipeIngredient: ['2 tablespoons olive oil', '6 large eggs'] },
    { recipeIngredient: ['1 tablespoon olive oil'] }, // base "olive oil" duplicates
  ];
  const list = allRecipeIngredients(recipes);
  // contains base names
  assert.ok(list.includes('olive oil'));
  assert.ok(list.includes('eggs'));
  // contains full normalised forms
  assert.ok(list.includes('2 tablespoons olive oil'));
  // sorted
  const sorted = [...list].sort();
  assert.deepEqual(list, sorted);
  // no duplicates
  assert.equal(list.length, new Set(list).size);
});

test('addToPantry adds a new lowercase item immutably', () => {
  const before = [normalizePantryEntry('eggs')];
  const { pantry, added, name, item } = addToPantry(before, {
    name: 'Olive Oil', displayName: 'Olive Oil', quantity: 8,
    unit: 'ounce', kind: 'divisible', category: 'pantry',
  });
  assert.equal(added, true);
  assert.equal(name, 'olive oil');
  assert.deepEqual(
    (({ name, displayName, quantity, unit, kind, countLabel, category, amountState }) => (
      { name, displayName, quantity, unit, kind, countLabel, category, amountState }
    ))(item),
    {
      name: 'olive oil', displayName: 'Olive Oil', quantity: 8,
      unit: 'ounce', kind: 'divisible', countLabel: '', category: 'pantry', amountState: 'known',
    },
  );
  assert.match(item.id, /^pantry-/);
  assert.equal(item.raw, '8 ounce Olive Oil');
  assert.equal(pantry.length, 2);
  assert.deepEqual(before, [normalizePantryEntry('eggs')], 'original array unchanged');
});

test('addToPantry accumulates compatible normalized quantities', () => {
  const first = addToPantry([], {
    name: 'egg', quantity: 9, unit: 'count', kind: 'indivisible', category: 'dairy-eggs',
  });
  const second = addToPantry(first.pantry, {
    name: 'eggs', quantity: 3, unit: 'count', kind: 'indivisible', category: 'dairy-eggs',
  });
  assert.equal(second.added, true);
  assert.equal(second.pantry.length, 1);
  assert.equal(second.pantry[0].quantity, 12);
  assert.equal(second.pantry[0].unit, 'count');
});

test('count package labels are part of Pantry quantity compatibility and removal identity', () => {
  const bottles = normalizePantryEntry('2 bottles water');
  const cans = normalizePantryEntry('3 cans water');
  const unlabeled = normalizePantryEntry({ name: 'water', quantity: 4, unit: 'count', kind: 'indivisible', countLabel: '' });
  const pantry = normalizePantry([bottles, cans, unlabeled]);
  assert.deepEqual(pantry.map(({ quantity, countLabel }) => ({ quantity, countLabel })), [
    { quantity: 2, countLabel: 'bottle' },
    { quantity: 3, countLabel: 'can' },
    { quantity: 4, countLabel: '' },
  ]);
  assert.deepEqual(removeFromPantry(pantry, bottles).map(({ quantity, countLabel }) => ({ quantity, countLabel })), [
    { quantity: 3, countLabel: 'can' },
    { quantity: 4, countLabel: '' },
  ]);
  assert.deepEqual(removeFromPantry(pantry, { name: 'water', unit: 'count', countLabel: '' })
    .map(({ quantity, countLabel }) => ({ quantity, countLabel })), [
    { quantity: 2, countLabel: 'bottle' },
    { quantity: 3, countLabel: 'can' },
  ]);
});

test('togglePantry distinguishes count labels for quantity-bearing strings', () => {
  const cans = normalizePantry(['3 cans water']);
  const added = togglePantry(cans, '2 bottles water');
  assert.equal(added.added, true);
  assert.deepEqual(added.pantry.map(({ quantity, countLabel }) => ({ quantity, countLabel })), [
    { quantity: 3, countLabel: 'can' },
    { quantity: 2, countLabel: 'bottle' },
  ]);
  const removed = togglePantry(added.pantry, '2 bottles water');
  assert.equal(removed.added, false);
  assert.deepEqual(removed.pantry.map(({ quantity, countLabel }) => ({ quantity, countLabel })), [
    { quantity: 3, countLabel: 'can' },
  ]);
});

test('an invalid explicit count label fails closed instead of broadening removal', () => {
  const pantry = normalizePantry(['2 bottles water', '3 cans water']);
  assert.deepEqual(removeFromPantry(pantry, { name: 'water', unit: 'count', countLabel: 'crate' }), pantry);
});

test('togglePantry fails closed for an invalid explicit count label', () => {
  const pantry = normalizePantry([
    '2 bottles water',
    '3 cans water',
    { name: 'water', quantity: 4, unit: 'count', kind: 'indivisible', countLabel: '' },
  ]);
  const result = togglePantry(pantry, {
    name: 'water', quantity: 1, unit: 'count', kind: 'indivisible', countLabel: 'crate',
  });
  assert.equal(result.added, false);
  assert.deepEqual(result.pantry, pantry);
});

test('addToPantry refuses duplicate qualitative entries and blanks', () => {
  const eggs = [normalizePantryEntry('eggs')];
  assert.equal(addToPantry(eggs, 'eggs').added, false);
  assert.equal(addToPantry(eggs, '   ').added, false);
});

test('removeFromPantry removes case-insensitively and immutably', () => {
  const before = normalizePantry(['eggs', { name: 'olive oil', quantity: 8, unit: 'ounce', kind: 'divisible' }]);
  const after = removeFromPantry(before, 'EGGS');
  assert.deepEqual(after.map((item) => item.name), ['olive oil']);
  assert.equal(before.length, 2, 'original unchanged');
});

test('togglePantry adds when absent, removes when present', () => {
  const add = togglePantry(normalizePantry(['eggs']), 'flour');
  assert.equal(add.added, true);
  assert.deepEqual(add.pantry.map((item) => item.name), ['egg', 'flour']);

  const remove = togglePantry(normalizePantry(['eggs', 'flour']), 'flour');
  assert.equal(remove.added, false);
  assert.deepEqual(remove.pantry.map((item) => item.name), ['egg']);
});

test('normalizePantry migrates strings and legacy quantity objects to normalized entries', () => {
  const legacy = [{ name: 'Olive Oil', quantity: '2 tbsp' }, 'EGGS', '  ', { name: '' }];
  const pantry = normalizePantry(legacy);
  assert.deepEqual(pantry.map(({ name, quantity, unit }) => ({ name, quantity, unit })), [
    { name: 'egg', quantity: null, unit: 'qualitative' },
    { name: 'olive oil', quantity: 1, unit: 'ounce' },
  ]);
});

test('normalizePantryEntry preserves the shared Shopping quantity contract', () => {
  const record = normalizePantryEntry({
    name: 'Milk', displayName: 'Whole Milk', quantity: 17.6,
    unit: 'ounce', kind: 'divisible', countLabel: '', category: 'dairy-eggs',
  });
  assert.deepEqual(
    (({ name, displayName, quantity, unit, kind, countLabel, category, amountState, measurementFamily }) => ({
      name, displayName, quantity, unit, kind, countLabel, category, amountState, measurementFamily,
    }))(record),
    {
      name: 'milk', displayName: 'Whole Milk', quantity: 17.6,
      unit: 'ounce', kind: 'divisible', countLabel: '', category: 'dairy-eggs',
      amountState: 'known', measurementFamily: 'water-equivalent',
    },
  );
  assert.match(record.id, /^pantry-/);
});

test('black pepper normalizes as a Pantry spice and displays in practical teaspoons', () => {
  const item = normalizePantryEntry('1 1/2 teaspoons black pepper');
  assert.equal(item.category, 'pantry');
  assert.equal(formatPantryAmount(item), '1½ tsp');
});

test('normalizePantry tolerates non-arrays', () => {
  assert.deepEqual(normalizePantry(null), []);
  assert.deepEqual(normalizePantry(undefined), []);
});

test('legacy Pantry migration creates deterministic editable records without losing raw evidence', () => {
  const legacy = [
    '2 cups olive oil',
    'to 4 basil leaves',
    { name: 'Milk', displayName: 'Whole Milk', quantity: 12, unit: 'ounce', kind: 'divisible' },
  ];
  const first = normalizePantry(legacy);
  const second = normalizePantry(legacy);
  assert.deepEqual(second, first, 'read-time migration is deterministic and idempotent');
  assert.equal(new Set(first.map((item) => item.id)).size, 3);
  for (const item of first) {
    assert.match(item.id, /^pantry-[a-z0-9-]+$/);
    assert.ok(['known', 'unknown'].includes(item.amountState));
    assert.ok(['count', 'water-equivalent', 'unknown'].includes(item.measurementFamily));
    assert.equal(typeof item.raw, 'string');
    assert.equal(typeof item.confidence, 'number');
    assert.equal(item.normalizationVersion, 1);
    assert.equal(typeof item.updatedAt, 'number');
  }
  const malformed = first.find((item) => item.raw === 'to 4 basil leaves');
  assert.ok(malformed, 'malformed original input remains available for later correction');
  assert.equal(malformed.amountState, 'unknown');
  assert.equal(formatPantryAmount(malformed), 'Not sure');
});

test('Pantry amount state hides missing and low-confidence guesses but keeps known canonical conversions', () => {
  const known = normalizePantryEntry('2 cups olive oil');
  const lowConfidence = normalizePantryEntry({
    raw: 'maybe 4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
    quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.45,
  });
  assert.equal(known.amountState, 'known');
  assert.equal(known.measurementFamily, 'water-equivalent');
  assert.equal(known.quantity, 16, 'water-equivalent canonical conversion is unchanged');
  assert.equal(formatPantryAmount(known), '2 cups');
  assert.equal(lowConfidence.amountState, 'unknown');
  assert.equal(formatPantryAmount(lowConfidence), 'Not sure');
  assert.doesNotMatch(formatPantryAmount(lowConfidence), /as needed/i);
});

test('updatePantryRecord edits by stable ID and advances only that record timestamp', () => {
  const current = normalizePantry(['to 4 basil leaves', 'salt']);
  const original = current.find((item) => item.raw === 'to 4 basil leaves');
  const salt = current.find((item) => item.name === 'salt');
  const updated = updatePantryRecord(current, original.id, {
    raw: '4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
    quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.95,
  }, { updatedAt: 200 });
  assert.equal(updated.length, 2);
  assert.equal(updated.find((item) => item.id === original.id).id, original.id, 'identity survives correction');
  assert.equal(updated.find((item) => item.id === original.id).amountState, 'known');
  assert.equal(updated.find((item) => item.id === original.id).updatedAt, 200);
  assert.deepEqual(updated.find((item) => item.id === salt.id), salt, 'unrelated Pantry records are untouched');
  assert.throws(() => updatePantryRecord(updated, 'missing-id', 'basil'), /pantry_record_not_found/);
});

test('migration deterministically repairs duplicate historical record IDs', () => {
  const records = normalizePantry([
    { id: 'duplicate-id', name: 'salt', quantity: null, unit: 'qualitative' },
    { id: 'duplicate-id', name: 'pepper', quantity: null, unit: 'qualitative' },
  ]);
  assert.equal(new Set(records.map((record) => record.id)).size, 2);
  assert.equal(records.find((record) => record.name === 'salt').id, 'duplicate-id');
  assert.match(records.find((record) => record.name === 'pepper').id, /^pantry-/);
  assert.deepEqual(normalizePantry(records), records, 'repaired IDs remain stable on later reads');
});
