-- Migration: move the shared recipe catalog under the permanent household.
-- Existing community rows are copied without deletion so rollback remains safe.

INSERT INTO households (id, name, created_at, updated_at)
VALUES (
  'our-home',
  'Our Home',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS household_recipes (
  id               TEXT PRIMARY KEY,
  household_id     TEXT NOT NULL,
  added_by_sub     TEXT NOT NULL,
  added_by_name    TEXT NOT NULL,
  added_by_picture TEXT,
  recipe_json      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_household_recipes_created
  ON household_recipes(household_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_household_recipes_added_by
  ON household_recipes(household_id, added_by_sub, created_at DESC);

-- Duplicate recipe content remains as distinct rows because each legacy ID and
-- attribution is meaningful. Only an ID collision is ignored on repeated runs.
INSERT OR IGNORE INTO household_recipes (
  id,
  household_id,
  added_by_sub,
  added_by_name,
  added_by_picture,
  recipe_json,
  created_at,
  updated_at
)
SELECT
  id,
  'our-home',
  author_sub,
  author_name,
  author_picture,
  recipe_json,
  created_at,
  updated_at
FROM community_recipes;
