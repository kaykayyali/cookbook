PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS recipe_import_drafts (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL,
  created_by_sub  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'extracted', 'confirmed', 'rejected')),
  source_type     TEXT NOT NULL DEFAULT 'image'
                  CHECK (source_type IN ('image', 'url')),
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  -- Ordered list of R2/storage keys or data-URL references for uploaded images.
  image_refs_json TEXT NOT NULL DEFAULT '[]',
  -- Raw OCR/vision extraction output (may be partial or empty on failure).
  extracted_json  TEXT NOT NULL DEFAULT '{}',
  -- User-reviewed recipe object ready for household_recipes publication.
  recipe_json     TEXT,
  -- Per-field confidence cues from extraction (0..1 or null).
  confidence_json TEXT NOT NULL DEFAULT '{}',
  -- Duplicate detection: candidate existing recipe IDs that may match.
  duplicate_ids_json TEXT NOT NULL DEFAULT '[]',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  confirmed_at    INTEGER,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_drafts_household
  ON recipe_import_drafts(household_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_import_drafts_status
  ON recipe_import_drafts(household_id, status, updated_at DESC);