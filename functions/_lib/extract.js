// ════════════════════════════════════════════════════════
// extract.js — recipe extraction pipeline (pure, deps injected)
// ════════════════════════════════════════════════════════

const LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function isRecipeType(t) {
  if (!t) return false;
  if (Array.isArray(t)) return t.includes('Recipe');
  return t === 'Recipe';
}

/**
 * Find the first schema.org/Recipe object in a page's ld+json blocks.
 * Tolerant of broken blocks; unwraps @graph. Returns the raw object or null.
 * @param {string} html
 * @returns {object|null}
 */
export function findRecipeInHtml(html) {
  if (typeof html !== 'string') return null;
  const blocks = html.match(LD_BLOCK) || [];
  for (const block of blocks) {
    const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    let data;
    try { data = JSON.parse(inner); } catch { continue; }
    const candidates = Array.isArray(data) ? data : [data];
    for (const cand of candidates) {
      if (!cand) continue;
      if (isRecipeType(cand['@type']) && cand.name) return cand;
      const graph = cand['@graph'];
      if (Array.isArray(graph)) {
        const hit = graph.find((g) => g && isRecipeType(g['@type']) && g.name);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * True if obj looks like a usable recipe (name + non-empty ingredients + instructions).
 * @param {object} obj
 * @returns {boolean}
 */
export function hasRequiredFields(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!obj.name || typeof obj.name !== 'string') return false;
  if (!Array.isArray(obj.recipeIngredient) || !obj.recipeIngredient.length) return false;
  const instr = obj.recipeInstructions;
  const okInstr = Array.isArray(instr) ? instr.length > 0 : typeof instr === 'string' && instr.length > 0;
  return okInstr;
}

/**
 * Coerce a Recipe object into the flat shape parseImport/fromSchema accepts:
 * instructions become a string[] (HowToStep flattened to .text). Leaves optional fields.
 * @param {object} obj
 * @returns {object}
 */
export function toSimpleRecipe(obj) {
  const out = { ...obj, '@type': 'Recipe' };
  out.recipeIngredient = Array.isArray(obj.recipeIngredient)
    ? obj.recipeIngredient.map(String)
    : [];
  const instr = obj.recipeInstructions;
  if (Array.isArray(instr)) {
    out.recipeInstructions = instr.map((s) => (typeof s === 'string' ? s : (s?.text || '')));
  } else if (typeof instr === 'string') {
    out.recipeInstructions = [instr];
  } else {
    out.recipeInstructions = [];
  }
  return out;
}

/**
 * Build the Workers AI messages array asking for JSON-only schema.org/Recipe.
 * @param {string} visibleText
 * @returns {{role:string, content:string}[]}
 */
export function buildExtractionPrompt(visibleText) {
  const system =
    'You extract recipes from web page text. Return ONLY a single JSON object ' +
    'conforming to https://schema.org/Recipe with these fields when available: ' +
    'name, recipeCategory, recipeCuisine, recipeYield, cookingMethod, suitableForDiet, ' +
    'prepTime, cookTime, totalTime (ISO 8601 durations like PT10M), recipeIngredient (string[]), ' +
    'recipeInstructions (string[] of step text), nutrition (object), image (URL), url. ' +
    'Do not include any prose, markdown, or commentary — only the JSON object. ' +
    'recipeIngredient and recipeInstructions must be non-empty arrays.';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Extract the recipe from this page text:\n\n${visibleText}` },
  ];
}

/**
 * Parse the LLM's raw text output into a Recipe object, or null if it is not
 * valid/complete. Strips ```json fences and extracts the first JSON object.
 * @param {string} output
 * @returns {object|null}
 */
export function parseLLMRecipe(output) {
  if (typeof output !== 'string') return null;
  let text = output.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let obj;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  return hasRequiredFields(obj) ? toSimpleRecipe(obj) : null;
}

const TEXT_CAP = 6000;
const PRIVATE_IPV4 = /^(10\.|192\.168\.|169\.254\.|127\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6 = /^(::1|fc|fd|fe80:)/i;

/**
 * Heuristic SSRF guard. Blocks non-https, localhost, .localhost, and IP
 * literals in private/loopback/link-local ranges. NOTE: this does not resolve
 * DNS, so it cannot prevent DNS-rebinding to a private IP — a v1 limitation;
 * for hardening, add a DNS-resolution check (Workers does not expose this
 * directly; consider a proxy/DNS-over-HTTPS lookup) before shipping publicly.
 * @param {string} url
 * @returns {boolean}
 */
export function isBlockedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return true; }
  if (u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (PRIVATE_IPV4.test(host)) return true;
  if (host.includes(':') && PRIVATE_IPV6.test(host)) return true;
  return false;
}

/**
 * Strip non-content tags and collapse whitespace, capped to TEXT_CAP chars.
 * @param {string} html
 * @returns {string}
 */
export function cleanText(html) {
  if (typeof html !== 'string') return '';
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > TEXT_CAP) t = t.slice(0, TEXT_CAP);
  return t;
}

/**
 * Orchestrate extraction: JSON-LD first, LLM fallback (with a repair pass).
 * deps are injected so tests use fixtures (no network, no Workers AI).
 * @param {string} url
 * @param {object} deps { fetchPage, runLLM }
 * @returns {Promise<object>}
 */
export async function extractRecipe(url, deps) {
  if (isBlockedUrl(url)) return { ok: false, status: 400, error: 'blocked_url' };
  let page;
  try { page = await deps.fetchPage(url); }
  catch { return { ok: false, status: 502, error: 'fetch_failed' }; }
  if (!page || !page.ok) return { ok: false, status: page?.status || 502, error: 'fetch_failed' };

  const found = findRecipeInHtml(page.html || '');
  if (found && hasRequiredFields(found)) {
    return { ok: true, recipe: toSimpleRecipe(found) };
  }

  const text = cleanText(page.html || '');
  if (!text) return { ok: false, status: 422, error: 'no_recipe' };

  let output;
  try { output = await deps.runLLM(buildExtractionPrompt(text)); }
  catch { return { ok: false, status: 502, error: 'llm_failed' }; }

  const parsed = parseLLMRecipe(output);
  if (parsed) return { ok: true, recipe: parsed };

  // repair pass: ask the model to return strictly valid JSON
  let repaired;
  try { repaired = await deps.runLLM([{ role: 'user', content: 'Return ONLY a valid schema.org/Recipe JSON object. No prose, no fences.' }]); }
  catch { /* fall through */ }
  const retry = parseLLMRecipe(repaired || '');
  if (retry) return { ok: true, recipe: retry };

  return { ok: false, status: 422, error: 'no_recipe' };
}

/**
 * Handle POST /api/extract. Validates input, runs the pipeline, maps to a
 * { status, body } envelope. body is { recipe } on 200, { error } otherwise.
 * @param {{url?:string}} body
 * @param {object} env (unused here; reserved for limits)
 * @param {object} deps { fetchPage, runLLM }
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleExtract(body, env, deps) {
  const url = body && typeof body === 'object' ? body.url : undefined;
  if (typeof url !== 'string' || !url.trim()) return { status: 400, body: { error: 'missing_url' } };
  const res = await extractRecipe(url, deps);
  if (res.ok) return { status: 200, body: { recipe: res.recipe } };
  return { status: res.status, body: { error: res.error, partial: res.partial || undefined } };
}