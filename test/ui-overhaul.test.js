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

test('recipe cards format category and cuisine arrays with readable separators', () => {
  const card = recipeCardHTML({
    ...recipe,
    recipeCategory: ['Dinner', 'Weeknight'],
    recipeCuisine: ['Italian', 'American'],
  }, []);
  assert.match(card, /<span class="badge badge-accent">Dinner · Weeknight<\/span>/);
  assert.match(card, /<span class="badge">Italian · American<\/span>/);
  assert.doesNotMatch(card, /Dinner,Weeknight|Italian,American/);
});

for (const [recipeYield, label, value] of [
  ['4 servings', 'Serves', '4'],
  ['1 serving', 'Serves', '1'],
  [4, 'Serves', '4'],
  ['Serves 6 hungry people', 'Serves', '6 hungry people'],
  ['Makes 1 pizza', 'Makes', 'One pizza'],
  ['1 10-inch pizza', 'Yield', 'One 10-inch pizza'],
  [['4 servings', '1 10-inch pizza'], 'Serves', '4 · One 10-inch pizza'],
  [[4, 'Makes 1 pizza'], 'Serves', '4 · Makes one pizza'],
  ['About 12 cookies', 'Yield', 'About 12 cookies'],
]) {
  test(`recipe yield ${JSON.stringify(recipeYield)} renders as ${label} ${value}`, () => {
    const meta = metaRowHTML({ recipeYield });
    assert.match(meta, new RegExp(`<span class="k">${label}<\\/span><span class="v">${value}<\\/span>`));
    assert.doesNotMatch(meta, /Serves<\/span><span class="v">(?:Serves|Makes)/);
  });
}

test('overhaul stylesheet establishes readable surfaces and 44px mobile actions', () => {
  const css = readFileSync(new URL('../docs/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /COOKBOOK UI OVERHAUL/);
  assert.match(css, /\.suggestion-grid\s*\{/);
  assert.match(css, /\.nutrition-strip\s*\{/);
  assert.match(css, /\.week-add \.btn[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.card-toolbar \.icon-btn[\s\S]*min-height:\s*44px/);
});
