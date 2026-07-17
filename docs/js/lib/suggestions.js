import { effectiveIngredientLines } from './ingredient-corrections.js';

const lower = (value) => String(value || '').trim().toLowerCase();
const idOf = (recipe) => String(recipe?._id || recipe?.id || '');

function minutes(recipe) {
  const values = [recipe?.totalTime, recipe?.cookTime, recipe?.prepTime];
  for (const value of values) {
    const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:min|minute)/i);
    if (match) return Number(match[1]);
    const hours = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:h|hour)/i);
    if (hours) return Number(hours[1]) * 60;
  }
  return 10_000;
}

function eligibleRecipes(recipes, reactions, preferences) {
  const excludedIds = new Set((preferences.excludedRecipeIds || []).map(String));
  const disliked = (preferences.dislikedIngredients || []).map(lower).filter(Boolean);
  const diet = (preferences.excludedDietTags || []).map(lower).filter(Boolean);
  const rejected = new Set(reactions
    .filter((item) => item.reaction === 'not_for_us' || Number(item.taste) === 1)
    .map((item) => String(item.recipeId)));
  return recipes.filter((recipe) => {
    const id = idOf(recipe);
    if (!id || !String(recipe?.name || '').trim() || excludedIds.has(id) || rejected.has(id)) return false;
    const ingredients = effectiveIngredientLines(recipe).map(lower).join(' ');
    const tags = [recipe.recipeDiet, recipe.recipeCategory]
      .flat().map(lower).join(' ');
    return !disliked.some((term) => ingredients.includes(term))
      && !diet.some((term) => tags.includes(term));
  });
}

export function pickForUs({ recipes = [], events = [], reactions = [], preferences = {}, now = Date.now() } = {}) {
  const candidates = eligibleRecipes(recipes, reactions, preferences);
  const byId = new Map(candidates.map((recipe) => [idOf(recipe), recipe]));
  const activeEvents = events.filter((event) => !event.deletedAt && byId.has(String(event.recipeId)));
  const lastCooked = new Map();
  for (const event of activeEvents) {
    const id = String(event.recipeId);
    lastCooked.set(id, Math.max(lastCooked.get(id) || 0, Number(event.cookedAt) || 0));
  }
  const reactionsById = new Map();
  for (const reaction of reactions) {
    const list = reactionsById.get(String(reaction.recipeId)) || [];
    list.push(reaction);
    reactionsById.set(String(reaction.recipeId), list);
  }
  const used = new Set();
  const take = (lane, score, reason) => {
    const ranked = candidates.filter((recipe) => !used.has(idOf(recipe)))
      .sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)));
    const recipe = ranked[0];
    if (!recipe) return null;
    used.add(idOf(recipe));
    return { lane, recipe, reason: reason(recipe) };
  };
  const reliable = take('reliable', (recipe) => {
    const memory = reactionsById.get(idOf(recipe)) || [];
    return memory.reduce((sum, item) => sum + (Number.isInteger(item.taste) ? item.taste - 1
      : item.reaction === 'loved' ? 4 : item.reaction === 'good' ? 2 : 0)
      + (item.wouldMakeAgain === true ? 1 : 0), 0);
  }, (recipe) => {
    const memory = reactionsById.get(idOf(recipe)) || [];
    return memory.length ? 'A household favorite both of you have enjoyed.' : 'An untested recipe from your shared cookbook.';
  });
  const reliableCuisine = lower(reliable?.recipe?.recipeCuisine);
  const different = take('different', (recipe) => {
    const neverCooked = lastCooked.has(idOf(recipe)) ? 0 : 100;
    const cuisineChange = lower(recipe.recipeCuisine) !== reliableCuisine ? 10 : 0;
    const age = Math.max(0, now - (lastCooked.get(idOf(recipe)) || now)) / 86_400_000;
    return neverCooked + cuisineChange + Math.min(minutes(recipe), 240) / 100 + age / 1000;
  }, (recipe) => lastCooked.has(idOf(recipe))
    ? 'Something different that has been out of rotation for a while.'
    : 'Something different and still untested together.');
  const quick = take('quick', (recipe) => -minutes(recipe), (recipe) => {
    const value = minutes(recipe);
    return value < 10_000 ? `A quick option at about ${value} minutes.` : 'A simple option from your shared cookbook.';
  });
  return [reliable, different, quick].filter(Boolean);
}
