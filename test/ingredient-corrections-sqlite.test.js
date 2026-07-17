import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientEvidence } from '../docs/js/lib/ingredient-corrections.js';
import { ensureOnce, editRecipe, getCommunity } from '../functions/_lib/community.js';
import { createD1RecipeMutationStore } from '../functions/_lib/recipe-mutations.js';

class D1Statement {
  constructor(owner, sql, values = []) { this.owner = owner; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.owner, this.sql, values); }
  async first() { return this.owner.sqlite.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class SqliteD1 {
  constructor(sqlite) { this.sqlite = sqlite; this.chain = Promise.resolve(); }
  prepare(sql) { return new D1Statement(this, sql); }
  async batch(statements) {
    const execute = async () => {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    };
    const result = this.chain.then(execute, execute);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}

const correction = {
  name: 'basil', amountState: 'numeric', amount: '2 to 4',
  measurementFamily: 'count', sourceUnit: 'count', countLabel: 'leaf',
  raw: 'forged raw', sourceUrl: 'https://evil.test/overwrite', reviewedBy: { sub: 'attacker' },
};

async function fixture(t) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { t.skip('node:sqlite unavailable'); return null; }
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE households (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Home', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
    INSERT INTO households (id, name) VALUES ('our-home', 'Our home');
    INSERT INTO households (id, name) VALUES ('other-home', 'Other home');`);
  const db = new SqliteD1(sqlite);
  await ensureOnce(db, 'our-home');
  const recipe = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Basil Pasta',
    recipeYield: '2 servings', recipeIngredient: ['to 4 basil leaves', '8 oz pasta'],
  };
  sqlite.prepare(`INSERT INTO household_recipes
    (id, household_id, added_by_sub, added_by_name, added_by_picture, recipe_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('r1', 'our-home', 'owner', 'Owner', null, JSON.stringify(recipe), 10, 1000);
  sqlite.prepare(`INSERT INTO recipe_import_provenance
    (recipe_id, household_id, import_draft_id, source_type, source_url, imported_at, extractor_method, extractor_version, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('r1', 'our-home', 'draft-1', 'url', 'https://example.test/original', 9, 'json-ld', 'extractor-v3', '{"marker":"immutable"}');
  return { sqlite, db, recipe, ingredientId: ingredientEvidence(recipe)[0].id };
}

test('real SQLite persists household-reviewed authority, immutable evidence, idempotency, and stale-tab conflict semantics', async (t) => {
  const setup = await fixture(t);
  if (!setup) return;
  const { sqlite, db, ingredientId } = setup;
  const store = await createD1RecipeMutationStore(db);
  const first = await store.mutate({
    mutationId: 'review-1', op: 'recipe.ingredient.review', householdId: 'our-home',
    author: { sub: 'partner', name: 'Partner', picture: null },
    payload: { id: 'r1', ingredientId, expectedUpdatedAt: 1000, correction },
  });
  assert.equal(first.status, 200);
  const stored = sqlite.prepare('SELECT recipe_json, updated_at FROM household_recipes WHERE id = ?').get('r1');
  const parsed = JSON.parse(stored.recipe_json);
  assert.equal(parsed.recipeIngredient[0], 'to 4 basil leaves');
  assert.equal(parsed.ingredientNormalizations[0].raw, 'to 4 basil leaves');
  assert.equal(parsed.ingredientNormalizations[0].name, 'basil');
  assert.deepEqual(parsed.ingredientNormalizations[0].reviewedBy, { sub: 'partner', name: 'Partner' });
  assert.equal(Object.hasOwn(parsed.ingredientNormalizations[0], 'sourceUrl'), false);
  assert.equal(sqlite.prepare('SELECT source_url FROM recipe_import_provenance WHERE recipe_id = ?').get('r1').source_url, 'https://example.test/original');
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM household_recipe_mutations').get().count, 1);

  const duplicate = await store.mutate({
    mutationId: 'review-1', op: 'recipe.ingredient.review', householdId: 'our-home',
    author: { sub: 'partner', name: 'Partner' },
    payload: { id: 'r1', ingredientId, expectedUpdatedAt: 1000, correction },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM household_recipe_mutations').get().count, 1);

  const stale = await store.mutate({
    mutationId: 'review-stale-tab', op: 'recipe.ingredient.review', householdId: 'our-home',
    author: { sub: 'owner', name: 'Owner' },
    payload: { id: 'r1', ingredientId, expectedUpdatedAt: 1000, correction: { ...correction, name: 'mint' } },
  });
  assert.deepEqual({ status: stale.status, error: stale.error }, { status: 409, error: 'recipe_conflict' });
  assert.equal(JSON.parse(sqlite.prepare('SELECT recipe_json FROM household_recipes WHERE id = ?').get('r1').recipe_json).ingredientNormalizations[0].name, 'basil');
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM household_recipe_mutations WHERE mutation_id = 'review-stale-tab'").get().count, 0);
  sqlite.close();
});

test('review route/store fails closed for malformed payloads and cross-household recipe access', async (t) => {
  const setup = await fixture(t);
  if (!setup) return;
  const { sqlite, db, ingredientId } = setup;
  const store = await createD1RecipeMutationStore(db);
  const actor = { sub: 'partner', name: 'Partner' };
  const malformed = await store.mutate({
    mutationId: 'bad-review', op: 'recipe.ingredient.review', householdId: 'our-home', author: actor,
    payload: { id: 'r1', ingredientId, expectedUpdatedAt: 1000, correction: { ...correction, name: '<script>alert(1)</script>' } },
  });
  assert.deepEqual({ status: malformed.status, error: malformed.error }, { status: 422, error: 'invalid_ingredient_review' });
  const crossHousehold = await store.mutate({
    mutationId: 'cross-home', op: 'recipe.ingredient.review', householdId: 'other-home', author: actor,
    payload: { id: 'r1', ingredientId, expectedUpdatedAt: 1000, correction },
  });
  assert.deepEqual({ status: crossHousehold.status, error: crossHousehold.error }, { status: 404, error: 'not_found' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM household_recipe_mutations').get().count, 0);
  assert.equal(JSON.parse(sqlite.prepare('SELECT recipe_json FROM household_recipes WHERE id = ?').get('r1').recipe_json).ingredientNormalizations, undefined);
  const forgedCreate = await store.mutate({
    mutationId: 'forged-create', op: 'recipe.create', householdId: 'our-home', author: actor,
    payload: {
      id: 'r2', recipe: {
        name: 'Mint tea', recipeIngredient: ['1 leaf mint'],
        ingredientNormalizations: [{ id: 'forged', raw: 'forged', name: 'poison', reviewStatus: 'reviewed', parserVersion: 999 }],
      },
    },
  });
  assert.equal(forgedCreate.status, 200);
  assert.equal(JSON.parse(sqlite.prepare('SELECT recipe_json FROM household_recipes WHERE id = ?').get('r2').recipe_json).ingredientNormalizations, undefined);
  sqlite.close();
});

test('generic edit/re-import cannot silently erase a reviewed override and provenance remains queryable', async (t) => {
  const setup = await fixture(t);
  if (!setup) return;
  const { sqlite, db, recipe, ingredientId } = setup;
  const store = await createD1RecipeMutationStore(db);
  const owner = { sub: 'owner', name: 'Owner', picture: null };
  const reviewed = await store.mutate({
    mutationId: 'review-before-reparse', op: 'recipe.ingredient.review', householdId: 'our-home', author: owner,
    payload: { id: 'r1', ingredientId, expectedUpdatedAt: 1000, correction },
  });
  assert.equal(reviewed.status, 200);

  const reparsed = await editRecipe(db, {
    id: 'r1', householdId: 'our-home', author: owner,
    recipe: { ...recipe, ingredientNormalizations: [{ id: ingredientId, raw: 'forged', name: 'mint', reviewStatus: 'reviewed', parserVersion: 999 }] },
  });
  assert.equal(reparsed.status, 200);
  assert.equal(reparsed.body.recipe.ingredientNormalizations[0].name, 'basil');
  assert.equal(reparsed.body.recipe.ingredientNormalizations[0].raw, 'to 4 basil leaves');
  const detail = await getCommunity(db, { id: 'r1', householdId: 'our-home' });
  assert.equal(detail.body.provenance.sourceUrl, 'https://example.test/original');
  assert.deepEqual(detail.body.provenance.evidence, { marker: 'immutable' });
  sqlite.close();
});
