// ════════════════════════════════════════════════════════
// recipes.js — personal-recipe store: schema + pure handlers (D1 injected)
// ════════════════════════════════════════════════════════

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/** Server-side UUID (crypto.randomUUID with a Math.random fallback). */
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * D1 DDL for the recipes table + indexes. Idempotent (IF NOT EXISTS).
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS recipes (
  id             TEXT PRIMARY KEY,
  author_sub     TEXT NOT NULL,
  recipe_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipes_author ON recipes(author_sub, created_at DESC);
`;

/**
 * Run the schema DDL (idempotent).
 * @param {object} db D1 binding (env.DB)
 */
export async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      author_sub TEXT NOT NULL,
      recipe_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_recipes_author ON recipes(author_sub, created_at DESC)`),
  ]);
}

let schemaEnsured = false;
/** Idempotent per-isolate schema ensure. */
export async function ensureOnce(db) {
  if (schemaEnsured) return;
  await ensureSchema(db);
  schemaEnsured = true;
}

/**
 * Pull the author identity off the Pages context (set by _middleware.js).
 * @param {object} context
 * @returns {{sub:string,name:string}|null}
 */
export function authorFrom(context) {
  const a = context && context.data && context.data.auth;
  if (!a || typeof a.sub !== 'string' || !a.sub) return null;
  return { sub: a.sub };
}

/** A canonical recipe needs a non-empty name. Returns null if valid, 'bad_recipe' if not. */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return 'bad_recipe';
  if (typeof recipe.name !== 'string' || !recipe.name.trim()) return 'bad_recipe';
  return null;
}

const COLS = 'id, author_sub, recipe_json, created_at, updated_at';

/** Map a D1 row to a recipe item (recipe is the parsed canonical JSON-LD). */
function rowToRecipe(row) {
  let recipe;
  try { recipe = JSON.parse(row.recipe_json); } catch { recipe = {}; }
  return {
    id: row.id,
    recipe,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List user's recipes, newest first. Fetches limit+1 to detect a next page.
 * @param {object} db
 * @param {string} authorSub
 * @param {{cursor?:string, limit?:number}} opts
 * @returns {Promise<{status:number, body:object}>}
 */
export async function listRecipes(db, authorSub, { cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const results = await db.prepare(
    `SELECT ${COLS} FROM recipes WHERE author_sub = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(authorSub, lim + 1).all();
  const rows = (results && results.results) || [];
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  return { status: 200, body: { recipes: page.map(rowToRecipe), hasMore } };
}

/**
 * Get one recipe by id (scoped to author).
 * @param {object} db
 * @param {string} id
 * @param {string} authorSub
 * @returns {Promise<{status:number, body:object}>}
 */
export async function getRecipe(db, id, authorSub) {
  const row = await db.prepare(
    `SELECT ${COLS} FROM recipes WHERE id = ? AND author_sub = ?`,
  ).bind(id, authorSub).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: rowToRecipe(row) };
}

/**
 * Create a new recipe.
 * @param {object} db
 * @param {{recipe:object, author:{sub}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function createRecipe(db, { recipe, author }) {
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const id = uuid();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO recipes (id, author_sub, recipe_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, author.sub, JSON.stringify(recipe), now, now).run();
  return { status: 201, body: { id, recipe, createdAt: now, updatedAt: now } };
}

/**
 * Update a recipe (owner only).
 * @param {object} db
 * @param {{id:string, recipe:object, author:{sub}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function updateRecipe(db, { id, recipe, author }) {
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const row = await db.prepare(
    `SELECT author_sub FROM recipes WHERE id = ?`,
  ).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.author_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  const now = Date.now();
  await db.prepare(
    `UPDATE recipes SET recipe_json = ?, updated_at = ? WHERE id = ?`,
  ).bind(JSON.stringify(recipe), now, id).run();
  return { status: 200, body: { id, recipe, createdAt: row.created_at, updatedAt: now } };
}

/**
 * Delete a recipe (owner only).
 * @param {object} db
 * @param {{id:string, author:{sub}}} args
 * @returns {Promise<{status:number, body:null}>}
 */
export async function deleteRecipe(db, { id, author }) {
  const row = await db.prepare(
    `SELECT author_sub FROM recipes WHERE id = ?`,
  ).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.author_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  await db.prepare(`DELETE FROM recipes WHERE id = ?`).bind(id).run();
  return { status: 204, body: null };
}

/**
 * Count recipes for a user (used to detect first-login for seeding).
 * @param {object} db
 * @param {string} authorSub
 * @returns {Promise<number>}
 */
export async function countRecipes(db, authorSub) {
  const row = await db.prepare(
    `SELECT COUNT(*) as cnt FROM recipes WHERE author_sub = ?`,
  ).bind(authorSub).first();
  return row ? row.cnt : 0;
}

/**
 * Seed sample recipes for a first-time user.
 * @param {object} db
 * @param {string} authorSub
 * @param {object[]} seedRecipes - array of canonical JSON-LD recipes
 * @returns {Promise<{status:number, body:object}>}
 */
export async function seedRecipes(db, authorSub, seedRecipes) {
  if (!Array.isArray(seedRecipes) || !seedRecipes.length) {
    return { status: 400, body: { error: 'bad_seed_data' } };
  }
  const now = Date.now();
  const stmts = seedRecipes.map((recipe) => {
    const id = uuid();
    return db.prepare(
      `INSERT INTO recipes (id, author_sub, recipe_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, authorSub, JSON.stringify(recipe), now, now);
  });
  await db.batch(stmts);
  return { status: 201, body: { seeded: seedRecipes.length } };
}

export { DEFAULT_LIMIT, MAX_LIMIT, uuid };
