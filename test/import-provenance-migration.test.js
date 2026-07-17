import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const migration = readFileSync(
  new URL('../docs/superpowers/migrations/0011_recipe_import_provenance.sql', import.meta.url),
  'utf8',
);

test('provenance migration leaves old/manual recipes valid and supports indexed source lookup after edits', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE households (id TEXT PRIMARY KEY);
    CREATE TABLE household_recipes (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      added_by_sub TEXT NOT NULL,
      added_by_name TEXT NOT NULL,
      added_by_picture TEXT,
      recipe_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );
    INSERT INTO households (id) VALUES ('our-home');
    INSERT INTO household_recipes
      (id, household_id, added_by_sub, added_by_name, recipe_json, created_at, updated_at)
      VALUES ('manual-1', 'our-home', 'kay', 'Kaysser', '{"name":"Manual"}', 1, 1);
  `);

  db.exec(migration);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_import_provenance').get().count, 0);
  assert.equal(JSON.parse(db.prepare('SELECT recipe_json FROM household_recipes WHERE id = ?').get('manual-1').recipe_json).name, 'Manual');

  const sourceUrl = 'https://recipes.example/soup?servings=4#method';
  db.prepare(`INSERT INTO household_recipes
    (id, household_id, added_by_sub, added_by_name, recipe_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('imported-1', 'our-home', 'kay', 'Kaysser', '{"name":"Imported"}', 2, 2);
  db.prepare(`INSERT INTO recipe_import_provenance
    (recipe_id, household_id, import_draft_id, source_type, source_url, imported_at,
     extractor_method, extractor_version, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'imported-1', 'our-home', 'draft-1', 'url', sourceUrl, 2,
    'json-ld', 'url-extractor-v1', '{"recipe":{"name":"Original"}}',
  );

  db.prepare('UPDATE household_recipes SET recipe_json = ?, updated_at = ? WHERE id = ?')
    .run('{"name":"Edited"}', 3, 'imported-1');
  const provenance = db.prepare(`SELECT p.* FROM recipe_import_provenance AS p
    WHERE p.household_id = ? AND p.source_url = ?`).get('our-home', sourceUrl);
  assert.equal(provenance.recipe_id, 'imported-1');
  assert.equal(provenance.source_url, sourceUrl);
  assert.equal(provenance.extractor_method, 'json-ld');
  assert.deepEqual(JSON.parse(provenance.evidence_json), { recipe: { name: 'Original' } });
  assert.equal(JSON.parse(db.prepare('SELECT recipe_json FROM household_recipes WHERE id = ?').get('imported-1').recipe_json).name, 'Edited');

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'recipe_import_provenance'").all();
  assert.ok(indexes.some(({ name }) => name === 'idx_recipe_import_provenance_source_url'));
  db.close();
});
