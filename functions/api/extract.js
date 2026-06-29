// ════════════════════════════════════════════════════════
// extract.js — POST /api/extract: URL → schema.org/Recipe
// Auth-gated by functions/api/_middleware.js (request.auth = { sub, email }).
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../_lib/http.js';
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
    // Opportunistic GC: when a fresh bucket is created for a caller, sweep the
    // map and drop any entry whose 60s window has elapsed. Keeps the map
    // bounded over time without iterating on every call.
    if (rateBuckets.size > 0) {
      for (const [k, v] of rateBuckets) {
        if (now - v.windowStart > 60_000) rateBuckets.delete(k);
      }
    }
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
        // Accumulate decoded chunks in an array and join once at the end —
        // string concatenation in the read loop is O(n^2) for ~2MB pages.
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > max) { ctrl.abort(); break; }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode()); // flush any trailing bytes
        const html = chunks.join('');
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

  // Guard the AI binding (shared misconfigured() helper from http.js).
  if (!env.AI || typeof env.AI.run !== 'function') {
    return misconfigured('ai_binding');
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