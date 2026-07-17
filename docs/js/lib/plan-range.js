import { parseServings } from './cart.js';
import { applyIngredientTombstones, effectiveIngredientRecords, recipeEffectiveSignature } from './ingredient-corrections.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function selectionFor(recipe, entries, rangeStart, rangeEnd, previous) {
  const sourceRecipeId = String(recipe._id || recipe.id || recipe.recipeId || '');
  const projected = applyIngredientTombstones(
    effectiveIngredientRecords(recipe),
    previous?.removedIngredientNames,
  );
  return {
    recipeId: `plan:${rangeStart}:${rangeEnd}:${sourceRecipeId}`,
    sourceRecipeId,
    recipeName: String(recipe.name || 'Recipe'),
    sourceServings: parseServings(recipe.recipeYield),
    targetServings: entries.reduce((sum, entry) => sum + Number(entry.targetServings || 0), 0),
    normalizationVersion: 2,
    ingredients: projected.ingredients,
    effectiveSignature: recipeEffectiveSignature(recipe),
    removedIngredientNames: projected.removedIngredientNames,
    origin: {
      kind: 'plan', rangeStart, rangeEnd,
      signature: JSON.stringify(entries.map(({ id, date, status, targetServings: servings }) => ({ id, date, status, servings }))
        .sort((a, b) => a.id.localeCompare(b.id))),
      planEntryIds: entries.map((entry) => entry.id).sort(),
    },
  };
}

export function regeneratePlanRangeCart(workspace, { rangeStart, rangeEnd } = {}, recipes = []) {
  if (!DATE_RE.test(rangeStart) || !DATE_RE.test(rangeEnd) || rangeStart > rangeEnd) throw new Error('invalid_plan_range');
  const grouped = new Map();
  for (const entry of workspace.plan || []) {
    if (entry.type !== 'recipe' || entry.status !== 'active' || entry.date < rangeStart || entry.date > rangeEnd) continue;
    const rows = grouped.get(entry.recipeId) || [];
    rows.push(entry);
    grouped.set(entry.recipeId, rows);
  }
  const recipeMap = new Map(recipes.map((recipe) => [String(recipe._id || recipe.id || recipe.recipeId || ''), recipe]));
  const direct = (workspace.cart || []).filter((selection) => selection?.origin?.kind !== 'plan'
    || selection.origin.rangeStart !== rangeStart || selection.origin.rangeEnd !== rangeEnd);
  const previous = new Map((workspace.cart || []).filter((selection) => selection?.origin?.kind === 'plan'
    && selection.origin.rangeStart === rangeStart && selection.origin.rangeEnd === rangeEnd)
    .map((selection) => [selection.sourceRecipeId, selection]));
  const generated = [];
  for (const [recipeId, entries] of grouped) {
    const recipe = recipeMap.get(recipeId);
    if (recipe) generated.push(selectionFor(recipe, entries, rangeStart, rangeEnd, previous.get(recipeId)));
  }
  return [...direct, ...generated];
}
