import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRecipeInHtml, hasRequiredFields } from '../functions/_lib/extract.js';

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