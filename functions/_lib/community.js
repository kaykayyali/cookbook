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
export { DEFAULT_LIMIT, MAX_LIMIT, uuid };