import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDraft, ensureImportDraftsSchema } from '../functions/_lib/import-drafts.js';
import { editRecipe, getCommunity, listCommunity } from '../functions/_lib/community.js';
import { extractRecipe } from '../functions/_lib/extract.js';
import { boundedEvidenceJson } from '../functions/_lib/import-provenance.js';
import { onRequestPost as extractRoute } from '../functions/api/extract.js';

const migrationUrl = new URL('../docs/superpowers/migrations/0011_recipe_import_provenance.sql', import.meta.url);
const EXACT_URL = 'https://recipes.example/soup?servings=4&utm_source=family#method';

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
    db: { prepare: (sql) => statement(sql), batch: async (stmts) => Promise.all(stmts.map((stmt) => stmt.run())) },
    calls,
  };
}

const importedRow = (overrides = {}) => ({
  id: 'recipe-1', household_id: 'our-home', added_by_sub: 'kay', added_by_name: 'Kaysser',
  added_by_picture: null, recipe_json: JSON.stringify({ name: 'Soup' }), created_at: 1000, updated_at: 1000,
  provenance_source_type: 'url', provenance_source_url: EXACT_URL, provenance_imported_at: 2000,
  provenance_extractor_method: 'json-ld', provenance_extractor_version: 'url-extractor-v1',
  provenance_evidence_json: JSON.stringify({ recipe: { name: 'Original Soup' } }),
  ...overrides,
});

test('migration creates backward-compatible indexed recipe import provenance', () => {
  assert.equal(existsSync(migrationUrl), true, 'provenance migration must exist');
  if (!existsSync(migrationUrl)) return;
  const migration = readFileSync(migrationUrl, 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS recipe_import_provenance/);
  assert.match(migration, /recipe_id\s+TEXT\s+PRIMARY KEY/);
  assert.match(migration, /source_url\s+TEXT/);
  assert.match(migration, /extractor_method\s+TEXT\s+NOT NULL/);
  assert.match(migration, /extractor_version\s+TEXT\s+NOT NULL/);
  assert.match(migration, /evidence_json\s+TEXT\s+NOT NULL/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_recipe_import_provenance_source_url/);
  assert.doesNotMatch(migration, /ALTER TABLE household_recipes|UPDATE household_recipes|DELETE FROM household_recipes/);
});

test('runtime schema bootstrap prepares one D1 statement at a time', async () => {
  const prepared = [];
  const db = {
    prepare(sql) {
      const statements = sql.split(';').map((part) => part.trim()).filter(Boolean);
      assert.equal(statements.length, 1, 'D1 prepare accepts only one SQL statement');
      prepared.push(sql);
      return { run: async () => ({ meta: { changes: 0 } }) };
    },
    batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
  };
  await ensureImportDraftsSchema(db);
  assert.ok(prepared.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS recipe_import_drafts')));
  assert.ok(prepared.some((sql) => sql.includes('idx_recipe_import_provenance_source_url')));
});

test('confirming an import persists exact source metadata and bounded original evidence separately', async () => {
  const extracted = {
    recipe: { name: 'Original Soup' },
    extractorMethod: 'json-ld',
    extractorVersion: 'url-extractor-v1',
    evidence: { headline: 'Original', text: 'é'.repeat(40_000) },
  };
  const { db, calls } = stubDb({ first: [{
    id: 'draft-1', household_id: 'our-home', status: 'extracted', created_by_sub: 'kay',
    source_type: 'url', source_urls_json: JSON.stringify([EXACT_URL]), image_refs_json: '[]',
    extracted_json: JSON.stringify(extracted), confidence_json: '{}', duplicate_ids_json: '[]',
    recipe_json: JSON.stringify(extracted.recipe), created_at: 1500, updated_at: 1600,
  }] });

  const result = await confirmDraft(db, {
    id: 'draft-1', householdId: 'our-home', actorSub: 'kay', recipe: { name: 'Edited Soup' }, now: 2000,
  });

  assert.equal(result.status, 200);
  const insert = calls.find((call) => call.op === 'run' && call.sql.includes('recipe_import_provenance'));
  assert.ok(insert, 'confirmation must insert immutable provenance');
  assert.ok(insert.values.includes(EXACT_URL), 'the exact submitted URL is persisted');
  assert.ok(insert.values.includes('url'));
  assert.ok(insert.values.includes('json-ld'));
  assert.ok(insert.values.includes('url-extractor-v1'));
  assert.ok(insert.values.includes(1500), 'import timestamp comes from the immutable draft creation time');
  const evidenceJson = insert.values.find((value) => typeof value === 'string' && value.includes('Original'));
  assert.ok(evidenceJson, 'original extraction evidence is retained');
  assert.doesNotThrow(() => JSON.parse(evidenceJson), 'bounded evidence remains valid JSON');
  assert.ok(new TextEncoder().encode(evidenceJson).byteLength <= 32_768, 'evidence is UTF-8 byte-bounded before D1 persistence');
});

test('provenance evidence byte bounding preserves useful valid JSON for multibyte input', () => {
  const bounded = boundedEvidenceJson({ headline: 'Original OCR', text: '🍲'.repeat(20_000) });
  const parsed = JSON.parse(bounded);
  assert.ok(new TextEncoder().encode(bounded).byteLength <= 32_768);
  assert.equal(parsed.truncated, true);
  assert.match(parsed.jsonPrefix, /Original OCR/);
});

test('confirming a current image import persists its versioned OCR evidence without image data', async () => {
  const extracted = {
    recipe: { name: 'Soup' },
    extractorMethod: 'workers-ai-vision',
    extractorVersion: 'image-extractor-v1',
    evidence: { pageText: 'Page 1:\nOriginal OCR: Soup ingredients water.' },
  };
  const { db, calls } = stubDb({ first: [{
    id: 'draft-image', household_id: 'our-home', status: 'extracted', created_by_sub: 'kay',
    source_type: 'image', source_urls_json: '[]',
    image_refs_json: JSON.stringify(['data:image/png;base64,b25l']),
    extracted_json: JSON.stringify(extracted), confidence_json: '{}', duplicate_ids_json: '[]',
    recipe_json: JSON.stringify(extracted.recipe), created_at: 1700, updated_at: 1800,
  }] });

  const result = await confirmDraft(db, {
    id: 'draft-image', householdId: 'our-home', actorSub: 'kay', recipe: { name: 'Reviewed Soup' }, now: 2000,
  });

  assert.equal(result.status, 200);
  const insert = calls.find((call) => call.op === 'run' && call.sql.includes('recipe_import_provenance'));
  assert.equal(insert.values[6], 'workers-ai-vision');
  assert.equal(insert.values[7], 'image-extractor-v1');
  assert.match(insert.values[8], /Original OCR/);
  assert.equal(insert.values[8].includes('data:image'), false);
});

test('recipes expose nullable provenance and can be queried by exact source URL', async () => {
  const importedDb = stubDb({ all: [{ results: [importedRow()] }] });
  const imported = await listCommunity(importedDb.db, { householdId: 'our-home', sourceUrl: EXACT_URL });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.recipes[0].provenance.sourceUrl, EXACT_URL);
  assert.equal(imported.body.recipes[0].provenance.sourceType, 'url');
  assert.equal(imported.body.recipes[0].provenance.evidence, undefined, 'list responses keep bounded evidence out of bulk payloads');
  const query = importedDb.calls.find((call) => call.op === 'all');
  assert.match(query.sql, /recipe_import_provenance/);
  assert.match(query.sql, /source_url = \?/);
  assert.doesNotMatch(
    query.sql,
    /p\.evidence_json|provenance_evidence_json/,
    'bulk list queries must not read the bounded evidence blob',
  );
  assert.ok(query.values.includes(EXACT_URL));

  const manualDb = stubDb({ all: [{ results: [importedRow({
    provenance_source_type: null, provenance_source_url: null, provenance_imported_at: null,
    provenance_extractor_method: null, provenance_extractor_version: null, provenance_evidence_json: null,
  })] }] });
  const manual = await listCommunity(manualDb.db, { householdId: 'our-home' });
  assert.equal(manual.body.recipes[0].provenance, null, 'old and manual recipes remain loadable');
});

test('editing recipe fields leaves provenance intact and detail reload exposes original evidence', async () => {
  const editDb = stubDb({ first: [importedRow()] });
  const edited = await editRecipe(editDb.db, {
    id: 'recipe-1', householdId: 'our-home', recipe: { name: 'Renamed Soup' },
    author: { sub: 'kay', name: 'Kaysser', picture: null },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.provenance.sourceUrl, EXACT_URL);
  const recipeUpdate = editDb.calls.find((call) => call.op === 'run');
  assert.doesNotMatch(recipeUpdate.sql, /recipe_import_provenance/);

  const getDb = stubDb({ first: [importedRow({ recipe_json: JSON.stringify({ name: 'Renamed Soup' }) })] });
  const reloaded = await getCommunity(getDb.db, { id: 'recipe-1', householdId: 'our-home' });
  assert.equal(reloaded.body.recipe.name, 'Renamed Soup');
  assert.equal(reloaded.body.provenance.sourceUrl, EXACT_URL);
  assert.deepEqual(reloaded.body.provenance.evidence, { recipe: { name: 'Original Soup' } });
  const detailQuery = getDb.calls.find((call) => call.op === 'first');
  assert.match(
    detailQuery.sql,
    /p\.evidence_json AS provenance_evidence_json/,
    'detail queries must still read original evidence',
  );
});

test('URL extractor identifies its method/version and returns bounded non-HTML evidence', async () => {
  const result = await extractRecipe(EXACT_URL, {
    fetchPage: async () => ({
      ok: true,
      html: '<html><script type="application/ld+json">{"@type":"Recipe","name":"Soup","recipeIngredient":["water"],"recipeInstructions":["Boil"]}</script></html>',
    }),
    runLLM: async () => '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.extractorMethod, 'json-ld');
  assert.equal(result.extractorVersion, 'url-extractor-v1');
  assert.equal(result.evidence.recipe.name, 'Soup');
  assert.equal(JSON.stringify(result.evidence).includes('<html>'), false, 'raw HTML is never retained');
  assert.ok(JSON.stringify(result.evidence).length <= 16_384);
});

test('URL extractor bounds multibyte evidence by UTF-8 bytes', async () => {
  const description = '🍲'.repeat(9_000);
  const result = await extractRecipe(EXACT_URL, {
    fetchPage: async () => ({
      ok: true,
      html: `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Recipe', name: 'Soup', description,
        recipeIngredient: ['water'], recipeInstructions: ['Boil'],
      })}</script>`,
    }),
    runLLM: async () => '',
  });
  const serialized = JSON.stringify(result.evidence);
  assert.equal(result.ok, true);
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.ok(new TextEncoder().encode(serialized).byteLength <= 16_384);
});

test('direct URL extraction creates an import draft carrying the exact submitted URL', async () => {
  const { db, calls } = stubDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    '<script type="application/ld+json">{"@type":"Recipe","name":"Soup","recipeIngredient":["water"],"recipeInstructions":["Boil"]}</script>',
    { status: 200 },
  );
  try {
    const response = await extractRoute({
      request: { json: async () => ({ url: EXACT_URL }) },
      env: { DB: db, AI: { run: async () => ({ response: '' }) }, EXTRACT_RATE_PER_MIN: '10' },
      data: {
        auth: { sub: 'kay', email: 'issue18@example.com' },
        household: { household: { id: 'our-home' } },
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.importDraftId, 'extract response links the reviewed recipe to its durable draft');
    const insert = calls.find((call) => call.op === 'run' && call.sql.includes('INSERT INTO recipe_import_drafts'));
    assert.ok(insert, 'direct URL extraction no longer bypasses import drafts');
    assert.ok(insert.values.some((value) => typeof value === 'string' && value.includes(EXACT_URL)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recoverable partial URL extraction persists truthful metadata and bounded original JSON-LD evidence', async () => {
  const { db, calls } = stubDb();
  const originalFetch = globalThis.fetch;
  const partialUrl = 'https://recipes.example/partial?source=review';
  globalThis.fetch = async () => new Response(
    '<script type="application/ld+json">{"@type":"Recipe","name":"Partial Soup","recipeIngredient":["water"]}</script>',
    { status: 200 },
  );
  try {
    const response = await extractRoute({
      request: { json: async () => ({ url: partialUrl }) },
      env: { DB: db, AI: { run: async () => ({ response: 'not a recipe' }) }, EXTRACT_RATE_PER_MIN: '10' },
      data: {
        auth: { sub: 'kay', email: 'partial-review@example.com' },
        household: { household: { id: 'our-home' } },
      },
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.partial.name, 'Partial Soup');
    assert.ok(body.importDraftId);
    const insert = calls.find((call) => call.op === 'run' && call.sql.includes('INSERT INTO recipe_import_drafts'));
    const extracted = JSON.parse(insert.values[6]);
    assert.equal(extracted.extractorMethod, 'json-ld-partial');
    assert.equal(extracted.extractorVersion, 'url-extractor-v1');
    assert.equal(extracted.evidence.jsonLd.name, 'Partial Soup');
    assert.notDeepEqual(extracted.evidence, {});
    assert.equal(JSON.stringify(extracted.evidence).includes('<script'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
