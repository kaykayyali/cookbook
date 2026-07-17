import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHEMA,
  normalizeDraftInput,
  createDraft,
  listDrafts,
  getDraft,
  updateDraftRecipe,
  confirmDraft,
  rejectDraft,
  detectDuplicates,
} from '../functions/_lib/import-drafts.js';

const migration = readFileSync(new URL('../docs/superpowers/migrations/0008_recipe_import_drafts.sql', import.meta.url), 'utf8');

function stubDb({ all = [], first = [] } = {}) {
  const calls = [];
  const allQueue = [...all];
  const firstQueue = [...first];
  function statement(sql) {
    const stmt = {
      bind(...values) { stmt.values = values; return stmt; },
      async all() {
        calls.push({ op: 'all', sql, values: stmt.values || [] });
        return allQueue.shift() ?? { results: [] };
      },
      async first() {
        calls.push({ op: 'first', sql, values: stmt.values || [] });
        return firstQueue.shift() ?? null;
      },
      async run() {
        calls.push({ op: 'run', sql, values: stmt.values || [] });
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  }
  return {
    db: { prepare: (sql) => statement(sql), batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) },
    calls,
  };
}

test('import-drafts migration stores auditable drafts with confidence cues and status lifecycle', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS recipe_import_drafts/);
  assert.match(migration, /household_id\s+TEXT\s+NOT NULL/);
  assert.match(migration, /created_by_sub\s+TEXT\s+NOT NULL/);
  assert.match(migration, /CHECK \(status IN \('pending', 'extracted', 'confirmed', 'rejected'\)\)/);
  assert.match(migration, /CHECK \(source_type IN \('image', 'url'\)\)/);
  assert.match(migration, /image_refs_json/);
  assert.match(migration, /extracted_json/);
  assert.match(migration, /confidence_json/);
  assert.match(migration, /duplicate_ids_json/);
  assert.match(migration, /confirmed_at/);
});

test('SCHEMA includes recipe_import_drafts', () => {
  assert.match(SCHEMA, /recipe_import_drafts/);
});

test('draft input is validated and image order is preserved', () => {
  const draft = normalizeDraftInput({
    imageRefs: ['img1.png', 'img2.png'],
    sourceType: 'image',
    notes: 'From a cookbook page',
  }, 2000);
  assert.deepEqual(draft.imageRefs, ['img1.png', 'img2.png']);
  assert.equal(draft.sourceType, 'image');
  assert.throws(() => normalizeDraftInput({ imageRefs: [], sourceType: 'image' }, 2000), /invalid_draft_input/);
  assert.throws(() => normalizeDraftInput({ imageRefs: ['ok'], sourceType: 'unknown' }, 2000), /invalid_draft_input/);
});

test('create stamps household and member identity from server context', async () => {
  const { db, calls } = stubDb();
  const result = await createDraft(db, {
    householdId: 'our-home',
    actorSub: 'kay',
    input: normalizeDraftInput({ imageRefs: ['page1.png'], sourceType: 'image' }, 2000),
    now: 2000,
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.householdId, 'our-home');
  assert.equal(result.body.createdBySub, 'kay');
  assert.equal(result.body.status, 'pending');
  const insert = calls.find((c) => c.op === 'run');
  assert.match(insert.sql, /INSERT INTO recipe_import_drafts/);
});

test('list and get are scoped to the resolved household', async () => {
  const listedDb = stubDb({ all: [{ results: [{ id: 'd1', household_id: 'our-home', status: 'pending', image_refs_json: '[]', extracted_json: '{}', confidence_json: '{}', duplicate_ids_json: '[]', source_urls_json: '[]', source_type: 'image', created_by_sub: 'kay', created_at: 1, updated_at: 1 }] }] });
  const listed = await listDrafts(listedDb.db, { householdId: 'our-home' });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.drafts[0].householdId, 'our-home');
  const listQuery = listedDb.calls.find((c) => c.op === 'all');
  assert.match(listQuery.sql, /FROM recipe_import_drafts/);
  assert.match(listQuery.sql, /household_id = \?/);

  const foundDb = stubDb({ first: [{ id: 'd1', household_id: 'our-home', status: 'pending', image_refs_json: '[]', extracted_json: '{}', confidence_json: '{}', duplicate_ids_json: '[]', source_urls_json: '[]', source_type: 'image', created_by_sub: 'kay', created_at: 1, updated_at: 1 }] });
  const found = await getDraft(foundDb.db, { id: 'd1', householdId: 'our-home' });
  assert.equal(found.status, 200);
  const getQuery = foundDb.calls.find((c) => c.op === 'first');
  assert.match(getQuery.sql, /WHERE id = \? AND household_id = \?/);
});

test('updateDraftRecipe stores reviewed recipe and preserves extracted confidence cues', async () => {
  const { db, calls } = stubDb({ first: [{ id: 'd1', household_id: 'our-home', status: 'extracted', created_by_sub: 'kay' }] });
  const result = await updateDraftRecipe(db, {
    id: 'd1', householdId: 'our-home', actorSub: 'kay',
    recipe: { name: 'Reviewed Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] },
    now: 3000,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'extracted');
  const update = calls.find((c) => c.op === 'run');
  assert.match(update.sql, /UPDATE recipe_import_drafts/);
  assert.match(update.sql, /WHERE id = \? AND household_id = \?/);
});

test('confirmDraft publishes to household_recipes and marks confirmed', async () => {
  const { db, calls } = stubDb({ first: [
    { id: 'd1', household_id: 'our-home', status: 'extracted', recipe_json: '{"name":"Soup"}', created_by_sub: 'kay', image_refs_json: '[]', extracted_json: '{"recipe":{"name":"Soup"}}', confidence_json: '{}', duplicate_ids_json: '[]', source_urls_json: '[]', source_type: 'image', created_at: 1, updated_at: 1, draft_extractor_method: 'workers-ai-vision', draft_extractor_version: 'image-extractor-v1', draft_evidence_json: '{"outcome":"image_extraction_completed"}', draft_provenance_created_at: 1 },
  ] });
  const result = await confirmDraft(db, {
    id: 'd1', householdId: 'our-home', actorSub: 'kay',
    recipe: { name: 'Final Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] },
    now: 4000,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'confirmed');
  assert.ok(result.body.recipeId);
  const update = calls.find((c) => c.op === 'run' && c.sql.includes('UPDATE recipe_import_drafts'));
  assert.match(update.sql, /status.*confirmed/);
  const insert = calls.find((c) => c.op === 'run' && c.sql.includes('household_recipes'));
  assert.equal(insert.values[3], 'member', 'legacy callers without display claims retain a safe non-empty attribution');
  assert.equal(insert.values[4], null);
});

test('confirmDraft collision is failure-visible and atomically leaves draft and existing recipe untouched', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { t.skip('node:sqlite is unavailable on this supported Node version'); return; }
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE households (id TEXT PRIMARY KEY);
    CREATE TABLE household_recipes (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, added_by_sub TEXT NOT NULL,
      added_by_name TEXT NOT NULL, added_by_picture TEXT, recipe_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE recipe_import_drafts (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, created_by_sub TEXT NOT NULL,
      status TEXT NOT NULL, source_type TEXT NOT NULL, source_urls_json TEXT NOT NULL,
      image_refs_json TEXT NOT NULL, extracted_json TEXT NOT NULL, recipe_json TEXT,
      confidence_json TEXT NOT NULL, duplicate_ids_json TEXT NOT NULL, notes TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, confirmed_at INTEGER
    );
    CREATE TABLE recipe_import_provenance (
      recipe_id TEXT PRIMARY KEY, household_id TEXT NOT NULL, import_draft_id TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL, source_url TEXT, imported_at INTEGER NOT NULL,
      extractor_method TEXT NOT NULL, extractor_version TEXT NOT NULL, evidence_json TEXT NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES household_recipes(id) ON DELETE CASCADE
    );
    CREATE TABLE recipe_import_draft_provenance (
      import_draft_id TEXT PRIMARY KEY, extractor_method TEXT NOT NULL,
      extractor_version TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (import_draft_id) REFERENCES recipe_import_drafts(id) ON DELETE CASCADE
    );
    INSERT INTO households VALUES ('our-home');
    INSERT INTO household_recipes VALUES ('forced-collision', 'our-home', 'original', 'Original', NULL, '{"name":"Existing"}', 1, 1);
    INSERT INTO recipe_import_drafts VALUES (
      'draft-collision', 'our-home', 'kay', 'extracted', 'url', '["https://example.com/source"]',
      '[]', '{"recipe":{"name":"Imported"}}',
      '{"name":"Imported"}', '{}', '[]', '', 2, 2, NULL
    );
    INSERT INTO recipe_import_draft_provenance VALUES (
      'draft-collision', 'json-ld', 'url-extractor-v1', '{"recipe":{"name":"Imported"}}', 2
    );
  `);
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...bound) { values = bound; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };

  const result = await confirmDraft(db, {
    id: 'draft-collision', householdId: 'our-home', actorSub: 'kay', actorName: 'Kay',
    recipe: { name: 'Imported' }, now: 3, recipeIdFactory: () => 'forced-collision',
  });

  assert.deepEqual(result, { status: 409, body: { error: 'recipe_id_collision' } });
  assert.equal(sqlite.prepare('SELECT status FROM recipe_import_drafts WHERE id = ?').get('draft-collision').status, 'extracted');
  assert.equal(sqlite.prepare('SELECT recipe_json FROM household_recipes WHERE id = ?').get('forced-collision').recipe_json, '{"name":"Existing"}');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM recipe_import_provenance').get().count, 0);
});

test('rejectDraft marks rejected without publishing', async () => {
  const { db, calls } = stubDb({ first: [{ id: 'd1', household_id: 'our-home', status: 'pending', created_by_sub: 'kay' }] });
  const result = await rejectDraft(db, { id: 'd1', householdId: 'our-home', actorSub: 'kay', now: 5000 });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'rejected');
});

test('confirm fails if draft is already confirmed or rejected', async () => {
  const { db } = stubDb({ first: [{ id: 'd1', household_id: 'our-home', status: 'confirmed', created_by_sub: 'kay' }] });
  const result = await confirmDraft(db, { id: 'd1', householdId: 'our-home', actorSub: 'kay', recipe: { name: 'x' }, now: 6000 });
  assert.equal(result.status, 409);
});

test('operations fail closed without a resolved household', async () => {
  const { db, calls } = stubDb();
  const listed = await listDrafts(db, {});
  const created = await createDraft(db, { actorSub: 'kay', input: normalizeDraftInput({ imageRefs: ['x'], sourceType: 'image' }, 1), now: 1 });
  assert.deepEqual(listed, { status: 403, body: { error: 'household_required' } });
  assert.deepEqual(created, { status: 403, body: { error: 'household_required' } });
  assert.equal(calls.length, 0);
});

test('detectDuplicates finds candidate matches by normalized name', async () => {
  const { db, calls } = stubDb({ all: [{ results: [
    { id: 'r1', recipe_json: JSON.stringify({ name: 'Tomato Soup' }) },
    { id: 'r2', recipe_json: JSON.stringify({ name: 'tomato soup' }) },
  ] }] });
  const dupes = await detectDuplicates(db, { householdId: 'our-home', recipeName: 'Tomato Soup' });
  assert.equal(dupes.length, 2);
  const query = calls.find((c) => c.op === 'all');
  assert.match(query.sql, /household_recipes/);
});

test('failed extraction leaves an editable draft with original images', async () => {
  const { db, calls } = stubDb({ first: [{ id: 'd1', household_id: 'our-home', status: 'pending', image_refs_json: '["page1.png"]', created_by_sub: 'kay' }] });
  // Even with empty extraction, the draft remains editable
  const found = await getDraft(db, { id: 'd1', householdId: 'our-home' });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.imageRefs, ['page1.png']);
  assert.equal(found.body.status, 'pending');
});