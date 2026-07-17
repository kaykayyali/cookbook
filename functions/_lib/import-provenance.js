// Durable import provenance kept independently from editable recipe JSON.

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

export const PROVENANCE_SOURCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_recipe_import_provenance_source_url
  ON recipe_import_provenance(household_id, source_url, imported_at DESC)`;

export const PROVENANCE_RECIPE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_recipe_import_provenance_household
  ON recipe_import_provenance(household_id, recipe_id)`;

export const PROVENANCE_SELECT = `
  p.source_type AS provenance_source_type,
  p.source_url AS provenance_source_url,
  p.imported_at AS provenance_imported_at,
  p.extractor_method AS provenance_extractor_method,
  p.extractor_version AS provenance_extractor_version,
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

export function boundedEvidenceJson(value, maxLength = MAX_EVIDENCE_JSON_LENGTH) {
  let serialized;
  try { serialized = JSON.stringify(value ?? {}); } catch { serialized = '{}'; }
  if (serialized.length <= maxLength) return serialized;
  const envelope = {
    truncated: true,
    originalLength: serialized.length,
    jsonPrefix: serialized.slice(0, Math.max(0, maxLength - 100)),
  };
  let bounded = JSON.stringify(envelope);
  while (bounded.length > maxLength && envelope.jsonPrefix.length) {
    envelope.jsonPrefix = envelope.jsonPrefix.slice(0, envelope.jsonPrefix.length - (bounded.length - maxLength));
    bounded = JSON.stringify(envelope);
  }
  return bounded.length <= maxLength ? bounded : '{}';
}

export function provenanceStatement(db, { draft, recipeId, importedAt }) {
  const extracted = parseJson(draft.extracted_json || '{}', {});
  const sourceUrls = parseJson(draft.source_urls_json || '[]', []);
  const sourceUrl = draft.source_type === 'url' && typeof sourceUrls[0] === 'string' ? sourceUrls[0] : null;
  const extractorMethod = typeof extracted.extractorMethod === 'string' && extracted.extractorMethod
    ? extracted.extractorMethod
    : draft.source_type === 'image' ? 'workers-ai-vision' : 'unknown';
  const extractorVersion = typeof extracted.extractorVersion === 'string' && extracted.extractorVersion
    ? extracted.extractorVersion
    : 'legacy';
  const evidence = {
    originalExtraction: extracted,
    sourceReferences: draft.source_type === 'image' ? summarizeImageRefs(draft.image_refs_json) : [],
  };
  return db.prepare(`INSERT INTO recipe_import_provenance (
      recipe_id, household_id, import_draft_id, source_type, source_url, imported_at,
      extractor_method, extractor_version, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      recipeId, draft.household_id, draft.id, draft.source_type, sourceUrl, importedAt,
      extractorMethod, extractorVersion, boundedEvidenceJson(evidence),
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
