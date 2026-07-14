// ════════════════════════════════════════════════════════
// format.js — pure formatting helpers (no DOM)
// ════════════════════════════════════════════════════════

/**
 * Escape a string for safe insertion into HTML.
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

/**
 * Convert an ISO 8601 duration (PT10M, PT1H30M) to a human string (10m, 1h 30m).
 * Returns null for empty input, and echoes back unrecognised strings.
 * @param {string} iso
 * @returns {string|null}
 */
export function formatDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return iso;
  const h = +(m[1] || 0);
  const min = +(m[2] || 0);
  if (h && min) return `${h}h ${min}m`;
  if (h) return `${h}h`;
  if (min) return `${min}m`;
  return iso;
}

/**
 * Pluralise a noun based on count: pluralize(1,'recipe') → '1 recipe'.
 * @param {number} n
 * @param {string} word
 * @returns {string}
 */
export function pluralize(n, word) {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

/** Format schema.org values that may arrive as arrays without leaking JS's
 * comma-joined coercion into the UI. */
export function formatListValue(value, { numericServings = false } = {}) {
  const parts = (Array.isArray(value) ? value : [value])
    .filter((part) => part !== null && part !== undefined && String(part).trim())
    .map((part) => String(part).trim());
  if (numericServings && parts.length && /^\d+(?:\.\d+)?$/.test(parts[0])) {
    parts[0] = `${parts[0]} serving${parts[0] === '1' ? '' : 's'}`;
  }
  return parts.join(' · ');
}
