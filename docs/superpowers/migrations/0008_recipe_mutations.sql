CREATE TABLE IF NOT EXISTS household_recipe_mutations (
  household_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, mutation_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
