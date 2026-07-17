import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nutritionHTML, metaRowHTML } from '../docs/js/components/recipeDetail.js';
import { recipeCardHTML } from '../docs/js/components/recipeCard.js';

const recipe = {
  _id: 'r1',
  name: 'Sunday Pasta',
  recipeCategory: 'Entree',
  recipeIngredient: ['one', 'two', 'three', 'four', 'five', 'six'],
};

test('nutrition renders as a compact per-serving semantic strip', () => {
  const html = nutritionHTML({ calories: '474 kcal', proteinContent: '18 g', fatContent: '19 g', carbohydrateContent: '56 g' });
  assert.match(html, /class="nutrition-strip"/);
  assert.match(html, /aria-label="Nutrition per serving"/);
  assert.match(html, /<dt>Calories<\/dt><dd>474 kcal<\/dd>/);
  assert.doesNotMatch(html, /nutrition-cell/);
});

test('recipe cards use compact household identity and a four-ingredient preview', () => {
  const withPhoto = recipeCardHTML({
    ...recipe,
    _author: { sub: 'kay', name: 'Kaysser Kayyali', picture: 'https://example.test/k.png' },
  }, [], { currentUserSub: 'kay' });
  assert.match(withPhoto, /class="household-attribution"/);
  assert.match(withPhoto, /aria-label="Added by Kaysser Kayyali"/);
  assert.match(withPhoto, /<img[^>]+class="household-avatar"/);
  assert.doesNotMatch(withPhoto, />added by Kaysser Kayyali</);
  assert.match(withPhoto, /\+2 more/);
  assert.doesNotMatch(withPhoto, />five</);

  const fallback = recipeCardHTML({ ...recipe, _author: { sub: 'gloria', name: 'Gloria' } }, []);
  assert.match(fallback, /class="household-avatar household-initial"[^>]*>G</);
});

test('recipe category metadata formats imported list values for people', () => {
  const card = recipeCardHTML({ ...recipe, recipeCuisine: ['Italian', 'American'] }, []);
  assert.match(card, /Italian · American/);
});

test('recipe yield copy avoids duplicate servings and spells out a single whole item', () => {
  const meta = metaRowHTML({ recipeYield: ['4', '1 10-inch pizza'] });
  assert.match(meta, /<span class="k">Serves<\/span><span class="v">4 · One 10-inch pizza<\/span>/);
  assert.doesNotMatch(meta, /Serves<\/span><span class="v">4 servings/);
});

test('overhaul stylesheet establishes readable surfaces and 44px mobile actions', () => {
  const css = readFileSync(new URL('../docs/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /COOKBOOK UI OVERHAUL/);
  assert.match(css, /\.suggestion-grid\s*\{/);
  assert.match(css, /\.nutrition-strip\s*\{/);
  assert.match(css, /\.week-add \.btn[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.card-toolbar \.icon-btn[\s\S]*min-height:\s*44px/);
});
