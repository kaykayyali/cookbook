PRAGMA foreign_keys = ON;

-- Immutable extraction provenance is stored separately from caller-editable draft JSON.
-- CREATE IF NOT EXISTS keeps local/D1 migration reapplication safe.
CREATE TABLE IF NOT EXISTS recipe_import_draft_provenance (
  import_draft_id   TEXT PRIMARY KEY,
  extractor_method TEXT NOT NULL CHECK (length(extractor_method) > 0 AND extractor_method <> 'unknown'),
  extractor_version TEXT NOT NULL CHECK (length(extractor_version) > 0 AND extractor_version <> 'legacy'),
  evidence_json     TEXT NOT NULL CHECK (length(evidence_json) > 2 AND evidence_json <> '{}'),
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (import_draft_id) REFERENCES recipe_import_drafts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_draft_provenance_created
  ON recipe_import_draft_provenance(created_at DESC, import_draft_id);
