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
  PANTRY_RAW_EVIDENCE_LIMITS,
  formatPantryAmount,
  pantryRecordsWouldCoalesce,
  restorePantryRecord,
  updatePantryRecord,
} from '../docs/js/lib/pantry.js';
import { normalizeIngredient } from '../docs/js/lib/cart.js';

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

test('addToPantry immediately repairs a supplied ID owned by a different record', () => {
  const salt = normalizePantryEntry({ id: 'shared-id', name: 'salt', unit: 'qualitative' });
  const result = addToPantry([salt], {
    id: 'shared-id', name: 'pepper', displayName: 'Pepper', unit: 'qualitative',
  });

  assert.equal(result.added, true);
  assert.equal(result.pantry.find((item) => item.name === 'salt').id, 'shared-id', 'existing stable ID is preserved');
  assert.notEqual(result.item.id, 'shared-id', 'new semantic record is repaired before publication');
  assert.match(result.item.id, /^pantry-/);
  assert.equal(new Set(result.pantry.map((item) => item.id)).size, result.pantry.length);
  assert.equal(
    normalizePantry(result.pantry).find((item) => item.name === 'pepper').id,
    result.item.id,
    'the deterministic repair is stable at later normalization',
  );
});

test('restore collision semantics exactly match every pair normalization would coalesce', () => {
  const record = (id, overrides = {}) => normalizePantryEntry({
    id, raw: '2 cups Olive Oil', name: 'olive oil', displayName: 'Olive Oil',
    quantity: 16, unit: 'ounce', kind: 'divisible', confidence: 1,
    ...overrides,
  });
  const cases = [
    ['qualitative then numeric', record('remote-q', { raw: 'Olive Oil', quantity: null, unit: 'qualitative', kind: 'qualitative' }), record('removed-n'), true],
    ['numeric then qualitative', record('remote-n'), record('removed-q', { raw: 'Olive Oil', quantity: null, unit: 'qualitative', kind: 'qualitative' }), true],
    ['same ounce identity', record('remote-ounce'), record('removed-ounce', { raw: '1 cup Olive Oil', quantity: 8 }), true],
    ['same count label', record('remote-bottle', { raw: '2 bottles water', name: 'water', displayName: 'Water', quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle' }), record('removed-bottle', { raw: '1 bottle water', name: 'water', displayName: 'Water', quantity: 1, unit: 'count', kind: 'indivisible', countLabel: 'bottle' }), true],
    ['different count labels', record('remote-can', { raw: '2 cans water', name: 'water', displayName: 'Water', quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'can' }), record('removed-bottle-2', { raw: '1 bottle water', name: 'water', displayName: 'Water', quantity: 1, unit: 'count', kind: 'indivisible', countLabel: 'bottle' }), false],
    ['different numeric families', record('remote-fluid'), record('removed-count', { raw: '2 Olive Oils', quantity: 2, unit: 'count', kind: 'indivisible', countLabel: '' }), false],
    ['different names', record('remote-oil'), record('removed-vinegar', { raw: '1 cup Vinegar', name: 'vinegar', displayName: 'Vinegar', quantity: 8 }), false],
  ];

  for (const [label, authority, restoring, wouldMerge] of cases) {
    assert.equal(pantryRecordsWouldCoalesce(authority, restoring), wouldMerge, label);
    assert.equal(pantryRecordsWouldCoalesce(restoring, authority), wouldMerge, `${label} is symmetric`);
    const normalized = normalizePantry([authority, restoring]);
    assert.equal(normalized.length < 2, wouldMerge, `${label} predicate matches normalizePantry`);
    if (wouldMerge) {
      assert.throws(() => restorePantryRecord([authority], restoring), /pantry_restore_conflict/, label);
    } else {
      const restored = restorePantryRecord([authority], restoring);
      assert.equal(restored.restored, true, label);
      assert.deepEqual(new Set(normalizePantry(restored.pantry).map(({ id }) => id)),
        new Set([authority.id, restoring.id]), `${label} preserves both stable IDs after normalization`);
    }
  }
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

test('togglePantry removes and returns the stored stable-ID record matched by Pantry identity', () => {
  const stored = normalizePantryEntry({
    id: 'cart-water-bottles', name: 'water', displayName: 'Water', raw: '2 bottles water',
    quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', category: 'pantry',
  });
  const pantry = normalizePantry([stored, '3 cans water']);
  const candidate = normalizePantryEntry('1 bottle water');
  assert.notEqual(candidate.id, stored.id, 'fresh normalization uses a different generated ID');

  const removed = togglePantry(pantry, candidate);

  assert.equal(removed.added, false);
  assert.equal(removed.item.id, stored.id, 'callers sync the actual stored record ID');
  assert.deepEqual(removed.pantry.map(({ id, countLabel }) => ({ id, countLabel })), [
    { id: pantry.find((item) => item.countLabel === 'can').id, countLabel: 'can' },
  ], 'the distinct same-name count record remains');
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

test('ambiguous quantity ranges stay unknown for Pantry across dash variants', () => {
  for (const raw of [
    '2-4 basil leaves',
    '2 - 4 basil leaves',
    '2–4 basil leaves',
    '2—4 basil leaves',
    '2 to 4 basil leaves',
  ]) {
    const parsed = normalizeIngredient(raw);
    const record = normalizePantryEntry(raw);
    assert.equal(parsed.quantityState, 'range', raw);
    assert.equal(record.amountState, 'unknown', raw);
    assert.equal(record.quantity, null, `${raw} must not collapse to either range endpoint`);
    assert.equal(record.unit, 'qualitative', raw);
    assert.equal(formatPantryAmount(record), 'Not sure', raw);
    assert.notEqual(formatPantryAmount(record), '4', raw);
  }

  assert.equal(normalizePantryEntry('4 basil leaves').amountState, 'known');
  assert.equal(normalizePantryEntry('2 cups olive oil').amountState, 'known');
  assert.equal(normalizePantryEntry('2 10-inch tortillas').amountState, 'known',
    'a quantity followed by a hyphenated item name is not a range');
  assert.equal(normalizeIngredient('sugar-free basil').quantityState, undefined,
    'an ordinary hyphenated ingredient name is not a range');
});

test('explicit normalized range evidence cannot be promoted to a known endpoint', () => {
  const record = normalizePantryEntry({
    raw: '2-4 basil leaves', name: 'basil leaf', displayName: 'Basil Leaves',
    quantity: 4, unit: 'count', kind: 'indivisible', confidence: 0.99,
  });
  assert.equal(record.amountState, 'unknown');
  assert.equal(record.quantity, null);
  assert.equal(record.unit, 'qualitative');
  assert.equal(formatPantryAmount(record), 'Not sure');
});

test('qualitative replacement and numeric consolidation preserve unique raw evidence', () => {
  const migrated = normalizePantry(['eggs', '3 eggs']);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].raw, '3 eggs', 'the numeric line is the useful primary UI evidence');
  assert.deepEqual(migrated[0].rawEvidence, ['eggs', '3 eggs']);
  assert.deepEqual(normalizePantry(migrated), migrated, 're-normalization does not duplicate evidence');

  const added = addToPantry(normalizePantry(['eggs']), '3 eggs');
  assert.equal(added.item.raw, '3 eggs');
  assert.deepEqual(added.item.rawEvidence, ['eggs', '3 eggs']);

  const consolidated = normalizePantry(['2 eggs', '3 eggs', '2 eggs']);
  assert.equal(consolidated[0].raw, '3 eggs');
  assert.deepEqual(consolidated[0].rawEvidence, ['2 eggs', '3 eggs']);
});

test('qualitative evidence cannot displace primary evidence for a trusted known amount', () => {
  const known = normalizePantry(['3 eggs']);
  const added = addToPantry(known, 'eggs');

  assert.equal(added.item.quantity, 3);
  assert.equal(added.item.unit, 'count');
  assert.equal(added.item.raw, '3 eggs');
  assert.deepEqual(added.item.rawEvidence, ['3 eggs', 'eggs']);
  assert.deepEqual(normalizePantry(added.pantry), added.pantry,
    'primary ranking and evidence order survive replay normalization');
});

test('raw evidence bounds oversized, numerous, incremental, and multibyte history deterministically', () => {
  assert.deepEqual(PANTRY_RAW_EVIDENCE_LIMITS, {
    maxPrimaryBytes: 512,
    maxEntryBytes: 512,
    maxTotalBytes: 4096,
    maxEntries: 16,
  });
  const bytes = (value) => new TextEncoder().encode(value).length;
  const oversized = '🥚'.repeat(60_000);
  assert.equal(oversized.length, 120_000, 'probe contains 120k UTF-16 code units');
  assert.equal(bytes(oversized), 240_000, 'probe is also genuinely multibyte UTF-8');
  const history = [
    'eggs',
    ...Array.from({ length: 220 }, (_, index) => `legacy-${String(index).padStart(3, '0')}-eggs`),
    oversized,
    '3 eggs',
  ];
  const source = {
    raw: '3 eggs', rawEvidence: history, name: 'egg', displayName: 'Egg',
    quantity: 3, unit: 'count', kind: 'indivisible', countLabel: '',
  };
  const first = normalizePantryEntry(source);
  const second = normalizePantryEntry(source);

  assert.deepEqual(second, first, 'the same hostile input has byte-for-byte deterministic output');
  assert.equal(first.raw, '3 eggs', 'the current known primary survives pruning');
  assert.ok(first.rawEvidence.includes('eggs'), 'useful legacy context survives pruning');
  assert.ok(first.rawEvidence.includes('3 eggs'), 'the current primary remains in evidence');
  assert.ok(bytes(first.raw) <= PANTRY_RAW_EVIDENCE_LIMITS.maxPrimaryBytes);
  assert.ok(first.rawEvidence.length <= PANTRY_RAW_EVIDENCE_LIMITS.maxEntries);
  assert.ok(first.rawEvidence.every((value) => bytes(value) <= PANTRY_RAW_EVIDENCE_LIMITS.maxEntryBytes));
  assert.ok(first.rawEvidence.reduce((total, value) => total + bytes(value), 0)
    <= PANTRY_RAW_EVIDENCE_LIMITS.maxTotalBytes);
  assert.ok(first.rawEvidence.every((value) => !value.includes('\uFFFD')),
    'UTF-8 truncation never leaves a split replacement character');

  const oversizedPrimary = normalizePantryEntry({
    raw: oversized, rawEvidence: [oversized], name: 'egg', displayName: 'Egg',
    quantity: null, unit: 'qualitative', kind: 'qualitative',
  });
  assert.ok(bytes(oversizedPrimary.raw) <= PANTRY_RAW_EVIDENCE_LIMITS.maxPrimaryBytes);
  assert.ok(oversizedPrimary.rawEvidence.includes(oversizedPrimary.raw),
    'a truncated unknown primary remains represented in its evidence');

  const accumulate = () => {
    let pantry = normalizePantry(['3 eggs']);
    for (let index = 0; index < 250; index += 1) {
      pantry = addToPantry(pantry, {
        raw: `correction-${String(index).padStart(3, '0')}-${'🥚'.repeat(200)}`,
        name: 'egg', displayName: 'Egg', quantity: null, unit: 'qualitative', kind: 'qualitative',
      }).pantry;
    }
    return pantry[0];
  };
  const incrementallyBounded = accumulate();
  assert.deepEqual(accumulate(), incrementallyBounded, 'incremental retention is deterministic');
  assert.equal(incrementallyBounded.raw, '3 eggs');
  assert.ok(incrementallyBounded.rawEvidence.length <= PANTRY_RAW_EVIDENCE_LIMITS.maxEntries);
  assert.ok(incrementallyBounded.rawEvidence.reduce((total, value) => total + bytes(value), 0)
    <= PANTRY_RAW_EVIDENCE_LIMITS.maxTotalBytes);

  const unknownContext = addToPantry(normalizePantry(['eggs']), {
    raw: 'eggs from market', name: 'egg', displayName: 'Egg',
    quantity: null, unit: 'qualitative', kind: 'qualitative',
  }).item;
  assert.equal(unknownContext.raw, 'eggs from market',
    'unknown amounts prefer the newest explicit correction context');
  assert.deepEqual(unknownContext.rawEvidence, ['eggs', 'eggs from market']);
});

test('raw evidence treats explicit semicolon-bearing source lines losslessly', () => {
  const [record] = normalizePantry([{
    raw: 'salt; smoked', rawEvidence: ['salt; smoked'], name: 'smoked salt',
    displayName: 'Smoked Salt', quantity: null, unit: 'qualitative', kind: 'qualitative',
  }]);
  assert.equal(record.raw, 'salt; smoked');
  assert.deepEqual(record.rawEvidence, ['salt; smoked']);
  assert.deepEqual(normalizePantry([record]), [record]);
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

test('updatePantryRecord keeps old and new raw lines without changing the new primary', () => {
  const [original] = normalizePantry(['basil leaves']);
  const [updated] = updatePantryRecord([original], original.id, '4 basil leaves', { updatedAt: 200 });
  assert.equal(updated.raw, '4 basil leaves');
  assert.deepEqual(updated.rawEvidence, ['basil leaves', '4 basil leaves']);
  assert.deepEqual(normalizePantry([updated])[0].rawEvidence, updated.rawEvidence);
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
