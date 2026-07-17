// Durable import provenance kept independently from editable recipe JSON.

import { boundedJsonString } from './bounded-json.js';

export const MAX_EVIDENCE_JSON_LENGTH = 32_768;

export const PROVENANCE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS recipe_import_provenance (
  recipe_id         TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL,
  import_draft_id   TEXT NOT NULL UNIQUE,
  source_type       TEXT NOT NULL CHECK (source_type IN ('image', 'url')),
  source_url        TEXT,
  imported_at       INTEGER NOT NULL,
  extractor_method  TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  evidence_json     TEXT NOT NULL,
  FOREIGN KEY (recipe_id) REFERENCES household_recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
)`;

export const DRAFT_PROVENANCE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS recipe_import_draft_provenance (
  import_draft_id    TEXT PRIMARY KEY,
  extractor_method  TEXT NOT NULL CHECK (length(extractor_method) > 0 AND extractor_method <> 'unknown'),
  extractor_version TEXT NOT NULL CHECK (length(extractor_version) > 0 AND extractor_version <> 'legacy'),
  evidence_json      TEXT NOT NULL CHECK (length(evidence_json) > 2 AND evidence_json <> '{}'),
  created_at         INTEGER NOT NULL,
  FOREIGN KEY (import_draft_id) REFERENCES recipe_import_drafts(id) ON DELETE CASCADE
)`;

export const DRAFT_PROVENANCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_import_draft_provenance_created
  ON recipe_import_draft_provenance(created_at DESC, import_draft_id)`;

export const DRAFT_PROVENANCE_SELECT = `
  dp.extractor_method AS draft_extractor_method,
  dp.extractor_version AS draft_extractor_version,
  dp.evidence_json AS draft_evidence_json,
  dp.created_at AS draft_provenance_created_at`;

export const PROVENANCE_SOURCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_recipe_import_provenance_source_url
  ON recipe_import_provenance(household_id, source_url, imported_at DESC)`;

export const PROVENANCE_RECIPE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_recipe_import_provenance_household
  ON recipe_import_provenance(household_id, recipe_id)`;

export const PROVENANCE_SUMMARY_SELECT = `
  p.source_type AS provenance_source_type,
  p.source_url AS provenance_source_url,
  p.imported_at AS provenance_imported_at,
  p.extractor_method AS provenance_extractor_method,
  p.extractor_version AS provenance_extractor_version`;

export const PROVENANCE_SELECT = `${PROVENANCE_SUMMARY_SELECT},
  p.evidence_json AS provenance_evidence_json`;

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function summarizeImageRefs(raw) {
  const refs = parseJson(raw || '[]', []);
  if (!Array.isArray(refs)) return [];
  return refs.slice(0, 20).map((ref) => {
    if (typeof ref !== 'string') return { type: 'unknown' };
    if (ref.startsWith('data:')) return { type: 'inline-image', encodedLength: ref.length };
    return { type: 'reference', value: ref.slice(0, 500) };
  });
}

const INLINE_DATA = /data:image\/[a-z0-9.+-]+;base64,|;base64,/i;

function sanitizeEvidence(value, depth = 0) {
  if (depth > 8) return '[depth-limited]';
  if (typeof value === 'string') return INLINE_DATA.test(value) ? '[inline-data-removed]' : value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeEvidence(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
    String(key).slice(0, 200), sanitizeEvidence(item, depth + 1),
  ]));
}

export function boundedEvidenceJson(value, maxLength = MAX_EVIDENCE_JSON_LENGTH) {
  return boundedJsonString(value, maxLength);
}

export function normalizeServerProvenance(value) {
  const extractorMethod = typeof value?.extractorMethod === 'string' ? value.extractorMethod.trim().slice(0, 200) : '';
  const extractorVersion = typeof value?.extractorVersion === 'string' ? value.extractorVersion.trim().slice(0, 200) : '';
  if (!extractorMethod || extractorMethod === 'unknown' || !extractorVersion || extractorVersion === 'legacy') {
    throw new Error('invalid_server_provenance');
  }
  const evidenceJson = boundedEvidenceJson(sanitizeEvidence(value.evidence ?? {}));
  const evidence = parseJson(evidenceJson, {});
  if (!evidence || Array.isArray(evidence) || typeof evidence !== 'object' || !Object.keys(evidence).length) {
    throw new Error('invalid_server_provenance');
  }
  return { extractorMethod, extractorVersion, evidence };
}

export function draftProvenanceStatement(db, { draftId, provenance, createdAt }) {
  const normalized = normalizeServerProvenance(provenance);
  return db.prepare(`INSERT INTO recipe_import_draft_provenance
      (import_draft_id, extractor_method, extractor_version, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(
      draftId, normalized.extractorMethod, normalized.extractorVersion,
      boundedEvidenceJson(normalized.evidence), createdAt,
    );
}

export function draftServerProvenanceFromRow(row) {
  if (!row?.draft_extractor_method) return null;
  return {
    extractorMethod: row.draft_extractor_method,
    extractorVersion: row.draft_extractor_version,
    evidence: parseJson(row.draft_evidence_json || '{}', {}),
    createdAt: row.draft_provenance_created_at,
  };
}

export function provenanceStatement(db, { draft, recipeId, importedAt }) {
  const snapshot = draftServerProvenanceFromRow(draft);
  if (!snapshot) throw new Error('immutable_provenance_missing');
  const sourceUrls = parseJson(draft.source_urls_json || '[]', []);
  const sourceUrl = draft.source_type === 'url' && typeof sourceUrls[0] === 'string' ? sourceUrls[0] : null;
  const evidence = {
    originalEvidence: snapshot.evidence,
    sourceReferences: draft.source_type === 'image' ? summarizeImageRefs(draft.image_refs_json) : [],
  };
  return db.prepare(`INSERT INTO recipe_import_provenance (
      recipe_id, household_id, import_draft_id, source_type, source_url, imported_at,
      extractor_method, extractor_version, evidence_json
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM recipe_import_drafts
         WHERE id = ? AND household_id = ? AND status IN ('pending', 'extracted')
      )
        AND EXISTS (
          SELECT 1 FROM household_recipes WHERE id = ? AND household_id = ?
        )`)
    .bind(
      recipeId, draft.household_id, draft.id, draft.source_type, sourceUrl, importedAt,
      snapshot.extractorMethod, snapshot.extractorVersion, boundedEvidenceJson(sanitizeEvidence(evidence)),
      draft.id, draft.household_id, recipeId, draft.household_id,
    );
}

export function provenanceFromRow(row, { includeEvidence = false } = {}) {
  if (!row?.provenance_source_type) return null;
  const provenance = {
    sourceType: row.provenance_source_type,
    sourceUrl: row.provenance_source_url || null,
    importedAt: row.provenance_imported_at,
    extractorMethod: row.provenance_extractor_method,
    extractorVersion: row.provenance_extractor_version,
  };
  if (includeEvidence) provenance.evidence = parseJson(row.provenance_evidence_json || '{}', {});
  return provenance;
}

export async function ensureImportProvenanceSchema(db) {
  await db.batch([
    db.prepare(PROVENANCE_TABLE_SQL),
    db.prepare(PROVENANCE_SOURCE_INDEX_SQL),
    db.prepare(PROVENANCE_RECIPE_INDEX_SQL),
  ]);
}

export async function ensureImportDraftProvenanceSchema(db) {
  await db.batch([
    db.prepare(DRAFT_PROVENANCE_TABLE_SQL),
    db.prepare(DRAFT_PROVENANCE_INDEX_SQL),
  ]);
}
