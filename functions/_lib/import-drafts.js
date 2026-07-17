// ════════════════════════════════════════════════════════
// import-drafts.js — recipe image capture draft lifecycle (pure, deps injected)
// ════════════════════════════════════════════════════════

import { ensureImportProvenanceSchema, provenanceStatement } from './import-provenance.js';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS recipe_import_drafts (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL,
  created_by_sub  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'extracted', 'confirmed', 'rejected')),
  source_type     TEXT NOT NULL DEFAULT 'image'
                  CHECK (source_type IN ('image', 'url')),
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  image_refs_json TEXT NOT NULL DEFAULT '[]',
  extracted_json  TEXT NOT NULL DEFAULT '{}',
  recipe_json     TEXT,
  confidence_json TEXT NOT NULL DEFAULT '{}',
  duplicate_ids_json TEXT NOT NULL DEFAULT '[]',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  confirmed_at    INTEGER,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_import_drafts_household
  ON recipe_import_drafts(household_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_import_drafts_status
  ON recipe_import_drafts(household_id, status, updated_at DESC);
`;

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const sourceUrl = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return '';
  return value;
};
const VALID_SOURCES = new Set(['image', 'url']);
const TERMINAL_STATES = new Set(['confirmed', 'rejected']);

export function normalizeDraftInput(input, now = Date.now()) {
  if (!input || typeof input !== 'object') throw new Error('invalid_draft_input');
  const sourceType = text(input.sourceType, 20) || 'image';
  if (!VALID_SOURCES.has(sourceType)) throw new Error('invalid_draft_input');

  const imageRefs = Array.isArray(input.imageRefs)
    ? input.imageRefs.map((r) => text(r, 2_000_000)).filter(Boolean)
    : [];
  const sourceUrls = Array.isArray(input.sourceUrls)
    ? input.sourceUrls.map(sourceUrl).filter(Boolean)
    : [];

  if (sourceType === 'image' && !imageRefs.length) throw new Error('invalid_draft_input');
  if (JSON.stringify(imageRefs).length > 8_000_000) throw new Error('invalid_draft_input');
  if (sourceType === 'url' && !sourceUrls.length) throw new Error('invalid_draft_input');

  return {
    sourceType,
    imageRefs: imageRefs.slice(0, 20),
    sourceUrls: sourceUrls.slice(0, 10),
    notes: text(input.notes, 2000),
    extracted: input.extracted || {},
    confidence: input.confidence || {},
  };
}

function draftFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    householdId: row.household_id,
    createdBySub: row.created_by_sub,
    status: row.status,
    sourceType: row.source_type,
    sourceUrls: JSON.parse(row.source_urls_json || '[]'),
    imageRefs: JSON.parse(row.image_refs_json || '[]'),
    extracted: JSON.parse(row.extracted_json || '{}'),
    recipe: row.recipe_json ? JSON.parse(row.recipe_json) : null,
    confidence: JSON.parse(row.confidence_json || '{}'),
    duplicateIds: JSON.parse(row.duplicate_ids_json || '[]'),
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at || null,
  };
}

function requireHousehold(householdId) {
  if (!householdId) return { status: 403, body: { error: 'household_required' } };
  return null;
}

export async function createDraft(db, { householdId, actorSub, input, now = Date.now() }) {
  const blocked = requireHousehold(householdId);
  if (blocked) return blocked;
  if (!actorSub) return { status: 403, body: { error: 'household_required' } };
  const normalized = normalizeDraftInput(input, now);
  const id = globalThis.crypto?.randomUUID?.() || `draft-${now}-${Math.random().toString(36).slice(2)}`;
  await db.prepare(
    `INSERT INTO recipe_import_drafts
     (id, household_id, created_by_sub, status, source_type, source_urls_json, image_refs_json,
      extracted_json, confidence_json, duplicate_ids_json, notes, created_at, updated_at, confirmed_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, '[]', ?, ?, ?, NULL)`
  ).bind(
    id, householdId, actorSub, normalized.sourceType,
    JSON.stringify(normalized.sourceUrls), JSON.stringify(normalized.imageRefs),
    JSON.stringify(normalized.extracted), JSON.stringify(normalized.confidence),
    normalized.notes, now, now,
  ).run();
  return { status: 201, body: draftFromRow({ id, household_id: householdId, created_by_sub: actorSub, status: 'pending', source_type: normalized.sourceType, source_urls_json: JSON.stringify(normalized.sourceUrls), image_refs_json: JSON.stringify(normalized.imageRefs), extracted_json: JSON.stringify(normalized.extracted), confidence_json: JSON.stringify(normalized.confidence), duplicate_ids_json: '[]', notes: normalized.notes, created_at: now, updated_at: now, confirmed_at: null }) };
}

export async function listDrafts(db, { householdId, status = null, limit = 50 }) {
  const blocked = requireHousehold(householdId);
  if (blocked) return blocked;
  let sql = 'SELECT * FROM recipe_import_drafts WHERE household_id = ?';
  const values = [householdId];
  if (status) { sql += ' AND status = ?'; values.push(status); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  values.push(limit);
  const result = await db.prepare(sql).bind(...values).all();
  return { status: 200, body: { drafts: (result?.results || []).map(draftFromRow) } };
}

export async function getDraft(db, { id, householdId }) {
  const blocked = requireHousehold(householdId);
  if (blocked) return blocked;
  const row = await db.prepare('SELECT * FROM recipe_import_drafts WHERE id = ? AND household_id = ?')
    .bind(id, householdId).first();
  if (!row) return { status: 404, body: { error: 'draft_not_found' } };
  return { status: 200, body: draftFromRow(row) };
}

export async function updateDraftRecipe(db, { id, householdId, actorSub, recipe, now = Date.now() }) {
  const blocked = requireHousehold(householdId);
  if (blocked) return blocked;
  const existing = await db.prepare('SELECT * FROM recipe_import_drafts WHERE id = ? AND household_id = ?')
    .bind(id, householdId).first();
  if (!existing) return { status: 404, body: { error: 'draft_not_found' } };
  if (TERMINAL_STATES.has(existing.status)) return { status: 409, body: { error: 'draft_terminal' } };
  const recipeJson = JSON.stringify(recipe);
  await db.prepare(
    `UPDATE recipe_import_drafts SET recipe_json = ?, status = 'extracted', updated_at = ? WHERE id = ? AND household_id = ?`
  ).bind(recipeJson, now, id, householdId).run();
  return { status: 200, body: { ...draftFromRow(existing), status: 'extracted', recipe, updatedAt: now } };
}

export async function updateDraftExtraction(db, { id, householdId, extracted, confidence, duplicateIds, now = Date.now() }) {
  const blocked = requireHousehold(householdId);
  if (blocked) return blocked;
  const existing = await db.prepare('SELECT * FROM recipe_import_drafts WHERE id = ? AND household_id = ?')
    .bind(id, householdId).first();
  if (!existing) return { status: 404, body: { error: 'draft_not_found' } };
  if (TERMINAL_STATES.has(existing.status)) return { status: 409, body: { error: 'draft_terminal' } };
  await db.prepare(
    `UPDATE recipe_import_drafts SET extracted_json = ?, confidence_json = ?, duplicate_ids_json = ?, status = 'extracted', updated_at = ? WHERE id = ? AND household_id = ?`
  ).bind(
    JSON.stringify(extracted || {}), JSON.stringify(confidence || {}), JSON.stringify(duplicateIds || []), now, id, householdId,
  ).run();
  return { status: 200, body: { ...draftFromRow(existing), status: 'extracted', extracted, confidence, duplicateIds, updatedAt: now } };
}

export async function confirmDraft(db, {
  id, householdId, actorSub, actorName, actorPicture, recipe, now = Date.now(), recipeIdFactory,
}) {
  const blocked = requireHousehold(householdId);
  if (blocked) return blocked;
  const existing = await db.prepare('SELECT * FROM recipe_import_drafts WHERE id = ? AND household_id = ?')
    .bind(id, householdId).first();
  if (!existing) return { status: 404, body: { error: 'draft_not_found' } };
  if (TERMINAL_STATES.has(existing.status)) return { status: 409, body: { error: 'draft_terminal' } };

  const recipeId = typeof recipeIdFactory === 'function'
    ? recipeIdFactory()
    : globalThis.crypto?.randomUUID?.() || `r-${now}-${Math.random().toString(36).slice(2)}`;
  const recipeJson = JSON.stringify(recipe);
  const displayName = typeof actorName === 'string' && actorName.trim() ? actorName.trim() : 'member';
  const displayPicture = typeof actorPicture === 'string' && actorPicture ? actorPicture : null;

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO household_recipes (
           id, household_id, added_by_sub, added_by_name, added_by_picture, recipe_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(recipeId, householdId, actorSub, displayName, displayPicture, recipeJson, now, now),
      provenanceStatement(db, { draft: existing, recipeId, importedAt: existing.created_at ?? now }),
      db.prepare(
        `UPDATE recipe_import_drafts SET recipe_json = ?, status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ? AND household_id = ?`
      ).bind(recipeJson, now, now, id, householdId),
    ]);
  } catch (error) {
    const collision = await db.prepare('SELECT id FROM household_recipes WHERE id = ?').bind(recipeId).first();
    if (collision) return { status: 409, body: { error: 'recipe_id_collision' } };
    throw error;
  }

  return { status: 200, body: { status: 'confirmed', recipeId, updatedAt: now } };
}

export async function rejectDraft(db, { id, householdId, actorSub, now = Date.now() }) {
  const blocked = requireHousehold(householdId);
  if (blocked) return blocked;
  const existing = await db.prepare('SELECT * FROM recipe_import_drafts WHERE id = ? AND household_id = ?')
    .bind(id, householdId).first();
  if (!existing) return { status: 404, body: { error: 'draft_not_found' } };
  if (TERMINAL_STATES.has(existing.status)) return { status: 409, body: { error: 'draft_terminal' } };
  await db.prepare(
    `UPDATE recipe_import_drafts SET status = 'rejected', updated_at = ? WHERE id = ? AND household_id = ?`
  ).bind(now, id, householdId).run();
  return { status: 200, body: { status: 'rejected', updatedAt: now } };
}

function normalizeName(name) {
  return (name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

export async function detectDuplicates(db, { householdId, recipeName }) {
  if (!householdId || !recipeName) return [];
  const target = normalizeName(recipeName);
  if (!target) return [];
  const result = await db.prepare(
    `SELECT id, recipe_json FROM household_recipes WHERE household_id = ? ORDER BY created_at DESC`
  ).bind(householdId).all();
  const matches = [];
  for (const row of (result?.results || [])) {
    let name = '';
    try { name = JSON.parse(row.recipe_json || '{}').name || ''; } catch { /* skip */ }
    if (normalizeName(name) === target) matches.push({ id: row.id, name });
  }
  return matches;
}

export async function ensureImportDraftsSchema(db) {
  const statements = SCHEMA.split(';').map((sql) => sql.trim()).filter(Boolean);
  await db.batch(statements.map((sql) => db.prepare(sql)));
  await ensureImportProvenanceSchema(db);
}