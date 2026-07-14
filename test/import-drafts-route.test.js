import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost, onRequestPatch } from '../functions/api/import-drafts.js';

function memoryDb() {
  const drafts = new Map();
  const recipes = new Map();
  function prepare(sql) {
    return {
      bind(...values) { this.values = values; return this; },
      async all() {
        const m = sql.match(/FROM recipe_import_drafts/);
        if (m) return { results: [...drafts.values()].map(rowFromObj) };
        const r = sql.match(/FROM household_recipes/);
        if (r) return { results: [...recipes.values()].map((r) => ({ id: r.id, recipe_json: r.recipe_json })) };
        return { results: [] };
      },
      async first() {
        if (sql.includes('WHERE id = ? AND household_id = ?')) {
          const id = this.values[0];
          return drafts.get(id) ? rowFromObj(drafts.get(id)) : null;
        }
        return null;
      },
      async run() {
        if (sql.includes('INSERT INTO recipe_import_drafts')) {
          const [id, householdId, createdBySub, sourceType, sourceUrlsJson, imageRefsJson, extractedJson, confidenceJson, notes, createdAt, updatedAt] = this.values;
          drafts.set(id, { id, household_id: householdId, created_by_sub: createdBySub, status: 'pending', source_type: sourceType, source_urls_json: sourceUrlsJson, image_refs_json: imageRefsJson, extracted_json: extractedJson, confidence_json: confidenceJson, duplicate_ids_json: '[]', recipe_json: null, notes, created_at: createdAt, updated_at: updatedAt, confirmed_at: null });
        }
        if (sql.includes('UPDATE recipe_import_drafts')) {
          const id = this.values[this.values.length - 2];
          const existing = drafts.get(id);
          if (sql.includes('recipe_json')) {
            drafts.set(id, { ...existing, recipe_json: this.values[0], status: 'extracted', updated_at: this.values[1] });
          } else if (sql.includes("'confirmed'")) {
            drafts.set(id, { ...existing, recipe_json: this.values[0], status: 'confirmed', confirmed_at: this.values[1], updated_at: this.values[2] });
            recipes.set(`r-${id}`, { id: `r-${id}`, recipe_json: this.values[0] });
          } else if (sql.includes("'rejected'")) {
            drafts.set(id, { ...existing, status: 'rejected', updated_at: this.values[0] });
          }
        }
        if (sql.includes('INSERT') && sql.includes('household_recipes')) {
          const id = this.values[0];
          recipes.set(id, { id, recipe_json: this.values[4] });
        }
        return { meta: { changes: 1 } };
      },
    };
  }
  return { prepare, batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) };
}

function rowFromObj(obj) {
  return obj;
}

const context = (db, method, body, data = {}) => ({
  request: new Request('https://cookbook.test/api/import-drafts', {
    method, body: body && JSON.stringify(body), headers: body ? { 'content-type': 'application/json' } : {},
  }),
  env: { DB: db },
  data: { household: { household: { id: 'our-home' } }, auth: { sub: 'kay' }, ...data },
});

test('import-draft routes fail closed without resolved household membership', async () => {
  const db = memoryDb();
  const res = await onRequestGet(context(db, 'GET', null, { household: null }));
  assert.equal(res.status, 403);
});

test('create draft via POST returns 201 with pending status', async () => {
  const db = memoryDb();
  const res = await onRequestPost(context(db, 'POST', { imageRefs: ['page1.png'], sourceType: 'image' }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'pending');
  assert.equal(body.householdId, 'our-home');
  assert.equal(body.createdBySub, 'kay');
  assert.deepEqual(body.imageRefs, ['page1.png']);
});

test('image draft runs server-side vision while retaining explicit confirmation', async () => {
  const db = memoryDb();
  let calls = 0;
  const ctx = context(db, 'POST', { imageRefs: ['data:image/png;base64,b25l'], sourceType: 'image' });
  ctx.env.AI = { run: async () => {
    calls += 1;
    return calls === 1
      ? { response: 'Soup ingredients: water. Method: boil.' }
      : { response: JSON.stringify({ name: 'Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] }) };
  } };
  const res = await onRequestPost(ctx);
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.status, 'extracted');
  assert.equal(body.extracted.recipe.name, 'Soup');
  assert.equal(body.confirmedAt, null);
});

test('list drafts via GET returns drafts scoped to household', async () => {
  const db = memoryDb();
  await onRequestPost(context(db, 'POST', { imageRefs: ['p1.png'], sourceType: 'image' }));
  const res = await onRequestGet(context(db, 'GET'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.drafts.length, 1);
});

test('confirm draft publishes recipe and returns recipeId', async () => {
  const db = memoryDb();
  const created = await onRequestPost(context(db, 'POST', { imageRefs: ['p1.png'], sourceType: 'image' }));
  const draft = await created.json();
  const res = await onRequestPatch(context(db, 'PATCH', {
    action: 'confirm', id: draft.id, recipe: { name: 'Final Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] },
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'confirmed');
  assert.ok(body.recipeId);
});

test('reject draft returns rejected status without publishing', async () => {
  const db = memoryDb();
  const created = await onRequestPost(context(db, 'POST', { imageRefs: ['p1.png'], sourceType: 'image' }));
  const draft = await created.json();
  const res = await onRequestPatch(context(db, 'PATCH', { action: 'reject', id: draft.id }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'rejected');
});

test('no recipe enters household library without explicit confirmation', async () => {
  const db = memoryDb();
  await onRequestPost(context(db, 'POST', { imageRefs: ['p1.png'], sourceType: 'image' }));
  const listRes = await onRequestGet(context(db, 'GET'));
  const drafts = await listRes.json();
  assert.equal(drafts.drafts[0].status, 'pending');
  assert.equal(drafts.drafts[0].recipe, null);
});