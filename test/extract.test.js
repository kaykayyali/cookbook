import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRecipeInHtml, hasRequiredFields, toSimpleRecipe, buildExtractionPrompt, parseLLMRecipe, isBlockedUrl, cleanText, extractRecipe, handleExtract } from '../functions/_lib/extract.js';

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

test('isBlockedUrl rejects non-https, localhost, and private IPs', () => {
  assert.equal(isBlockedUrl('http://example.com'), true);
  assert.equal(isBlockedUrl('https://localhost'), true);
  assert.equal(isBlockedUrl('https://app.localhost'), true);
  assert.equal(isBlockedUrl('https://10.0.0.1'), true);
  assert.equal(isBlockedUrl('https://127.0.0.1'), true);
  assert.equal(isBlockedUrl('https://192.168.1.1'), true);
  assert.equal(isBlockedUrl('https://169.254.1.1'), true);
  assert.equal(isBlockedUrl('https://example.com'), false);
  assert.equal(isBlockedUrl('https://8.8.8.8'), false);
});

test('cleanText strips scripts/nav and collapses whitespace', () => {
  const html = '<nav>menu</nav><p>Hello   world</p><script>alert(1)</script>';
  const t = cleanText(html);
  assert.ok(!t.includes('alert'));
  assert.ok(!t.includes('menu'));
  assert.ok(t.includes('Hello'));
  assert.ok(!t.includes('  ')); // no double spaces
});

test('extractRecipe uses embedded JSON-LD without calling the LLM', async () => {
  const html = '<script type="application/ld+json">{"@type":"Recipe","name":"Pie","recipeIngredient":["1 crust"],"recipeInstructions":["Bake"]}</script>';
  let llmCalled = false;
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html }),
    runLLM: async () => { llmCalled = true; return ''; },
  };
  const res = await extractRecipe('https://example.com/pie', deps);
  assert.equal(res.ok, true);
  assert.equal(res.recipe.name, 'Pie');
  assert.equal(llmCalled, false);
});

test('extractRecipe falls back to the LLM when no JSON-LD', async () => {
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html: '<p>boil water, add pasta</p>' }),
    runLLM: async () => JSON.stringify({ '@type': 'Recipe', name: 'Pasta', recipeIngredient: ['water', 'pasta'], recipeInstructions: ['Boil', 'Add pasta'] }),
  };
  const res = await extractRecipe('https://example.com/pasta', deps);
  assert.equal(res.ok, true);
  assert.equal(res.recipe.name, 'Pasta');
});

test('extractRecipe returns a 422-ish failure when both fail', async () => {
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html: '<p>no recipe here</p>' }),
    runLLM: async () => 'sorry, no recipe',
  };
  const res = await extractRecipe('https://example.com/x', deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
});

test('extractRecipe surfaces a fetch failure', async () => {
  const deps = { fetchPage: async () => ({ ok: false, status: 502, html: '' }), runLLM: async () => '' };
  const res = await extractRecipe('https://example.com/x', deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 502);
});

test('handleExtract validates the URL first', async () => {
  const res = await handleExtract({ url: 'not-a-url' }, {}, {});
  assert.equal(res.status, 400);
});

test('handleExtract blocks SSRF URLs', async () => {
  const res = await handleExtract({ url: 'https://10.0.0.1' }, {}, { fetchPage: async () => ({ ok: true, status: 200, html: '' }), runLLM: async () => '' });
  assert.equal(res.status, 400);
});

test('handleExtract returns 200 with recipe on success', async () => {
  const deps = { fetchPage: async () => ({ ok: true, status: 200, html: '<script type="application/ld+json">{"@type":"Recipe","name":"T","recipeIngredient":["a"],"recipeInstructions":["b"]}</script>' }), runLLM: async () => '' };
  const res = await handleExtract({ url: 'https://example.com/t' }, {}, deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.recipe.name, 'T');
});