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
} from '../docs/js/lib/pantry.js';

test('haveIngredient matches by substring', () => {
  const pantry = ['olive oil', 'eggs'];
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
  const before = ['eggs'];
  const { pantry, added, name } = addToPantry(before, '  Olive Oil ');
  assert.equal(added, true);
  assert.equal(name, 'olive oil');
  assert.deepEqual(pantry, ['eggs', 'olive oil']);
  assert.deepEqual(before, ['eggs'], 'original array unchanged');
});

test('addToPantry refuses duplicates and blanks', () => {
  assert.equal(addToPantry(['eggs'], 'eggs').added, false);
  assert.equal(addToPantry(['eggs'], '   ').added, false);
});

test('removeFromPantry removes case-insensitively and immutably', () => {
  const before = ['eggs', 'olive oil'];
  const after = removeFromPantry(before, 'EGGS');
  assert.deepEqual(after, ['olive oil']);
  assert.deepEqual(before, ['eggs', 'olive oil'], 'original unchanged');
});

test('togglePantry adds when absent, removes when present', () => {
  const add = togglePantry(['eggs'], 'flour');
  assert.equal(add.added, true);
  assert.deepEqual(add.pantry, ['eggs', 'flour']);

  const remove = togglePantry(['eggs', 'flour'], 'flour');
  assert.equal(remove.added, false);
  assert.deepEqual(remove.pantry, ['eggs']);
});

test('normalizePantry migrates legacy object entries to strings', () => {
  const legacy = [{ name: 'Olive Oil', quantity: '2 tbsp' }, 'EGGS', '  ', { name: '' }];
  assert.deepEqual(normalizePantry(legacy), ['olive oil', 'eggs']);
});

test('normalizePantry tolerates non-arrays', () => {
  assert.deepEqual(normalizePantry(null), []);
  assert.deepEqual(normalizePantry(undefined), []);
});
