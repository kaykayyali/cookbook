import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapCommunityItem } from '../docs/js/lib/community.js';
import { recipeCardHTML } from '../docs/js/components/recipeCard.js';

const item = {
  id: 'community-1',
  author: { sub: 'author-1', name: 'Ada', picture: 'https://example.test/ada.png' },
  recipe: {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Ada Pie',
    recipeIngredient: ['1 crust'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Bake' }],
  },
  createdAt: 1000,
  updatedAt: 2000,
};

test('mapCommunityItem creates the primary internal recipe with id and ownership metadata', () => {
  const recipe = mapCommunityItem(item);
  assert.equal(recipe._id, 'community-1');
  assert.deepEqual(recipe._author, item.author);
  assert.equal(recipe.dateCreated, new Date(1000).toISOString());
  assert.equal(recipe.dateModified, new Date(2000).toISOString());
  assert.deepEqual(recipe.recipeInstructions, ['Bake']);
});

test('primary recipe cards attribute the author and only show author controls to the owner', () => {
  const recipe = mapCommunityItem(item);
  const ownerHtml = recipeCardHTML(recipe, [], { currentUserSub: 'author-1' });
  assert.match(ownerHtml, /added by Ada/);
  assert.match(ownerHtml, /data-action="edit"/);
  assert.match(ownerHtml, /data-action="delete"/);

  const readerHtml = recipeCardHTML(recipe, [], { currentUserSub: 'reader-1' });
  assert.match(readerHtml, /added by Ada/);
  assert.doesNotMatch(readerHtml, /data-action="edit"/);
  assert.doesNotMatch(readerHtml, /data-action="delete"/);
});

test('recipe card shows concise cook count and last-cooked metadata', () => {
  const recipe = mapCommunityItem(item);
  const html = recipeCardHTML(recipe, [], {
    currentUserSub: 'author-1', history: { cookCount: 4, lastCookedAt: Date.UTC(2026, 6, 9) },
  });
  assert.match(html, /Cooked 4 times/);
  assert.match(html, /Last cooked/);
});

test('client architecture has no personal recipe API or local recipe storage key', () => {
  const files = [
    'docs/js/lib/api.js',
    'docs/js/lib/store.js',
    'docs/js/controllers/drawer.js',
    'docs/js/controllers/recipes.js',
    'docs/js/controllers/detail.js',
    'docs/js/controllers/settings.js',
    'docs/js/lib/constants.js',
  ];
  const source = files.map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(source, /['"`]\/recipes(?:\/|['"`])/);
  assert.doesNotMatch(source, /cb_recipes|STORAGE_KEYS\.recipes|saveToLocal|toLocalCopy|Save to my library/);
});

test('shared cookbook has one recipe surface with no Community tab or share actions', () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../scripts/app.entry.js', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /data-panel=["']community["']|id=["']panel-community["']/);
  assert.doesNotMatch(html, /community-grid|community-load-more|dm-community-|share-community/i);
  assert.doesNotMatch(app, /initCommunity|openCommunity|communityRefresh|showPanel\(['"]community['"]\)/);
  assert.doesNotMatch(entry, /initCommunity/);
  assert.match(html, /<h2>Recipes<\/h2>/);
});
