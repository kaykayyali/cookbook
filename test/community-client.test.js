import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toShareable, mapCommunityItem } from '../docs/js/lib/community.js';

test('toShareable produces canonical JSON-LD via toSchema', () => {
  const internal = { _id: 'x', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: ['Bake'] };
  const s = toShareable(internal);
  assert.equal(s['@type'], 'Recipe');
  assert.equal(s.name, 'Pie');
  assert.ok(!s._id, 'canonical output does not leak the internal _id');
});

test('mapCommunityItem converts canonical JSON-LD and preserves community metadata', () => {
  const canonical = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Bake' }] };
  const author = { sub: 's1', name: 'Ada' };
  const copy = mapCommunityItem({ id: 'community-1', author, recipe: canonical, createdAt: 1000, updatedAt: 1000 });
  assert.equal(copy.name, 'Pie');
  assert.deepEqual(copy.recipeInstructions, ['Bake']); // HowToStep flattened to text
  assert.equal(copy._id, 'community-1');
  assert.deepEqual(copy._author, author);
});