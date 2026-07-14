PRAGMA foreign_keys = ON;

ALTER TABLE cook_events ADD COLUMN prior_plan_status TEXT;

CREATE TABLE IF NOT EXISTS cook_event_audit (
  id TEXT PRIMARY KEY,
  cook_event_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  actor_sub TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('created', 'corrected', 'deleted')),
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (cook_event_id) REFERENCES cook_events(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cook_event_audit_event
  ON cook_event_audit(household_id, cook_event_id, created_at, id);
