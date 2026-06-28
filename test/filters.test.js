// Tests for lib/filters.js and lib/format.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, filterRecipes } from '../docs/js/lib/filters.js';
import { esc, formatDuration, pluralize } from '../docs/js/lib/format.js';

// ── filters ────────────────────────────────────────────────
const RECIPES = [
  { _id: '1', name: 'Shakshuka', recipeCategory: 'Breakfast', recipeCuisine: 'Middle Eastern', recipeIngredient: ['eggs', 'tomatoes'] },
  { _id: '2', name: 'Carbonara', recipeCategory: 'Entree', recipeCuisine: 'Italian', recipeIngredient: ['spaghetti', 'eggs'] },
  { _id: '3', name: 'Tiramisu', recipeCategory: 'Dessert', recipeCuisine: 'Italian', recipeIngredient: ['mascarpone', 'coffee'] },
];

test('matchesSearch matches name', () => {
  assert.equal(matchesSearch(RECIPES[0], 'shak'), true);
  assert.equal(matchesSearch(RECIPES[0], 'pizza'), false);
});

test('matchesSearch matches cuisine and ingredients', () => {
  assert.equal(matchesSearch(RECIPES[1], 'italian'), true);
  assert.equal(matchesSearch(RECIPES[1], 'spaghetti'), true);
});

test('matchesSearch with empty term matches everything', () => {
  assert.equal(matchesSearch(RECIPES[0], ''), true);
});

test('filterRecipes by search term', () => {
  const out = filterRecipes(RECIPES, { searchTerm: 'italian' });
  assert.deepEqual(out.map((r) => r.name), ['Carbonara', 'Tiramisu']);
});

test('filterRecipes search is case-insensitive and trims', () => {
  const out = filterRecipes(RECIPES, { searchTerm: '  SHAK ' });
  assert.deepEqual(out.map((r) => r.name), ['Shakshuka']);
});

test('filterRecipes by category', () => {
  const out = filterRecipes(RECIPES, { categoryFilter: 'Dessert' });
  assert.deepEqual(out.map((r) => r.name), ['Tiramisu']);
});

test('filterRecipes by eligibility', () => {
  // pantry that completes Shakshuka only
  const out = filterRecipes(RECIPES, { eligibleOnly: true, pantry: ['eggs'] });
  // every recipe with at least one match counts as partial → included
  assert.deepEqual(out.map((r) => r.name).sort(), ['Carbonara', 'Shakshuka']);
});

test('filterRecipes excludes ineligible when toggle on', () => {
  const out = filterRecipes(RECIPES, { eligibleOnly: true, pantry: ['nonexistent'] });
  assert.equal(out.length, 0);
});

test('filterRecipes combines filters (AND)', () => {
  const out = filterRecipes(RECIPES, { searchTerm: 'italian', categoryFilter: 'Entree' });
  assert.deepEqual(out.map((r) => r.name), ['Carbonara']);
});

test('filterRecipes with no options returns all', () => {
  assert.equal(filterRecipes(RECIPES, {}).length, 3);
  assert.equal(filterRecipes(RECIPES).length, 3);
});

// ── format ─────────────────────────────────────────────────
test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<script>"&"</script>'), '&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
});

test('esc coerces non-strings', () => {
  assert.equal(esc(42), '42');
  assert.equal(esc(null), 'null');
});

test('formatDuration converts ISO 8601 durations', () => {
  assert.equal(formatDuration('PT10M'), '10m');
  assert.equal(formatDuration('PT1H'), '1h');
  assert.equal(formatDuration('PT1H30M'), '1h 30m');
  assert.equal(formatDuration('PT2H5M'), '2h 5m');
});

test('formatDuration returns null for empty input', () => {
  assert.equal(formatDuration(''), null);
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(undefined), null);
});

test('formatDuration echoes unrecognised strings', () => {
  assert.equal(formatDuration('garbage'), 'garbage');
});

test('pluralize adds s only when needed', () => {
  assert.equal(pluralize(1, 'recipe'), '1 recipe');
  assert.equal(pluralize(0, 'recipe'), '0 recipes');
  assert.equal(pluralize(2, 'recipe'), '2 recipes');
});
