import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRecipeInHtml, hasRequiredFields, toSimpleRecipe, buildExtractionPrompt, parseLLMRecipe } from '../functions/_lib/extract.js';

const wrap = (json) => `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;

test('findRecipeInHtml finds a top-level Recipe', () => {
  const html = wrap(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: ['Bake'] }));
  const r = findRecipeInHtml(html);
  assert.equal(r.name, 'Pie');
});

test('findRecipeInHtml unwraps @graph', () => {
  const html = wrap(JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList' },
    { '@type': 'Recipe', name: 'Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] },
  ] }));
  const r = findRecipeInHtml(html);
  assert.equal(r.name, 'Soup');
});

test('findRecipeInHtml accepts @type as an array', () => {
  const html = wrap(JSON.stringify({ '@type': ['Article', 'Recipe'], name: 'X', recipeIngredient: ['a'], recipeInstructions: ['b'] }));
  assert.equal(findRecipeInHtml(html)?.name, 'X');
});

test('findRecipeInHtml returns null when no Recipe', () => {
  const html = wrap(JSON.stringify({ '@type': 'Article', name: 'Nope' }));
  assert.equal(findRecipeInHtml(html), null);
});

test('findRecipeInHtml tolerates a broken ld+json block and still parses others', () => {
  const html = `<html><head>
    <script type="application/ld+json">{ broken json</script>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Ok', recipeIngredient: ['a'], recipeInstructions: ['b'] })}</script>
  </head></html>`;
  assert.equal(findRecipeInHtml(html)?.name, 'Ok');
});

test('hasRequiredFields checks name + ingredients + instructions', () => {
  assert.equal(hasRequiredFields({ name: 'X', recipeIngredient: ['a'], recipeInstructions: ['b'] }), true);
  assert.equal(hasRequiredFields({ name: 'X', recipeIngredient: [], recipeInstructions: ['b'] }), false);
  assert.equal(hasRequiredFields({ name: '', recipeIngredient: ['a'], recipeInstructions: ['b'] }), false);
  assert.equal(hasRequiredFields({ recipeIngredient: ['a'], recipeInstructions: ['b'] }), false);
});

test('toSimpleRecipe flattens HowToStep instructions to text', () => {
  const r = toSimpleRecipe({ '@type': 'Recipe', name: 'X', recipeIngredient: ['a'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Step 1' }, { '@type': 'HowToStep', text: 'Step 2' }] });
  assert.deepEqual(r.recipeInstructions, ['Step 1', 'Step 2']);
  assert.equal(r['@type'], 'Recipe');
});

test('buildExtractionPrompt returns system + user messages', () => {
  const msgs = buildExtractionPrompt('mix and bake');
  assert.ok(Array.isArray(msgs));
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes('schema.org/Recipe'));
  assert.equal(msgs[1].role, 'user');
  assert.ok(msgs[1].content.includes('mix and bake'));
});

test('parseLLMRecipe extracts JSON from fenced output', () => {
  const out = 'Here you go:\n```json\n{"@type":"Recipe","name":"T","recipeIngredient":["a"],"recipeInstructions":["b"]}\n```\nThanks';
  const r = parseLLMRecipe(out);
  assert.equal(r?.name, 'T');
});

test('parseLLMRecipe extracts bare JSON', () => {
  const r = parseLLMRecipe('{"@type":"Recipe","name":"T","recipeIngredient":["a"],"recipeInstructions":["b"]}');
  assert.equal(r?.name, 'T');
});

test('parseLLMRecipe returns null for incomplete output', () => {
  assert.equal(parseLLMRecipe('{"@type":"Recipe","name":"T"}'), null);
  assert.equal(parseLLMRecipe('not json at all'), null);
});