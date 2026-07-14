import { deleteCommunity, editRecipe, ensureOnce, listCommunity, shareRecipe } from './community.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS household_recipe_mutations (
  household_id TEXT NOT NULL, mutation_id TEXT NOT NULL, operation TEXT NOT NULL, committed_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, mutation_id), FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);`;

async function recipes(db, householdId) {
  const result = await listCommunity(db, { householdId, limit: 100 });
  return result.body.recipes || [];
}

export async function createD1RecipeMutationStore(db) {
  return {
    async mutate({ mutationId, op, payload = {}, author, householdId }) {
      await ensureOnce(db, householdId);
      await db.prepare(SCHEMA).run();
      const prior = await db.prepare(`SELECT mutation_id FROM household_recipe_mutations
        WHERE household_id = ? AND mutation_id = ?`).bind(householdId, mutationId).first();
      if (prior) return { status: 200, recipes: await recipes(db, householdId) };
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
