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
  assert.deepEqual(item, {
    name: 'olive oil', displayName: 'Olive Oil', quantity: 8,
    unit: 'ounce', kind: 'divisible', countLabel: '', category: 'pantry',
  });
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
  assert.deepEqual(normalizePantryEntry({
    name: 'Milk', displayName: 'Whole Milk', quantity: 17.6,
    unit: 'ounce', kind: 'divisible', countLabel: '', category: 'dairy-eggs',
  }), {
    name: 'milk', displayName: 'Whole Milk', quantity: 17.6,
    unit: 'ounce', kind: 'divisible', countLabel: '', category: 'dairy-eggs',
  });
});

test('normalizePantry tolerates non-arrays', () => {
  assert.deepEqual(normalizePantry(null), []);
  assert.deepEqual(normalizePantry(undefined), []);
});
