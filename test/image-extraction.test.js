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
