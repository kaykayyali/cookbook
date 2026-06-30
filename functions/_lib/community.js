// ════════════════════════════════════════════════════════
// community.js — shared-recipe store: schema + pure handlers (D1 injected)
// ════════════════════════════════════════════════════════

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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
 * D1 DDL for the community_recipes table + indexes. Idempotent (IF NOT EXISTS),
 * so ensureSchema is safe to run on every cold start.
 */
export const SCHEMA = `
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
`;

/**
 * Run the schema DDL (idempotent). Uses db.batch so the statements apply in one
 * transaction. Safe to call repeatedly.
 * @param {object} db D1 binding (env.DB)
 */
export async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS community_recipes (
      id TEXT PRIMARY KEY,
      author_sub TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_picture TEXT,
      recipe_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_community_created ON community_recipes(created_at DESC, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_community_author ON community_recipes(author_sub, created_at DESC)`),
  ]);
}

let schemaEnsured = false;
/** Idempotent per-isolate schema ensure — routes call this once, then handlers run. */
export async function ensureOnce(db) {
  if (schemaEnsured) return;
  await ensureSchema(db);
  schemaEnsured = true;
}

/**
 * Pull the author identity off the Pages context (set by _middleware.js as
 * context.data.auth). Returns null when unauthenticated. `name` falls back to
 * the email local-part then 'member' so author_name is never empty — this also
 * covers tokens minted before name/picture were added.
 * @param {object} context
 * @returns {{sub:string,name:string,picture:string|null}|null}
 */
export function authorFrom(context) {
  const a = context && context.data && context.data.auth;
  if (!a || typeof a.sub !== 'string' || !a.sub) return null;
  const name = (typeof a.name === 'string' && a.name.trim())
    || (typeof a.email === 'string' && a.email.split('@')[0])
    || 'member';
  return { sub: a.sub, name, picture: a.picture || null };
}

// (handlers + cursor helpers are appended in Task 3)

/** base64url encode (no Buffer — uses btoa, a web standard in Workers + Node>=16). */
function b64url(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return atob(b64 + pad);
}

/** Encode a keyset cursor from the last row's (created_at, id). */
export function encodeCursor({ createdAt, id }) {
  return b64url(JSON.stringify({ c: createdAt, i: id }));
}

/** Decode a cursor to { c, i } or null (missing/garbage). */
export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !cursor) return null;
  try {
    const obj = JSON.parse(b64urlDecode(cursor));
    if (typeof obj.c !== 'number' || typeof obj.i !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

/** A canonical recipe needs a non-empty name. Returns null if valid, 'bad_recipe' if not. */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return 'bad_recipe';
  if (typeof recipe.name !== 'string' || !recipe.name.trim()) return 'bad_recipe';
  return null;
}

const COLS = 'id, author_sub, author_name, author_picture, recipe_json, created_at, updated_at';

/** Map a D1 row to a recipe item (recipe is the parsed canonical JSON-LD). */
function rowToRecipe(row) {
  let recipe;
  try { recipe = JSON.parse(row.recipe_json); } catch { recipe = {}; }
  return {
    id: row.id,
    recipe,
    author: { sub: row.author_sub, name: row.author_name, picture: row.author_picture || null },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List community recipes, newest first, keyset-paginated on (created_at, id).
 * Fetches limit+1 to detect a next page.
 * @param {object} db
 * @param {{cursor?:string, limit?:number}} opts
 * @returns {Promise<{status:number, body:object}>}
 */
export async function listCommunity(db, { cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cur = decodeCursor(cursor);
  let results;
  if (cur) {
    results = await db.prepare(
      `SELECT ${COLS} FROM community_recipes
       WHERE created_at < ? OR (created_at = ? AND id < ?)
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    ).bind(cur.c, cur.c, cur.i, lim + 1).all();
  } else {
    results = await db.prepare(
      `SELECT ${COLS} FROM community_recipes ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(lim + 1).all();
  }
  const rows = (results && results.results) || [];
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { status: 200, body: { recipes: page.map(rowToRecipe), nextCursor } };
}

/**
 * Get one community recipe by id.
 * @param {object} db
 * @param {string} id
 * @returns {Promise<{status:number, body:object}>}
 */
export async function getCommunity(db, id) {
  const row = await db.prepare(`SELECT ${COLS} FROM community_recipes WHERE id = ?`).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: rowToRecipe(row) };
}

/**
 * Share a recipe to the community. Stamps author from the session and stores
 * the canonical JSON-LD blob verbatim.
 * @param {object} db
 * @param {{recipe:object, author:{sub,name,picture}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function shareRecipe(db, { recipe, author }) {
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const id = uuid();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO community_recipes (id, author_sub, author_name, author_picture, recipe_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, author.sub, author.name, author.picture || null, JSON.stringify(recipe), now, now).run();
  return {
    status: 201,
    body: { id, recipe, author: { sub: author.sub, name: author.name, picture: author.picture || null }, createdAt: now, updatedAt: now },
  };
}

/**
 * Edit a community recipe (author only). Loads the row to check ownership first.
 * @param {object} db
 * @param {{id:string, recipe:object, author:{sub,name,picture}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function editRecipe(db, { id, recipe, author }) {
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const row = await db.prepare(`SELECT author_sub, created_at FROM community_recipes WHERE id = ?`).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.author_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  const now = Date.now();
  await db.prepare(
    `UPDATE community_recipes SET recipe_json = ?, author_name = ?, author_picture = ?, updated_at = ? WHERE id = ?`,
  ).bind(JSON.stringify(recipe), author.name, author.picture || null, now, id).run();
  return {
    status: 200,
    body: { id, recipe, author: { sub: author.sub, name: author.name, picture: author.picture || null }, createdAt: row.created_at, updatedAt: now },
  };
}

/**
 * Delete a community recipe (author only).
 * @param {object} db
 * @param {{id:string, author:{sub}}} args
 * @returns {Promise<{status:number, body:null}>}
 */
export async function deleteCommunity(db, { id, author }) {
  const row = await db.prepare(`SELECT author_sub FROM community_recipes WHERE id = ?`).bind(id).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.author_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  await db.prepare(`DELETE FROM community_recipes WHERE id = ?`).bind(id).run();
  return { status: 204, body: null };
}

export { DEFAULT_LIMIT, MAX_LIMIT, uuid };