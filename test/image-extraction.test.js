import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRecipeFromImages } from '../functions/_lib/image-extraction.js';

test('server vision preserves page order and returns structured recipe confidence', async () => {
  const seen = [];
  const result = await extractRecipeFromImages({
    imageRefs: ['data:image/png;base64,b25l', 'data:image/png;base64,dHdv'],
    runVision: async (_bytes, page) => { seen.push(page); return page === 1 ? 'Soup ingredients: water' : 'Method: boil'; },
    runText: async (text) => {
      assert.match(text, /Page 1[\s\S]*Page 2/);
      return JSON.stringify({ name: 'Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] });
    },
  });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.recipe.name, 'Soup');
  assert.deepEqual(result.provenance.pages, [1, 2]);
  assert.deepEqual(result.confidence.uncertainFields, []);
  assert.equal(result.extractorMethod, 'workers-ai-vision');
  assert.equal(result.extractorVersion, 'image-extractor-v1');
  assert.match(result.evidence.pageText, /Page 1:\nSoup ingredients: water/);
  assert.match(result.evidence.pageText, /Page 2:\nMethod: boil/);
  assert.equal(JSON.stringify(result.evidence).includes('data:image'), false);
});

test('server vision bounds multibyte OCR evidence by UTF-8 bytes', async () => {
  const result = await extractRecipeFromImages({
    imageRefs: ['data:image/png;base64,b25l'],
    runVision: async () => `Original OCR ${'🍲'.repeat(20_000)}`,
    runText: async () => JSON.stringify({ name: 'Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] }),
  });
  const serialized = JSON.stringify(result.evidence);
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.ok(new TextEncoder().encode(serialized).byteLength <= 16_384);
  assert.match(serialized, /Original OCR/);
  assert.equal(serialized.includes('data:image'), false);
});

test('oversized OCR evidence fairly preserves every page in order under the UTF-8 cap', async () => {
  const laterPages = ['PAGE-TWO-MARKER ingredients', 'PAGE-THREE-MARKER method'];
  const result = await extractRecipeFromImages({
    imageRefs: [
      'data:image/png;base64,b25l',
      'data:image/png;base64,dHdv',
      'data:image/png;base64,dGhyZWU=',
    ],
    runVision: async (_bytes, page) => page === 1 ? `PAGE-ONE-MARKER ${'🍲'.repeat(30_000)}` : laterPages[page - 2],
    runText: async () => JSON.stringify({ name: 'Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] }),
  });

  const serialized = JSON.stringify(result.evidence);
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.ok(new TextEncoder().encode(serialized).byteLength <= 16_384);
  assert.deepEqual(result.evidence.pages.map(({ page }) => page), [1, 2, 3]);
  assert.match(result.evidence.pages[0].text, /PAGE-ONE-MARKER/);
  assert.match(result.evidence.pages[1].text, /PAGE-TWO-MARKER/);
  assert.match(result.evidence.pages[2].text, /PAGE-THREE-MARKER/);
  assert.equal(serialized.includes('data:image'), false);
});

test('OCR aggregation fairly bounds every huge page before the text model call', async () => {
  let prompt = '';
  const markers = ['PAGE-ONE-PROMPT', 'PAGE-TWO-PROMPT', 'PAGE-THREE-PROMPT'];
  const result = await extractRecipeFromImages({
    imageRefs: [
      'data:image/png;base64,b25l',
      'data:image/png;base64,dHdv',
      'data:image/png;base64,dGhyZWU=',
    ],
    runVision: async (_bytes, page) => `${markers[page - 1]} ${'🍲'.repeat(40_000)}`,
    runText: async (text) => {
      prompt = text;
      return JSON.stringify({ name: 'Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] });
    },
  });

  assert.equal(result.recipe.name, 'Soup');
  assert.ok(new TextEncoder().encode(prompt).byteLength <= 32_768, 'text-model prompt must be byte-bounded');
  assert.ok(prompt.indexOf(markers[0]) < prompt.indexOf(markers[1]));
  assert.ok(prompt.indexOf(markers[1]) < prompt.indexOf(markers[2]));
  for (const marker of markers) assert.match(prompt, new RegExp(marker));
});

test('failed vision remains a recoverable draft result', async () => {
  const result = await extractRecipeFromImages({
    imageRefs: ['data:image/jpeg;base64,b25l'],
    runVision: async () => { throw new Error('vision_failed'); },
    runText: async () => '',
  });
  assert.equal(result.recipe, null);
  assert.match(result.error, /vision_failed/);
});
