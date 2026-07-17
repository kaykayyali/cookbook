PRAGMA foreign_keys = ON;

-- Import provenance is deliberately separate from editable recipe_json. Existing
-- and manually-created household recipes have no row here and continue to load.
CREATE TABLE IF NOT EXISTS recipe_import_provenance (
  recipe_id         TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL,
  import_draft_id   TEXT NOT NULL UNIQUE,
  source_type       TEXT NOT NULL CHECK (source_type IN ('image', 'url')),
  source_url        TEXT,
  imported_at       INTEGER NOT NULL,
  extractor_method  TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  -- Bounded JSON evidence/reference only; raw source HTML and inline images are not copied here.
  evidence_json     TEXT NOT NULL,
  FOREIGN KEY (recipe_id) REFERENCES household_recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipe_import_provenance_source_url
  ON recipe_import_provenance(household_id, source_url, imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_recipe_import_provenance_household
  ON recipe_import_provenance(household_id, recipe_id);
