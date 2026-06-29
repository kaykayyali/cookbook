// ════════════════════════════════════════════════════════
// http.js — tiny JSON Response helper for Pages Functions
// ════════════════════════════════════════════════════════

/**
 * Build a JSON Response. Same-origin API, so no CORS headers are needed.
 * @param {number} status
 * @param {object} body
 * @returns {Response}
 */
export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}