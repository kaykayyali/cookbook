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

/**
 * 500 server-misconfigured envelope. `reason` distinguishes which binding
 * is missing (e.g. 'ai_binding', 'google_client_id', 'session_secret') so
 * operators can tell the states apart. Shared by auth.js and extract.js.
 * @param {string} reason
 * @returns {Response}
 */
export function misconfigured(reason) {
  return json(500, { error: 'server_misconfigured', reason });
}
