CREATE TABLE IF NOT EXISTS community_recipes (
  id             TEXT PRIMARY KEY,
  author_sub     TEXT NOT NULL,
  author_name    TEXT NOT NULL,
  author_picture TEXT,
  recipe_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_created ON community_recipes(created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_community_author  ON community_recipes(author_sub, created_at DESC);