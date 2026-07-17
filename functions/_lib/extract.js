// ════════════════════════════════════════════════════════
// extract.js — recipe extraction pipeline (pure, deps injected)
// ════════════════════════════════════════════════════════

import { boundedJsonValue } from './bounded-json.js';

// Matches <script type=application/ld+json>, <script type="application/ld+json">,
// and <script type='application/ld+json'> — unquoted attributes are valid HTML5.
const LD_BLOCK = /<script[^>]*type\s*=\s*(?:["'])?application\/ld\+json(?:["'])?[^>]*>([\s\S]*?)<\/script>/gi;

function tryParseJSON(raw) {
  try { return JSON.parse(raw); } catch {
    // Common JSON-LD malformation: an extra trailing } from templating.
    // Try trimming one trailing brace before giving up.
    const trimmed = raw.trimEnd();
    if (trimmed.endsWith('}')) {
      try { return JSON.parse(trimmed.slice(0, -1).trimEnd()); } catch { /* fall through */ }
    }
    return null;
  }
}

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
    const data = tryParseJSON(inner);
    if (!data) continue;
    const candidates = Array.isArray(data) ? data : [data];
    for (const cand of candidates) {
      if (!cand) continue;
      if (isRecipeType(cand['@type']) && cand.name) return cand;
      const graph = cand['@graph'];
      if (Array.isArray(graph)) {
        // Flatten: graph items may themselves be arrays (e.g. [{...}])
        const flat = graph.flat(1);
        const hit = flat.find((g) => g && isRecipeType(g['@type']) && g.name);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** Flatten schema.org instruction strings, HowToSteps, and nested HowToSections. */
function instructionTexts(value) {
  const texts = [];
  const visit = (item) => {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) texts.push(text);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== 'object') return;
    if (typeof item.text === 'string' && item.text.trim()) {
      texts.push(item.text.trim());
      return;
    }
    if (item.itemListElement) visit(item.itemListElement);
  };
  visit(value);
  return texts;
}

function textFromHtml(fragment) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(fragment || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : ' ';
      }
      return entities[entity.toLowerCase()] || ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract common article recipes that use an ingredient table/list and
 * numbered Step headings but provide no valid schema.org Recipe JSON-LD.
 */
export function findRecipeInArticleHtml(html, url = '') {
  if (typeof html !== 'string') return null;
  const nameMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = textFromHtml(nameMatch?.[1]);
  if (!name) return null;

  const ingredientHeading = /<h([1-6])[^>]*>[\s\S]*?ingredients[\s\S]*?<\/h\1>/i.exec(html);
  if (!ingredientHeading) return null;
  const ingredientStart = ingredientHeading.index + ingredientHeading[0].length;
  const afterIngredientHeading = html.slice(ingredientStart);
  const nextHeading = afterIngredientHeading.search(/<h[1-6][^>]*>/i);
  const ingredientBlock = nextHeading >= 0
    ? afterIngredientHeading.slice(0, nextHeading)
    : afterIngredientHeading;

  const ingredients = [];
  for (const row of ingredientBlock.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => textFromHtml(cell[1]));
    if (cells.length >= 2 && !/^ingredient$/i.test(cells[0])) {
      ingredients.push(`${cells[1]} ${cells[0]}`.trim());
    }
  }
  if (!ingredients.length) {
    for (const item of ingredientBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = textFromHtml(item[1]);
      if (text) ingredients.push(text);
    }
  }

  const instructions = [];
  const stepHeading = /<h([2-6])[^>]*>\s*Step\s*\d+\s*:?\s*([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[2-6][^>]*>|$)/gi;
  for (const step of html.matchAll(stepHeading)) {
    const title = textFromHtml(step[2]);
    const body = textFromHtml(step[3]);
    const text = title && body ? `${title}: ${body}` : title || body;
    if (text) instructions.push(text);
  }

  const recipe = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name,
    url,
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
  };
  return hasRequiredFields(recipe) ? recipe : null;
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
  return instructionTexts(obj.recipeInstructions).length > 0;
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
  out.recipeInstructions = instructionTexts(obj.recipeInstructions);
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
const EVIDENCE_CAP = 16_384;
export const URL_EXTRACTOR_VERSION = 'url-extractor-v1';
const PRIVATE_IPV4 = /^(10\.|192\.168\.|169\.254\.|127\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6 = /^(::1|fc|fd|fe80:)/i;

/**
 * Decode an IPv4-mapped IPv6 literal to its dotted-quad form, or null.
 * The URL parser normalizes `::ffff:127.0.0.1` to the hex form
 * `::ffff:7f00:1`, so we detect the `:ffff:` marker and convert the last
 * two 16-bit hex groups back into the IPv4 dotted-quad.
 * @param {string} host (brackets already stripped)
 * @returns {string|null}
 */
function ipv4FromMappedV6(host) {
  if (!/:ffff:/i.test(host)) return null;
  const parts = host.split(':');
  const last2 = parts.slice(-2);
  if (last2.length !== 2) return null;
  const g1 = parseInt(last2[0], 16);
  const g2 = parseInt(last2[1], 16);
  if (Number.isNaN(g1) || Number.isNaN(g2)) return null;
  return `${(g1 >> 8) & 0xff}.${g1 & 0xff}.${(g2 >> 8) & 0xff}.${g2 & 0xff}`;
}

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
  // u.hostname wraps IPv6 literals in brackets ([::1]); strip them so the
  // prefix regexes and :ffff: detection work on the bare address.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (PRIVATE_IPV4.test(host)) return true;
  if (host.includes(':')) {
    // IPv6 literal. Catch the well-known private IPv6 prefixes (::1, fc/fd
    // ULAs, fe80: link-local), then guard against IPv4-mapped IPv6 bypass
    // (e.g. ::ffff:127.0.0.1, normalized to ::ffff:7f00:1): decode the
    // embedded IPv4 and test it against the IPv4 private ranges so the
    // guard's contract — block private IP literals in any form — holds.
    if (PRIVATE_IPV6.test(host)) return true;
    const mapped = ipv4FromMappedV6(host);
    if (mapped && PRIVATE_IPV4.test(mapped)) return true;
  }
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

function boundedExtractionEvidence(value) {
  return boundedJsonValue(value || {}, EVIDENCE_CAP);
}

function partialExtractionFailure(status, error, partial, jsonLd) {
  if (!partial) return { ok: false, status, error };
  return {
    ok: false,
    status,
    error,
    partial,
    extractorMethod: 'json-ld-partial',
    extractorVersion: URL_EXTRACTOR_VERSION,
    evidence: boundedExtractionEvidence({ jsonLd }),
  };
}

function extracted(recipe, extractorMethod, evidence) {
  return {
    ok: true,
    recipe,
    extractorMethod,
    extractorVersion: URL_EXTRACTOR_VERSION,
    evidence: boundedExtractionEvidence(evidence),
  };
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
    const recipe = toSimpleRecipe(found);
    return extracted(recipe, 'json-ld', { recipe });
  }

  // Prefer a deterministic article parser before Workers AI. Besides being
  // faster, this avoids platform AI failures for pages that already expose
  // clear ingredient tables and numbered step headings in their HTML.
  const articleRecipe = findRecipeInArticleHtml(page.html || '', url);
  if (articleRecipe) return extracted(articleRecipe, 'article-html', { recipe: articleRecipe });

  // Partial recovery: if JSON-LD had a name but was missing required fields
  // (e.g. had ingredients but no instructions), capture it as a partial so
  // the frontend can pre-fill the drawer for manual completion instead of
  // dropping the incomplete recipe entirely.
  const partial = found && found.name ? toSimpleRecipe(found) : undefined;

  const text = cleanText(page.html || '');
  if (!text) return partialExtractionFailure(422, 'no_recipe', partial, found);

  let output;
  try { output = await deps.runLLM(buildExtractionPrompt(text)); }
  catch { return partialExtractionFailure(502, 'llm_failed', partial, found); }

  const parsed = parseLLMRecipe(output);
  if (parsed) return extracted(parsed, 'workers-ai', { visibleText: text, modelOutput: output, recipe: parsed });

  // Repair pass: re-send the FAILED first output so the model fixes its own
  // (real) JSON rather than fabricating an unrelated recipe from nothing.
  // `output` is the first LLM attempt already in scope here.
  let repaired;
  try { repaired = await deps.runLLM([{ role: 'user', content: 'This is a schema.org/Recipe with JSON formatting errors. Return ONLY the corrected single JSON object — no prose, no code fences:\n\n' + output }]); }
  catch { /* fall through */ }
  const retry = parseLLMRecipe(repaired || '');
  if (retry) return extracted(retry, 'workers-ai-repair', {
    visibleText: text, modelOutput: output, repairedOutput: repaired, recipe: retry,
  });

  return partialExtractionFailure(422, 'no_recipe', partial, found);
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
  if (res.ok) return { status: 200, body: {
    recipe: res.recipe,
    extractorMethod: res.extractorMethod,
    extractorVersion: res.extractorVersion,
    evidence: res.evidence,
  } };
  return { status: res.status, body: {
    error: res.error,
    partial: res.partial || undefined,
    extractorMethod: res.extractorMethod,
    extractorVersion: res.extractorVersion,
    evidence: res.evidence,
  } };
}
