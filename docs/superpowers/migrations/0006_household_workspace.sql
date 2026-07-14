-- Wave 02 household planning + shopping state.
CREATE TABLE IF NOT EXISTS household_workspace (
  household_id          TEXT PRIMARY KEY,
  revision              INTEGER NOT NULL DEFAULT 0,
  plan_json             TEXT NOT NULL DEFAULT '[]',
  cart_json             TEXT NOT NULL DEFAULT '[]',
  pantry_json           TEXT NOT NULL DEFAULT '[]',
  shopping_checked_json TEXT NOT NULL DEFAULT '{}',
  manual_items_json     TEXT NOT NULL DEFAULT '[]',
  recent_mutations_json TEXT NOT NULL DEFAULT '[]',
  updated_at            INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS household_workspace_mutations (
  household_id TEXT NOT NULL,
  mutation_id  TEXT NOT NULL,
  operation    TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, mutation_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

INSERT INTO household_workspace (household_id, updated_at)
VALUES ('our-home', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(household_id) DO NOTHING;
