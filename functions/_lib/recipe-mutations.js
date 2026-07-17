import { ensureOnce, getCommunity, listCommunity, validateRecipe, uuid } from './community.js';
import {
  applyReviewedIngredientCorrection,
  preserveReviewedIngredientCorrections,
} from '../../docs/js/lib/ingredient-corrections.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS household_recipe_mutations (
  household_id TEXT NOT NULL, mutation_id TEXT NOT NULL, operation TEXT NOT NULL, committed_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, mutation_id), FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);`;
const MAX_RECEIPT_PAYLOAD = 50_000;

function stableJson(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw new Error('invalid_recipe_mutation');
  seen.add(value);
  const output = Array.isArray(value)
    ? `[${value.map((item) => stableJson(item, seen)).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return output;
}

async function receiptOperation(op, payload) {
  const canonical = stableJson(payload);
  if (canonical.length > MAX_RECEIPT_PAYLOAD) throw new Error('recipe_mutation_too_large');
  const bytes = new TextEncoder().encode(`${op}\u0000${canonical}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${op}:${hash}`;
}

async function recipes(db, householdId) {
  const output = [];
  let cursor;
  do {
    const result = await listCommunity(db, { householdId, cursor, limit: 50 });
    if (result.status !== 200) return [];
    output.push(...(result.body.recipes || []));
    cursor = result.body.nextCursor || null;
  } while (cursor);
  return output;
}

const changedRows = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);

async function existingReceipt(db, householdId, mutationId) {
  return db.prepare(`SELECT operation FROM household_recipe_mutations
    WHERE household_id = ? AND mutation_id = ?`).bind(householdId, mutationId).first();
}

async function mutateGenericRecipe(db, { mutationId, receipt, op, payload, author, householdId }) {
  const id = typeof payload.id === 'string' && payload.id.trim()
    ? payload.id.trim().slice(0, 100) : op === 'recipe.create' ? uuid() : '';
  if (!id) return { status: 400, error: 'bad_recipe' };
  const now = Date.now();
  let statements;

  if (op === 'recipe.create') {
    const error = validateRecipe(payload.recipe);
    if (error) return { status: 400, error };
    const recipe = preserveReviewedIngredientCorrections({}, payload.recipe);
    statements = [
      db.prepare(`INSERT INTO household_recipe_mutations
        (household_id, mutation_id, operation, committed_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(household_id, mutation_id) DO NOTHING`)
        .bind(householdId, mutationId, receipt, now),
      db.prepare(`INSERT OR IGNORE INTO household_recipes (
        id, household_id, added_by_sub, added_by_name, added_by_picture,
        recipe_json, created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM household_recipe_mutations
        WHERE household_id = ? AND mutation_id = ? AND operation = ?
      )`).bind(id, householdId, author.sub, author.name, author.picture || null,
        JSON.stringify(recipe), now, now, householdId, mutationId, receipt),
    ];
  } else {
    const row = await db.prepare(`SELECT added_by_sub, recipe_json, updated_at FROM household_recipes
      WHERE id = ? AND household_id = ?`).bind(id, householdId).first();
    if (!row) return { status: 404, error: 'not_found' };
    if (row.added_by_sub !== author.sub) return { status: 403, error: 'not_author' };
    if (op === 'recipe.update') {
      const error = validateRecipe(payload.recipe);
      if (error) return { status: 400, error };
      let existing = {};
      try { existing = JSON.parse(row.recipe_json || '{}'); } catch { /* Invalid legacy JSON preserves no review. */ }
      const recipe = preserveReviewedIngredientCorrections(existing, payload.recipe);
      const updatedAt = Math.max(now, Number(row.updated_at) + 1);
      statements = [
        db.prepare(`INSERT INTO household_recipe_mutations
          (household_id, mutation_id, operation, committed_at)
          SELECT ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM household_recipes
            WHERE id = ? AND household_id = ? AND added_by_sub = ? AND updated_at = ?
          ) ON CONFLICT(household_id, mutation_id) DO NOTHING`)
          .bind(householdId, mutationId, receipt, updatedAt, id, householdId, author.sub, row.updated_at),
        db.prepare(`UPDATE household_recipes
          SET recipe_json = ?, added_by_name = ?, added_by_picture = ?, updated_at = ?
          WHERE id = ? AND household_id = ? AND added_by_sub = ? AND updated_at = ?
            AND EXISTS (SELECT 1 FROM household_recipe_mutations
              WHERE household_id = ? AND mutation_id = ? AND operation = ?)`)
          .bind(JSON.stringify(recipe), author.name, author.picture || null, updatedAt,
            id, householdId, author.sub, row.updated_at, householdId, mutationId, receipt),
      ];
    } else if (op === 'recipe.delete') {
      statements = [
        db.prepare(`INSERT INTO household_recipe_mutations
          (household_id, mutation_id, operation, committed_at)
          SELECT ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM household_recipes WHERE id = ? AND household_id = ? AND added_by_sub = ?
          ) ON CONFLICT(household_id, mutation_id) DO NOTHING`)
          .bind(householdId, mutationId, receipt, now, id, householdId, author.sub),
        db.prepare(`DELETE FROM household_recipes
          WHERE id = ? AND household_id = ? AND added_by_sub = ?
            AND EXISTS (SELECT 1 FROM household_recipe_mutations
              WHERE household_id = ? AND mutation_id = ? AND operation = ?)`)
          .bind(id, householdId, author.sub, householdId, mutationId, receipt),
        db.prepare('DELETE FROM community_recipes WHERE id = ?').bind(id),
      ];
    } else {
      return { status: 400, error: 'unsupported_recipe_operation' };
    }
  }

  const results = await db.batch(statements);
  if (!changedRows(results[0])) {
    const prior = await existingReceipt(db, householdId, mutationId);
    if (!prior || (prior.operation !== receipt && prior.operation !== op)) {
      return { status: 409, error: prior ? 'mutation_receipt_collision' : 'recipe_conflict' };
    }
  }
  return { status: 200, recipes: await recipes(db, householdId) };
}

async function reviewedAuthority(db, householdId, id) {
  const result = await getCommunity(db, { householdId, id });
  return result.status === 200
    ? { recipes: [result.body], authorityMode: 'merge' }
    : { recipes: [], authorityMode: 'merge' };
}

async function reviewIngredient(db, { mutationId, receipt, payload, author, householdId }) {
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
    db.prepare(`INSERT INTO household_recipe_mutations
      (household_id, mutation_id, operation, committed_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM household_recipes WHERE id = ? AND household_id = ? AND updated_at = ?
      ) ON CONFLICT(household_id, mutation_id) DO NOTHING`)
      .bind(householdId, mutationId, receipt, now, id, householdId, expectedUpdatedAt),
    db.prepare(`UPDATE household_recipes SET recipe_json = ?, updated_at = ?
      WHERE id = ? AND household_id = ? AND updated_at = ?
        AND EXISTS (SELECT 1 FROM household_recipe_mutations
          WHERE household_id = ? AND mutation_id = ? AND operation = ?)`)
      .bind(JSON.stringify(reviewed.recipe), now, id, householdId, expectedUpdatedAt,
        householdId, mutationId, receipt),
  ]);
  const changed = changedRows(results?.[1]);
  if (!changed) {
    const prior = await existingReceipt(db, householdId, mutationId);
    if (prior && (prior.operation === receipt || prior.operation === 'recipe.ingredient.review')) {
      return { status: 200, ...await reviewedAuthority(db, householdId, id) };
    }
    return { status: 409, error: prior ? 'mutation_receipt_collision' : 'recipe_conflict' };
  }
  return { status: 200, ...await reviewedAuthority(db, householdId, id) };
}

export async function createD1RecipeMutationStore(db) {
  return {
    async mutate({ mutationId, op, payload = {}, author, householdId }) {
      await ensureOnce(db, householdId);
      await db.prepare(SCHEMA).run();
      const receipt = await receiptOperation(op, payload);
      const prior = await db.prepare(`SELECT mutation_id, operation FROM household_recipe_mutations
        WHERE household_id = ? AND mutation_id = ?`).bind(householdId, mutationId).first();
      if (prior) {
        if (prior.operation !== receipt && prior.operation !== op) {
          return { status: 409, error: 'mutation_receipt_collision' };
        }
        if (op === 'recipe.ingredient.review') {
          const id = typeof payload.id === 'string' ? payload.id.trim().slice(0, 100) : '';
          return { status: 200, ...await reviewedAuthority(db, householdId, id) };
        }
        return { status: 200, recipes: await recipes(db, householdId) };
      }
      if (op === 'recipe.ingredient.review') {
        return reviewIngredient(db, { mutationId, receipt, payload, author, householdId });
      }
      return mutateGenericRecipe(db, { mutationId, receipt, op, payload, author, householdId });
    },
  };
}
