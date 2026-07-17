import { deleteCommunity, editRecipe, ensureOnce, listCommunity, shareRecipe } from './community.js';
import { applyReviewedIngredientCorrection } from '../../docs/js/lib/ingredient-corrections.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS household_recipe_mutations (
  household_id TEXT NOT NULL, mutation_id TEXT NOT NULL, operation TEXT NOT NULL, committed_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, mutation_id), FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);`;

async function recipes(db, householdId) {
  const result = await listCommunity(db, { householdId, limit: 100 });
  return result.body.recipes || [];
}

async function reviewIngredient(db, { mutationId, payload, author, householdId }) {
  const id = typeof payload.id === 'string' ? payload.id.trim().slice(0, 100) : '';
  const ingredientId = typeof payload.ingredientId === 'string' ? payload.ingredientId.trim().slice(0, 120) : '';
  const expectedUpdatedAt = Number(payload.expectedUpdatedAt);
  if (!id || !ingredientId || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0
      || !payload.correction || typeof payload.correction !== 'object' || Array.isArray(payload.correction)) {
    return { status: 400, error: 'invalid_ingredient_review' };
  }
  const row = await db.prepare(`SELECT recipe_json, updated_at FROM household_recipes
    WHERE id = ? AND household_id = ?`).bind(id, householdId).first();
  if (!row) return { status: 404, error: 'not_found' };
  if (Number(row.updated_at) !== expectedUpdatedAt) return { status: 409, error: 'recipe_conflict' };
  let recipe;
  try { recipe = JSON.parse(row.recipe_json); } catch { return { status: 409, error: 'invalid_recipe_authority' }; }
  const now = Math.max(Date.now(), expectedUpdatedAt + 1);
  const reviewed = applyReviewedIngredientCorrection(recipe, {
    ingredientId,
    correction: payload.correction,
    reviewer: { sub: author.sub, name: author.name },
    reviewedAt: now,
  });
  if (!reviewed.ok) return { status: 422, error: 'invalid_ingredient_review', detail: reviewed.error };
  const results = await db.batch([
    db.prepare(`UPDATE household_recipes SET recipe_json = ?, updated_at = ?
      WHERE id = ? AND household_id = ? AND updated_at = ?`)
      .bind(JSON.stringify(reviewed.recipe), now, id, householdId, expectedUpdatedAt),
    db.prepare(`INSERT INTO household_recipe_mutations
      (household_id, mutation_id, operation, committed_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM household_recipes WHERE id = ? AND household_id = ? AND updated_at = ?
      ) ON CONFLICT(household_id, mutation_id) DO NOTHING`)
      .bind(householdId, mutationId, 'recipe.ingredient.review', now, id, householdId, now),
  ]);
  const changed = Number(results?.[0]?.meta?.changes ?? results?.[0]?.changes ?? 0);
  if (!changed) {
    const receipt = await db.prepare(`SELECT mutation_id FROM household_recipe_mutations
      WHERE household_id = ? AND mutation_id = ?`).bind(householdId, mutationId).first();
    return receipt
      ? { status: 200, recipes: await recipes(db, householdId) }
      : { status: 409, error: 'recipe_conflict' };
  }
  return { status: 200, recipes: await recipes(db, householdId) };
}

export async function createD1RecipeMutationStore(db) {
  return {
    async mutate({ mutationId, op, payload = {}, author, householdId }) {
      await ensureOnce(db, householdId);
      await db.prepare(SCHEMA).run();
      const prior = await db.prepare(`SELECT mutation_id FROM household_recipe_mutations
        WHERE household_id = ? AND mutation_id = ?`).bind(householdId, mutationId).first();
      if (prior) return { status: 200, recipes: await recipes(db, householdId) };
      if (op === 'recipe.ingredient.review') {
        return reviewIngredient(db, { mutationId, payload, author, householdId });
      }
      let result;
      if (op === 'recipe.create') result = await shareRecipe(db, { id: payload.id, recipe: payload.recipe, author, householdId });
      else if (op === 'recipe.update') result = await editRecipe(db, { id: payload.id, recipe: payload.recipe, author, householdId });
      else if (op === 'recipe.delete') result = await deleteCommunity(db, { id: payload.id, author, householdId });
      else return { status: 400, error: 'unsupported_recipe_operation' };
      if (result.status < 200 || result.status >= 300) return { status: result.status, error: result.body?.error || 'recipe_mutation_failed' };
      await db.prepare(`INSERT INTO household_recipe_mutations
        (household_id, mutation_id, operation, committed_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(household_id, mutation_id) DO NOTHING`)
        .bind(householdId, mutationId, op, Date.now()).run();
      return { status: 200, recipes: await recipes(db, householdId) };
    },
  };
}
