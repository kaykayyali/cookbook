// ════════════════════════════════════════════════════════
// community.js — shared-recipe store: schema + pure handlers (D1 injected)
// ════════════════════════════════════════════════════════

import {
  ensureImportProvenanceSchema,
  PROVENANCE_SELECT,
  provenanceFromRow,
} from './import-provenance.js';

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
 * D1 DDL for the household-owned recipe table and indexes. Existing community
 * rows are retained as a migration source; all live reads and writes use the
 * household table.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS household_recipes (
  id               TEXT PRIMARY KEY,
  household_id     TEXT NOT NULL,
  added_by_sub     TEXT NOT NULL,
  added_by_name    TEXT NOT NULL,
  added_by_picture TEXT,
  recipe_json      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_household_recipes_created
  ON household_recipes(household_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_household_recipes_added_by
  ON household_recipes(household_id, added_by_sub, created_at DESC);
`;

/**
 * Ensure both the live table and the one-way compatibility bridge from the
 * legacy community table. The copy is idempotent by recipe ID.
 */
export async function ensureSchema(db, householdId = 'our-home') {
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
    db.prepare(`CREATE TABLE IF NOT EXISTS household_recipes (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      added_by_sub TEXT NOT NULL,
      added_by_name TEXT NOT NULL,
      added_by_picture TEXT,
      recipe_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_household_recipes_created
      ON household_recipes(household_id, created_at DESC, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_household_recipes_added_by
      ON household_recipes(household_id, added_by_sub, created_at DESC)`),
  ]);
  await db.prepare(`
    INSERT OR IGNORE INTO household_recipes (
      id, household_id, added_by_sub, added_by_name, added_by_picture,
      recipe_json, created_at, updated_at
    )
    SELECT id, ?, author_sub, author_name, author_picture,
      recipe_json, created_at, updated_at
    FROM community_recipes
  `).bind(householdId).run();
  await ensureImportProvenanceSchema(db);
}

const schemaPromises = new WeakMap();
/** Idempotent per-binding schema ensure; concurrent calls share one promise. */
export function ensureOnce(db, householdId = 'our-home') {
  if (!schemaPromises.has(db)) {
    const promise = ensureSchema(db, householdId).catch((error) => {
      schemaPromises.delete(db);
      throw error;
    });
    schemaPromises.set(db, promise);
  }
  return schemaPromises.get(db);
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

const COLS = `r.id, r.household_id, r.added_by_sub, r.added_by_name, r.added_by_picture,
  r.recipe_json, r.created_at, r.updated_at, ${PROVENANCE_SELECT}`;
const RECIPE_FROM = `household_recipes AS r
  LEFT JOIN recipe_import_provenance AS p
    ON p.recipe_id = r.id AND p.household_id = r.household_id`;
const householdRequired = () => ({ status: 403, body: { error: 'household_required' } });

/** Map a D1 row to a recipe item while preserving household attribution. */
function rowToRecipe(row, { includeEvidence = false } = {}) {
  let recipe;
  try { recipe = JSON.parse(row.recipe_json); } catch { recipe = {}; }
  return {
    id: row.id,
    householdId: row.household_id,
    recipe,
    author: {
      sub: row.added_by_sub,
      name: row.added_by_name,
      picture: row.added_by_picture || null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    provenance: provenanceFromRow(row, { includeEvidence }),
  };
}

/**
 * List community recipes, newest first, keyset-paginated on (created_at, id).
 * Fetches limit+1 to detect a next page.
 * @param {object} db
 * @param {{cursor?:string, limit?:number}} opts
 * @returns {Promise<{status:number, body:object}>}
 */
export async function listCommunity(db, { householdId, cursor, limit, sourceUrl } = {}) {
  if (!householdId) return householdRequired();
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cur = decodeCursor(cursor);
  const conditions = ['r.household_id = ?'];
  const values = [householdId];
  if (typeof sourceUrl === 'string' && sourceUrl) {
    conditions.push('p.source_url = ?');
    values.push(sourceUrl);
  }
  if (cur) {
    conditions.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
    values.push(cur.c, cur.c, cur.i);
  }
  values.push(lim + 1);
  const results = await db.prepare(
    `SELECT ${COLS} FROM ${RECIPE_FROM}
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
  ).bind(...values).all();
  const rows = (results && results.results) || [];
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { status: 200, body: { recipes: page.map((row) => rowToRecipe(row)), nextCursor } };
}

/**
 * Get one community recipe by id.
 * @param {object} db
 * @param {string} id
 * @returns {Promise<{status:number, body:object}>}
 */
export async function getCommunity(db, { id, householdId } = {}) {
  if (!householdId) return householdRequired();
  const row = await db.prepare(
    `SELECT ${COLS} FROM ${RECIPE_FROM} WHERE r.id = ? AND r.household_id = ?`,
  ).bind(id, householdId).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: rowToRecipe(row, { includeEvidence: true }) };
}

/**
 * Share a recipe to the community. Stamps author from the session and stores
 * the canonical JSON-LD blob verbatim.
 * @param {object} db
 * @param {{recipe:object, author:{sub,name,picture}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function shareRecipe(db, { id: requestedId, recipe, author, householdId } = {}) {
  if (!householdId) return householdRequired();
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const id = typeof requestedId === 'string' && requestedId.trim() ? requestedId.trim().slice(0, 100) : uuid();
  const now = Date.now();
  await db.prepare(
    `INSERT OR IGNORE INTO household_recipes (
       id, household_id, added_by_sub, added_by_name, added_by_picture,
       recipe_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    householdId,
    author.sub,
    author.name,
    author.picture || null,
    JSON.stringify(recipe),
    now,
    now,
  ).run();
  return {
    status: 201,
    body: {
      id,
      householdId,
      recipe,
      author: { sub: author.sub, name: author.name, picture: author.picture || null },
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Edit a community recipe (author only). Loads the row to check ownership first.
 * @param {object} db
 * @param {{id:string, recipe:object, author:{sub,name,picture}}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function editRecipe(db, { id, recipe, author, householdId } = {}) {
  if (!householdId) return householdRequired();
  const err = validateRecipe(recipe);
  if (err) return { status: 400, body: { error: err } };
  const row = await db.prepare(
    `SELECT r.added_by_sub, r.created_at, ${PROVENANCE_SELECT}
     FROM ${RECIPE_FROM} WHERE r.id = ? AND r.household_id = ?`,
  ).bind(id, householdId).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.added_by_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  const now = Date.now();
  await db.prepare(
    `UPDATE household_recipes
     SET recipe_json = ?, added_by_name = ?, added_by_picture = ?, updated_at = ?
     WHERE id = ? AND household_id = ? AND added_by_sub = ?`,
  ).bind(
    JSON.stringify(recipe),
    author.name,
    author.picture || null,
    now,
    id,
    householdId,
    author.sub,
  ).run();
  return {
    status: 200,
    body: {
      id,
      householdId,
      recipe,
      author: { sub: author.sub, name: author.name, picture: author.picture || null },
      createdAt: row.created_at,
      updatedAt: now,
      provenance: provenanceFromRow(row),
    },
  };
}

/**
 * Delete a community recipe (author only).
 * @param {object} db
 * @param {{id:string, author:{sub}}} args
 * @returns {Promise<{status:number, body:null}>}
 */
export async function deleteCommunity(db, { id, author, householdId } = {}) {
  if (!householdId) return householdRequired();
  const row = await db.prepare(
    `SELECT added_by_sub FROM household_recipes WHERE id = ? AND household_id = ?`,
  ).bind(id, householdId).first();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.added_by_sub !== author.sub) return { status: 403, body: { error: 'not_author' } };
  await db.batch([
    db.prepare(
      `DELETE FROM household_recipes WHERE id = ? AND household_id = ? AND added_by_sub = ?`,
    ).bind(id, householdId, author.sub),
    db.prepare('DELETE FROM community_recipes WHERE id = ?').bind(id),
  ]);
  return { status: 204, body: null };
}

export { DEFAULT_LIMIT, MAX_LIMIT, uuid };