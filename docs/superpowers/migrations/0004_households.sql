CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id TEXT NOT NULL,
  user_sub TEXT NOT NULL,
  display_name TEXT NOT NULL,
  picture TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, user_sub),
  UNIQUE (user_sub),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_household_members_user_sub
  ON household_members(user_sub);

CREATE INDEX IF NOT EXISTS idx_household_members_household
  ON household_members(household_id, joined_at);
