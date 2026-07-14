// POST /api/normalize — authenticated Workers AI ingredient interpretation.
import { json } from '../_lib/http.js';
import { handleNormalize } from '../_lib/normalize.js';
import { durableRateLimited } from '../_lib/rate-limit.js';

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export async function onRequestPost({ request, env, data }) {
  if (typeof data?.auth?.email !== 'string' || !data.auth.email) return json(401, { error: 'invalid_token' });
  if (!env.AI || typeof env.AI.run !== 'function') return json(503, { error: 'normalization_unavailable' });
  try {
    if (await durableRateLimited(env.DB, `normalize:${data.auth.email}`, Number(env.NORMALIZE_RATE_PER_MIN) || 10)) {
      return json(429, { error: 'rate_limited' });
    }
  } catch {
    return json(503, { error: 'rate_limit_unavailable' });
  }
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  const result = await handleNormalize(body, {
    runLLM: async (messages) => {
      const output = await env.AI.run(AI_MODEL, { messages, max_tokens: 8192, temperature: 0 });
      return typeof output === 'string' ? output : output?.response || '';
    },
  });
  return json(result.status, result.body);
}
