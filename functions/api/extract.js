// ════════════════════════════════════════════════════════
// extract.js — POST /api/extract: URL → schema.org/Recipe
// Auth-gated by functions/api/_middleware.js (request.auth = { sub, email }).
// ════════════════════════════════════════════════════════
import { json } from '../_lib/http.js';
import { handleExtract } from '../_lib/extract.js';

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// In-memory per-email sliding-window rate limiter. Resets when the caller's
// 60s window elapses. NOTE: per-isolate state — not shared across the fleet;
// adequate for abuse-limiting a free-tier extraction endpoint.
const rateBuckets = new Map(); // email -> { windowStart, count }

function rateLimited(email, perMin) {
  const now = Date.now();
  const b = rateBuckets.get(email);
  if (!b || now - b.windowStart > 60_000) {
    rateBuckets.set(email, { windowStart: now, count: 1 });
    return false;
  }
  b.count++;
  return b.count > perMin;
}

/**
 * Real deps for production: fetch with size+timeout caps (no Buffer —
 * TextDecoder streaming), and Workers AI via env.AI.
 * @param {object} env
 * @returns {{fetchPage: function, runLLM: function}}
 */
function realDeps(env) {
  return {
    fetchPage: async (url) => {
      const ctrl = new AbortController();
      const timeoutMs = Number(env.EXTRACT_TIMEOUT_MS) || 15000;
      const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'CookbookExtractor/1.0 (+https://cookbook-2ie.pages.dev)' },
        });
        const max = Number(env.EXTRACT_MAX_BYTES) || 2_000_000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let received = 0;
        let html = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > max) { ctrl.abort(); break; }
          html += decoder.decode(value, { stream: true });
        }
        html += decoder.decode(); // flush
        return { ok: res.ok, status: res.status, html };
      } catch {
        return { ok: false, status: 502, html: '' };
      } finally {
        clearTimeout(timeout);
      }
    },
    runLLM: async (messages) => {
      const out = await env.AI.run(AI_MODEL, { messages });
      return typeof out === 'string' ? out : (out?.response || '');
    },
  };
}

/**
 * POST /api/extract  { url } -> { recipe } | { error }
 * Protected by _middleware.js (request.auth attached). Per-email rate limited.
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // The middleware already authorized and attached request.auth; if it is
  // somehow absent, refuse rather than proceeding anonymous.
  const email = request.auth && request.auth.email;
  if (typeof email !== 'string' || !email) {
    return json(401, { error: 'invalid_token' });
  }

  // Guard the AI binding (mirrors auth.js's misconfigured pattern).
  if (!env.AI || typeof env.AI.run !== 'function') {
    return json(500, { error: 'server_misconfigured', reason: 'ai_binding' });
  }

  const perMin = Number(env.EXTRACT_RATE_PER_MIN) || 10;
  if (rateLimited(email, perMin)) {
    return json(429, { error: 'rate_limited' });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }

  const { status, body: out } = await handleExtract(body, env, realDeps(env));
  return json(status, out);
}