// Tests for lib/schema.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSchema, fromSchema, parseImport, uuid } from '../docs/js/lib/schema.js';

test('uuid produces unique v4-shaped strings', () => {
  const a = uuid();
  const b = uuid();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/i);
});

test('toSchema emits a valid schema.org/Recipe envelope', () => {
  const r = { name: 'Test', recipeIngredient: ['1 egg'], recipeInstructions: ['Cook it'] };
  const s = toSchema(r);
  assert.equal(s['@context'], 'https://schema.org');
  assert.equal(s['@type'], 'Recipe');
  assert.equal(s.name, 'Test');
});

test('toSchema wraps instructions as positioned HowToStep objects', () => {
  const r = { name: 'X', recipeInstructions: ['First', 'Second'] };
  const s = toSchema(r);
  assert.equal(s.recipeInstructions.length, 2);
  assert.deepEqual(s.recipeInstructions[0], { '@type': 'HowToStep', position: 1, text: 'First' });
  assert.equal(s.recipeInstructions[1].position, 2);
});

test('toSchema omits empty optional fields', () => {
  const s = toSchema({ name: 'X' });
  assert.ok(!('prepTime' in s));
  assert.ok(!('nutrition' in s));
  assert.ok(!('recipeIngredient' in s));
});

test('toSchema includes nutrition only when a value is present', () => {
  const withNut = toSchema({ name: 'X', nutrition: { calories: '100 kcal' } });
  assert.equal(withNut.nutrition['@type'], 'NutritionInformation');
  assert.equal(withNut.nutrition.calories, '100 kcal');

  const emptyNut = toSchema({ name: 'X', nutrition: { servingSize: '1 cup' } });
  // servingSize alone (no calories/macros) does not trigger the block
  assert.ok(!('nutrition' in emptyNut));
});

test('toSchema derives datePublished from dateCreated', () => {
  const s = toSchema({ name: 'X', dateCreated: '2024-03-01T12:34:56.000Z' });
  assert.equal(s.datePublished, '2024-03-01');
});

test('fromSchema fills defaults for a minimal object', () => {
  const r = fromSchema({ name: 'Bare' });
  assert.equal(r.name, 'Bare');
  assert.ok(r._id);
  assert.deepEqual(r.recipeIngredient, []);
  assert.deepEqual(r.recipeInstructions, []);
});

test('fromSchema flattens HowToStep instructions to strings', () => {
  const r = fromSchema({
    name: 'X',
    recipeInstructions: [
      { '@type': 'HowToStep', position: 1, text: 'Step one' },
      { '@type': 'HowToStep', position: 2, text: 'Step two' },
    ],
  });
  assert.deepEqual(r.recipeInstructions, ['Step one', 'Step two']);
});

test('fromSchema accepts string instructions too', () => {
  const r = fromSchema({ name: 'X', recipeInstructions: ['plain string step'] });
  assert.deepEqual(r.recipeInstructions, ['plain string step']);
});

test('fromSchema coerces a single non-array instruction', () => {
  const r = fromSchema({ name: 'X', recipeInstructions: 'do the thing' });
  assert.deepEqual(r.recipeInstructions, ['do the thing']);
});

test('round-trip preserves core fields', () => {
  const original = {
    name: 'Round Trip',
    recipeCategory: 'Entree',
    recipeCuisine: 'Italian',
    prepTime: 'PT10M',
    recipeIngredient: ['200g pasta', '2 eggs'],
    recipeInstructions: ['Boil', 'Mix'],
    nutrition: { calories: '500 kcal', proteinContent: '20 g' },
  };
  const back = fromSchema(toSchema(original));
  assert.equal(back.name, original.name);
  assert.equal(back.recipeCategory, original.recipeCategory);
  assert.equal(back.prepTime, original.prepTime);
  assert.deepEqual(back.recipeIngredient, original.recipeIngredient);
  assert.deepEqual(back.recipeInstructions, original.recipeInstructions);
  assert.equal(back.nutrition.calories, '500 kcal');
});

test('parseImport handles a single object', () => {
  const out = parseImport({ '@type': 'Recipe', name: 'Solo' });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Solo');
});

test('parseImport handles an array and filters non-recipes', () => {
  const out = parseImport([
    { '@type': 'Recipe', name: 'A' },
    { name: 'B' }, // has name → kept
    { foo: 'bar' }, // no name/type → dropped
    null, // dropped
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.name), ['A', 'B']);
});
