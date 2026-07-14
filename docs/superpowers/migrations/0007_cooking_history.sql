PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cook_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  plan_entry_id TEXT,
  cooked_at INTEGER NOT NULL,
  participants_json TEXT NOT NULL,
  cook_sub TEXT NOT NULL,
  servings REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  photo_ref TEXT,
  created_by_sub TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (recipe_id) REFERENCES household_recipes(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_cook_events_household_time
  ON cook_events(household_id, cooked_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_cook_events_recipe_time
  ON cook_events(household_id, recipe_id, cooked_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cook_events_plan
  ON cook_events(household_id, plan_entry_id) WHERE plan_entry_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cook_event_reactions (
  cook_event_id TEXT NOT NULL,
  member_sub TEXT NOT NULL,
  reaction TEXT CHECK (reaction IN ('loved', 'good', 'not_for_us')),
  would_make_again INTEGER,
  note TEXT NOT NULL DEFAULT '',
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (cook_event_id, member_sub),
  FOREIGN KEY (cook_event_id) REFERENCES cook_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cook_reactions_member
  ON cook_event_reactions(member_sub, updated_at DESC);
