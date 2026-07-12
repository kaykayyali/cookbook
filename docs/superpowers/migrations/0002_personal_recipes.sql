-- Migration: personal recipes table
-- Applied once; ensureSchema() in functions/_lib/recipes.js also self-heals.

CREATE TABLE IF NOT EXISTS recipes (
  id             TEXT PRIMARY KEY,
  author_sub     TEXT NOT NULL,
  recipe_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipes_author ON recipes(author_sub, created_at DESC);
