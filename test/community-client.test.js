import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toShareable, toLocalCopy } from '../docs/js/lib/community.js';

test('toShareable produces canonical JSON-LD via toSchema', () => {
  const internal = { _id: 'x', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: ['Bake'] };
  const s = toShareable(internal);
  assert.equal(s['@type'], 'Recipe');
  assert.equal(s.name, 'Pie');
  assert.ok(!s._id, 'canonical output does not leak the internal _id');
});

test('toLocalCopy converts canonical JSON-LD to a local recipe with a fresh _id', () => {
  const canonical = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Bake' }] };
  const copy = toLocalCopy(canonical);
  assert.equal(copy.name, 'Pie');
  assert.deepEqual(copy.recipeInstructions, ['Bake']); // HowToStep flattened to text
  assert.ok(copy._id && typeof copy._id === 'string', 'fresh local _id assigned');
});