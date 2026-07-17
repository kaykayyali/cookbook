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

test('failed vision remains a recoverable draft result', async () => {
  const result = await extractRecipeFromImages({
    imageRefs: ['data:image/jpeg;base64,b25l'],
    runVision: async () => { throw new Error('vision_failed'); },
    runText: async () => '',
  });
  assert.equal(result.recipe, null);
  assert.match(result.error, /vision_failed/);
});
