// ════════════════════════════════════════════════════════
// whitelist.js — email allow-list gate (pure, no DOM/Workers)
// ════════════════════════════════════════════════════════

/**
 * True if email is in the comma-separated allow list (case-insensitive,
 * whitespace-trimmed). Empty/missing list or email → false (deny by default).
 * @param {string} email
 * @param {string} allowedCsv
 * @returns {boolean}
 */
export function isAllowed(email, allowedCsv) {
  if (typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  if (!e) return false;
  if (typeof allowedCsv !== 'string' || !allowedCsv.trim()) return false;
  const list = allowedCsv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(e);
}