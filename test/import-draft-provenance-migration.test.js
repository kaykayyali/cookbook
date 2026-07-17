import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const migration = readFileSync(
  new URL('../docs/superpowers/migrations/0012_import_draft_server_provenance.sql', import.meta.url),
  'utf8',
);

test('ordered draft provenance migration is additive and idempotent', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { t.skip('node:sqlite is unavailable on this supported Node version'); return; }
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE households (id TEXT PRIMARY KEY);
    CREATE TABLE recipe_import_drafts (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );
    INSERT INTO households VALUES ('our-home');
    INSERT INTO recipe_import_drafts VALUES ('draft-1', 'our-home');
  `);

  db.exec(migration);
  db.exec(migration);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recipe_import_draft_provenance'").get();
  assert.equal(table.name, 'recipe_import_draft_provenance');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS recipe_import_draft_provenance/);
  assert.doesNotMatch(migration, /UPDATE\s+recipe_import_drafts|DELETE\s+FROM\s+recipe_import_drafts/i);
  db.close();
});
