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

test('findRecipeInHtml handles unquoted type attribute (HTML5)', () => {
  const html = `<script type=application/ld+json>${JSON.stringify({ '@type': 'Recipe', name: 'Unquoted', recipeIngredient: ['a'], recipeInstructions: ['b'] })}</script>`;
  assert.equal(findRecipeInHtml(html)?.name, 'Unquoted');
});

test('findRecipeInHtml repairs extra trailing brace in JSON-LD', () => {
  const json = JSON.stringify({ '@type': 'Recipe', name: 'Fixed', recipeIngredient: ['a'], recipeInstructions: ['b'] });
  const broken = json + '}'; // double closing brace
  const html = `<script type="application/ld+json">${broken}</script>`;
  assert.equal(findRecipeInHtml(html)?.name, 'Fixed');
});

test('findRecipeInHtml traverses nested arrays in @graph', () => {
  const html = wrap(JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList' },
    [{ '@type': 'Recipe', name: 'Nested', recipeIngredient: ['a'], recipeInstructions: ['b'] }],
  ] }));
  assert.equal(findRecipeInHtml(html)?.name, 'Nested');
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

test('toSimpleRecipe recursively flattens HowToSection instructions', () => {
  const r = toSimpleRecipe({
    '@type': 'Recipe', name: 'Tsukemen', recipeIngredient: ['noodles'],
    recipeInstructions: [
      { '@type': 'HowToSection', name: 'Prepare', itemListElement: [
        { '@type': 'HowToStep', text: 'Make the ramen eggs.' },
        { '@type': 'HowToStep', text: 'Slice the pork.' },
      ] },
      { '@type': 'HowToSection', name: 'Cook', itemListElement: [
        { '@type': 'HowToStep', text: 'Cook the noodles.' },
      ] },
    ],
  });

  assert.deepEqual(r.recipeInstructions, [
    'Make the ramen eggs.',
    'Slice the pork.',
    'Cook the noodles.',
  ]);
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

test('isBlockedUrl catches IPv4-mapped IPv6 private literals', () => {
  // ::ffff:127.0.0.1 and ::ffff:10.0.0.1 embed private IPv4 quads and must be
  // blocked; ::ffff:8.8.8.8 embeds a public IPv4 and must not be blocked.
  assert.equal(isBlockedUrl('https://[::ffff:127.0.0.1]'), true);
  assert.equal(isBlockedUrl('https://[::ffff:10.0.0.1]'), true);
  assert.equal(isBlockedUrl('https://[::ffff:8.8.8.8]'), false);
  // The native private IPv6 forms still work.
  assert.equal(isBlockedUrl('https://[::1]'), true);
  assert.equal(isBlockedUrl('https://[fe80::1]'), true);
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

// ── #1: repair pass must repair-in-place (send the failed output as context) ──
test('extractRecipe repair pass re-sends the failed first output as context', async () => {
  const firstOutput = '{ "name": "T", "recipeIngredient": ["a"]'; // broken JSON
  const repairedOutput = JSON.stringify({ '@type': 'Recipe', name: 'T', recipeIngredient: ['a'], recipeInstructions: ['b'] });
  const calls = [];
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html: '<p>mix and bake</p>' }),
    runLLM: async (messages) => {
      calls.push(messages);
      return calls.length === 1 ? firstOutput : repairedOutput;
    },
  };
  const res = await extractRecipe('https://example.com/x', deps);
  // The second runLLM call (repair) must include the failed first output as
  // context — proving the model repairs the real JSON instead of inventing
  // a new recipe from a context-free prompt.
  assert.equal(calls.length, 2);
  const repairContent = calls[1][0].content;
  assert.ok(repairContent.includes(firstOutput), 'repair message must embed the failed first output');
  // And the repaired JSON must yield the recipe.
  assert.equal(res.ok, true);
  assert.equal(res.recipe.name, 'T');
});

test('extractRecipe repair pass returning invalid JSON falls back to 422 (no fabrication)', async () => {
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html: '<p>mix and bake</p>' }),
    runLLM: async () => 'totally not a recipe',
  };
  const res = await extractRecipe('https://example.com/x', deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
});

// ── #5: partial recovery when JSON-LD has name but is missing required fields ──
test('extractRecipe returns a partial when JSON-LD has a name but missing instructions and LLM fails', async () => {
  // JSON-LD with name + ingredients but NO instructions → fails hasRequiredFields.
  const html = '<script type="application/ld+json">{"@type":"Recipe","name":"HalfBaked","recipeIngredient":["flour","water"]}</script>';
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html }),
    runLLM: async () => 'sorry, no recipe here',
  };
  const res = await extractRecipe('https://example.com/half', deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
  assert.ok(res.partial, 'partial must be present');
  assert.equal(res.partial.name, 'HalfBaked');
});

test('extractRecipe omits partial when there is no JSON-LD name', async () => {
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html: '<p>plain page, no recipe</p>' }),
    runLLM: async () => 'no recipe',
  };
  const res = await extractRecipe('https://example.com/plain', deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
  assert.equal(res.partial, undefined);
});

// ── #6: handleExtract missing_url branch (400) for empty/whitespace/non-string/absent url ──
test('handleExtract returns 400 missing_url for empty/whitespace/non-string/absent url', async () => {
  const cases = [
    { url: '' },
    { url: '   ' },
    { url: 123 },
    {},
  ];
  for (const body of cases) {
    const res = await handleExtract(body, {}, {});
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(res.body.error, 'missing_url');
  }
});