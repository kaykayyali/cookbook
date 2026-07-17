import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const migration = (name) => readFileSync(new URL(`../docs/superpowers/migrations/${name}`, import.meta.url), 'utf8');

test('cooking rating migration upgrades legacy history without fabricating stars', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { t.skip('node:sqlite is unavailable on this supported Node version'); return; }
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE households (id TEXT PRIMARY KEY);
    CREATE TABLE household_recipes (id TEXT PRIMARY KEY, household_id TEXT NOT NULL);
    INSERT INTO households (id) VALUES ('our-home');
    INSERT INTO household_recipes (id, household_id) VALUES ('r1', 'our-home');
  `);
  db.exec(migration('0007_cooking_history.sql'));
  db.exec(migration('0009_cook_history_audit.sql'));
  db.exec(`
    INSERT INTO cook_events
      (id, household_id, recipe_id, cooked_at, participants_json, cook_sub, servings, notes, created_by_sub, created_at, updated_at)
      VALUES ('e1', 'our-home', 'r1', 1, '["kay"]', 'kay', 2, 'Anniversary dinner', 'kay', 1, 1);
    INSERT INTO cook_event_reactions
      (cook_event_id, member_sub, reaction, note, created_at, updated_at)
      VALUES ('e1', 'kay', 'good', 'Use less salt', 1, 1);
  `);
  db.exec(migration('0010_cook_ratings.sql'));

  const event = db.prepare('SELECT occasion, notes FROM cook_events WHERE id = ?').get('e1');
  const reaction = db.prepare(`
    SELECT reaction, note, taste, complexity, review
    FROM cook_event_reactions WHERE cook_event_id = ? AND member_sub = ?
  `).get('e1', 'kay');
  assert.equal(event.occasion, 'Anniversary dinner');
  assert.equal(event.notes, 'Anniversary dinner');
  assert.equal(reaction.reaction, 'good');
  assert.equal(reaction.note, 'Use less salt');
  assert.equal(reaction.taste, null);
  assert.equal(reaction.complexity, null);
  assert.equal(reaction.review, 'Use less salt');
  db.close();
});
