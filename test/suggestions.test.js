import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickForUs } from '../docs/js/lib/suggestions.js';

const recipe = (id, name, extras = {}) => ({ _id: id, name, recipeIngredient: ['salt'], recipeCuisine: 'Home', totalTime: '30 min', ...extras });

test('suggestions are three unique accessible recipes in explainable lanes', () => {
  const recipes = [
    recipe('favorite', 'Favorite Pasta', { recipeCuisine: 'Italian' }),
    recipe('different', 'Fresh Curry', { recipeCuisine: 'Indian', totalTime: '50 min' }),
    recipe('quick', 'Fast Eggs', { totalTime: '10 min' }),
  ];
  const reactions = [
    { recipeId: 'favorite', memberSub: 'kay', reaction: 'loved', wouldMakeAgain: true },
    { recipeId: 'favorite', memberSub: 'gloria', reaction: 'good', wouldMakeAgain: true },
  ];
  const picks = pickForUs({ recipes, reactions, events: [], now: 1_000_000 });
  assert.deepEqual(picks.map((pick) => pick.lane), ['reliable', 'different', 'quick']);
  assert.equal(new Set(picks.map((pick) => pick.recipe._id)).size, 3);
  assert.ok(picks.every((pick) => pick.reason.length > 5));
});

test('hard dislikes and diet constraints are never bypassed', () => {
  const recipes = [
    recipe('blocked-id', 'No thanks'),
    recipe('blocked-food', 'Peanut noodles', { recipeIngredient: ['peanut butter'] }),
    recipe('blocked-diet', 'Beef stew', { recipeDiet: ['beef'] }),
    recipe('safe', 'Tomato pasta', { recipeDiet: ['vegetarian'] }),
  ];
  const picks = pickForUs({
    recipes,
    reactions: [{ recipeId: 'safe', memberSub: 'kay', reaction: 'good' }],
    preferences: { excludedRecipeIds: ['blocked-id'], dislikedIngredients: ['peanut'], excludedDietTags: ['beef'] },
  });
  assert.deepEqual([...new Set(picks.map((pick) => pick.recipe._id))], ['safe']);
});

test('an explicit not-for-us reaction excludes a recipe and sparse history stays honest', () => {
  const recipes = [recipe('no', 'No'), recipe('new', 'Untested Soup')];
  const picks = pickForUs({ recipes, reactions: [{ recipeId: 'no', memberSub: 'gloria', reaction: 'not_for_us' }] });
  assert.ok(picks.every((pick) => pick.recipe._id === 'new'));
  assert.ok(picks.every((pick) => /try|untested|quick|different/i.test(pick.reason)));
});

test('a one-star Taste review replaces not-for-us as a negative recommendation signal', () => {
  const recipes = [recipe('no', 'No'), recipe('new', 'Untested Soup')];
  const picks = pickForUs({ recipes, reactions: [{ recipeId: 'no', memberSub: 'kay', taste: 1, complexity: 2 }] });
  assert.ok(picks.every((pick) => pick.recipe._id === 'new'));
});
