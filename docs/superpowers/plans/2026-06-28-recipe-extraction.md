# Recipe Extraction from a URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user paste a recipe URL and get a schema.org/Recipe JSON-LD object, ready to review and save — using the page's embedded JSON-LD when present, and a Workers AI LLM fallback otherwise.

**Architecture:** Adds `POST /api/extract` to the existing Worker (built in the auth plan). The pipeline is factored into pure, dependency-injected functions (HTML parser, prompt builder, LLM-output parser, validator) tested under `node --test`; the live fetch + Workers AI call are injected so tests use fixtures. The frontend gains an "Import from URL" affordance that uses `authFetch` and feeds the result through the existing `parseImport`/`fromSchema` import path, opening the recipe drawer for review before save.

**Depends on:** the Google-auth plan (provides `authorize`, `authFetch`, signed-in state, and the `deps.verifySession` used by protected routes).

**Tech Stack:** Cloudflare Workers + Workers AI binding (`env.AI`), `jose` (already a worker dep), Node built-in test runner. Frontend: native ES modules reusing existing `lib/`.

## Global Constraints

- The frontend stays zero-dependency; new frontend code reuses `parseImport`/`fromSchema`, `authFetch`, `$`, `toast`, `esc`.
- Worker extraction logic that can be pure MUST be pure and dependency-injected (`fetchPage`, `runLLM`) so it tests under `node --test` without the Workers runtime.
- `POST /api/extract` is auth-gated (requires a valid session JWT via `authorize` from the auth plan).
- Only `https://` URLs. SSRF guard blocks `localhost`, `.localhost`, and IP literals in private/loopback/link-local ranges (v1 heuristic — note the DNS-rebinding limitation inline).
- Extracted recipes are never silently saved; the user reviews in the drawer and saves explicitly.
- Workers AI model: `@cf/meta/llama-3.1-8b-instruct` (no API key; free tier). Prompt demands JSON-only output.
- Size cap 2 MB; fetch timeout 15 s; per-token in-memory rate limit.
- Follow the existing file header comment style.

---

## File Structure

Worker:
- **Create** `worker/src/extract.js` — pure `findRecipeInHtml`, `toSimpleRecipe`, `hasRequiredFields`, `buildExtractionPrompt`, `parseLLMRecipe`, `isBlockedUrl`, and the orchestrated `extractRecipe(url, deps)` / `handleExtract(body, env, deps)`.
- **Create** `worker/test/extract.test.js` — tests for the pure helpers (fixture HTML + fixture LLM output).
- **Modify** `worker/src/index.js` — route `POST /api/extract` (authorize → handleExtract with real `fetchPage`/`runLLM`), add a per-token in-memory rate limiter.
- **Modify** `worker/wrangler.toml` — add the `[ai]` binding and extraction limits as vars.

Frontend:
- **Modify** `docs/index.html` — an "Import from URL" nav item + a small URL-import modal.
- **Modify** `docs/js/app.js` — open the URL modal, call `/api/extract` via `authFetch`, feed the result through `parseImport`, open the drawer pre-filled (refactor `openDrawer` to share recipe-filling).
- **Modify** `docs/css/styles.css` — minimal styles for the URL modal (optional; reuse existing modal classes).

---

### Task 1: Pure HTML/JSON-LD recipe finder (TDD)

**Files:**
- Create: `worker/src/extract.js`
- Create: `worker/test/extract.test.js`

**Interfaces:**
- Produces (this task): `findRecipeInHtml(html: string) => object | null` — collects every `<script type="application/ld+json">` block, parses each (tolerant of parse errors), unwraps `@graph` arrays, and returns the first object whose `@type` (string or array) includes `'Recipe'`, or `null`. Also `hasRequiredFields(obj) => boolean` (has a `name`, a non-empty array `recipeIngredient`, and a non-empty array/string `recipeInstructions`).

- [ ] **Step 1: Write the failing tests**

Create `worker/test/extract.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRecipeInHtml, hasRequiredFields } from '../src/extract.js';

const wrap = (json) => `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;

test('findRecipeInHtml finds a top-level Recipe', () => {
  const html = wrap(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Pie', recipeIngredient: ['1 crust'], recipeInstructions: ['Bake'] }));
  const r = findRecipeInHtml(html);
  assert.equal(r.name, 'Pie');
});

test('findRecipeInHtml unwraps @graph', () => {
  const html = wrap(JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList' },
    { '@type': 'Recipe', name: 'Soup', recipeIngredient: ['water'], recipeInstructions: ['Boil'] },
  ] }));
  const r = findRecipeInHtml(html);
  assert.equal(r.name, 'Soup');
});

test('findRecipeInHtml accepts @type as an array', () => {
  const html = wrap(JSON.stringify({ '@type': ['Article', 'Recipe'], name: 'X', recipeIngredient: ['a'], recipeInstructions: ['b'] }));
  assert.equal(findRecipeInHtml(html)?.name, 'X');
});

test('findRecipeInHtml returns null when no Recipe', () => {
  const html = wrap(JSON.stringify({ '@type': 'Article', name: 'Nope' }));
  assert.equal(findRecipeInHtml(html), null);
});

test('findRecipeInHtml tolerates a broken ld+json block and still parses others', () => {
  const html = `<html><head>
    <script type="application/ld+json">{ broken json</script>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Ok', recipeIngredient: ['a'], recipeInstructions: ['b'] })}</script>
  </head></html>`;
  assert.equal(findRecipeInHtml(html)?.name, 'Ok');
});

test('hasRequiredFields checks name + ingredients + instructions', () => {
  assert.equal(hasRequiredFields({ name: 'X', recipeIngredient: ['a'], recipeInstructions: ['b'] }), true);
  assert.equal(hasRequiredFields({ name: 'X', recipeIngredient: [], recipeInstructions: ['b'] }), false);
  assert.equal(hasRequiredFields({ name: '', recipeIngredient: ['a'], recipeInstructions: ['b'] }), false);
  assert.equal(hasRequiredFields({ recipeIngredient: ['a'], recipeInstructions: ['b'] }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/extract.js'`.

- [ ] **Step 3: Implement the finder**

Create `worker/src/extract.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/extract.js worker/test/extract.test.js
git commit -m "feat(extract): pure JSON-LD recipe finder + required-field check"
```

---

### Task 2: LLM prompt builder + output parser + simple-recipe coercion (TDD)

**Files:**
- Modify: `worker/src/extract.js` (add `buildExtractionPrompt`, `parseLLMRecipe`, `toSimpleRecipe`)
- Modify: `worker/test/extract.test.js`

**Interfaces:**
- Produces:
  - `toSimpleRecipe(obj) => object` — coerces a found/parsed Recipe into the flat shape the frontend's `parseImport` accepts: ensures `@type: 'Recipe'`, `recipeIngredient` is `string[]`, `recipeInstructions` is `string[]` (HowToStep objects flattened to `.text`), drops `@graph`/`@context` noise is fine to keep. Leaves nutrition/recipeCategory/etc. untouched if present.
  - `buildExtractionPrompt(visibleText: string) => object[]` — returns the `messages` array (system + user) instructing JSON-only schema.org/Recipe output.
  - `parseLLMRecipe(output: string) => object | null` — strips code fences, extracts the first JSON object, returns it if `hasRequiredFields`, else `null`.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/extract.test.js` (add `toSimpleRecipe`, `buildExtractionPrompt`, `parseLLMRecipe` to the import list):

```js
import { findRecipeInHtml, hasRequiredFields, toSimpleRecipe, buildExtractionPrompt, parseLLMRecipe } from '../src/extract.js';
```

```js
test('toSimpleRecipe flattens HowToStep instructions to text', () => {
  const r = toSimpleRecipe({ '@type': 'Recipe', name: 'X', recipeIngredient: ['a'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Step 1' }, { '@type': 'HowToStep', text: 'Step 2' }] });
  assert.deepEqual(r.recipeInstructions, ['Step 1', 'Step 2']);
  assert.equal(r['@type'], 'Recipe');
});

test('buildExtractionPrompt returns system + user messages', () => {
  const msgs = buildExtractionPrompt('mix and bake');
  assert.ok(Array.isArray(msgs));
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes('schema.org/Recipe'));
  assert.equal(msgs[1].role, 'user');
  assert.ok(msgs[1].content.includes('mix and bake'));
});

test('parseLLMRecipe extracts JSON from fenced output', () => {
  const out = 'Here you go:\n```json\n{"@type":"Recipe","name":"T","recipeIngredient":["a"],"recipeInstructions":["b"]}\n```\nThanks';
  const r = parseLLMRecipe(out);
  assert.equal(r?.name, 'T');
});

test('parseLLMRecipe extracts bare JSON', () => {
  const r = parseLLMRecipe('{"@type":"Recipe","name":"T","recipeIngredient":["a"],"recipeInstructions":["b"]}');
  assert.equal(r?.name, 'T');
});

test('parseLLMRecipe returns null for incomplete output', () => {
  assert.equal(parseLLMRecipe('{"@type":"Recipe","name":"T"}'), null);
  assert.equal(parseLLMRecipe('not json at all'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the prompt/parser/coercion**

Append to `worker/src/extract.js`:

```js
/**
 * Coerce a Recipe object into the flat shape parseImport accepts: instructions
 * become a string[] (HowToStep flattened to .text). Leaves optional fields.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/extract.js worker/test/extract.test.js
git commit -m "feat(extract): LLM prompt builder, output parser, simple-recipe coercion"
```

---

### Task 3: SSRF guard + orchestrated `extractRecipe` / `handleExtract` (TDD with injected fakes)

**Files:**
- Modify: `worker/src/extract.js` (add `isBlockedUrl`, `cleanText`, `extractRecipe`, `handleExtract`)
- Modify: `worker/test/extract.test.js`

**Interfaces:**
- Produces:
  - `isBlockedUrl(url: string) => boolean` — true if non-`https`, host is `localhost`/ends `.localhost`, or host is an IP literal in private/loopback/link-local ranges.
  - `cleanText(html: string) => string` — strips `<script>/<style>/<nav>/<header>/<footer>`, collapses whitespace, truncates to a cap (default 6000 chars).
  - `extractRecipe(url, deps) => Promise<{ ok: true, recipe } | { ok: false, status: number, error: string, partial?: object }>` — `deps = { fetchPage(url) => { ok, html, status }, runLLM(messages) => string }`. Tries JSON-LD first (returns `toSimpleRecipe(findRecipeInHtml(html))` when `hasRequiredFields`), else LLM fallback.
  - `handleExtract({ url }, env, deps) => { status, body }` — validates input, calls `extractRecipe`, maps to `{ status, body: { recipe } }` or `{ status, body: { error } }` (422 may include `partial`).

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/extract.test.js` (add `isBlockedUrl`, `cleanText`, `extractRecipe`, `handleExtract` to imports):

```js
import { findRecipeInHtml, hasRequiredFields, toSimpleRecipe, buildExtractionPrompt, parseLLMRecipe, isBlockedUrl, cleanText, extractRecipe, handleExtract } from '../src/extract.js';
```

```js
test('isBlockedUrl rejects non-https, localhost, and private IPs', () => {
  assert.equal(isBlockedUrl('http://example.com'), true);
  assert.equal(isBlockedUrl('https://localhost'), true);
  assert.equal(isBlockedUrl('https://app.localhost'), true);
  assert.equal(isBlockedUrl('https://10.0.0.1'), true);
  assert.equal(isBlockedUrl('https://127.0.0.1'), true);
  assert.equal(isBlockedUrl('https://192.168.1.1'), true);
  assert.equal(isBlockedUrl('https://169.254.1.1'), true);
  assert.equal(isBlockedUrl('https://example.com'), false);
  assert.equal(isBlockedUrl('https://8.8.8.8'), false);
});

test('cleanText strips scripts/nav and collapses whitespace', () => {
  const html = '<nav>menu</nav><p>Hello   world</p><script>alert(1)</script>';
  const t = cleanText(html);
  assert.ok(!t.includes('alert'));
  assert.ok(!t.includes('menu'));
  assert.ok(t.includes('Hello'));
  assert.ok(!t.includes('  ')); // no double spaces
});

test('extractRecipe uses embedded JSON-LD without calling the LLM', async () => {
  const html = '<script type="application/ld+json">{"@type":"Recipe","name":"Pie","recipeIngredient":["1 crust"],"recipeInstructions":["Bake"]}</script>';
  let llmCalled = false;
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html }),
    runLLM: async () => { llmCalled = true; return ''; },
  };
  const res = await extractRecipe('https://example.com/pie', deps);
  assert.equal(res.ok, true);
  assert.equal(res.recipe.name, 'Pie');
  assert.equal(llmCalled, false);
});

test('extractRecipe falls back to the LLM when no JSON-LD', async () => {
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html: '<p>boil water, add pasta</p>' }),
    runLLM: async (msgs) => JSON.stringify({ '@type': 'Recipe', name: 'Pasta', recipeIngredient: ['water', 'pasta'], recipeInstructions: ['Boil', 'Add pasta'] }),
  };
  const res = await extractRecipe('https://example.com/pasta', deps);
  assert.equal(res.ok, true);
  assert.equal(res.recipe.name, 'Pasta');
});

test('extractRecipe returns a 422-ish failure when both fail', async () => {
  const deps = {
    fetchPage: async () => ({ ok: true, status: 200, html: '<p>no recipe here</p>' }),
    runLLM: async () => 'sorry, no recipe',
  };
  const res = await extractRecipe('https://example.com/x', deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
});

test('extractRecipe surfaces a fetch failure', async () => {
  const deps = { fetchPage: async () => ({ ok: false, status: 502, html: '' }), runLLM: async () => '' };
  const res = await extractRecipe('https://example.com/x', deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 502);
});

test('handleExtract validates the URL first', async () => {
  const res = await handleExtract({ url: 'not-a-url' }, {}, {});
  assert.equal(res.status, 400);
});

test('handleExtract blocks SSRF URLs', async () => {
  const res = await handleExtract({ url: 'https://10.0.0.1' }, {}, { fetchPage: async () => ({ ok: true, status: 200, html: '' }), runLLM: async () => '' });
  assert.equal(res.status, 400);
});

test('handleExtract returns 200 with recipe on success', async () => {
  const deps = { fetchPage: async () => ({ ok: true, status: 200, html: '<script type="application/ld+json">{"@type":"Recipe","name":"T","recipeIngredient":["a"],"recipeInstructions":["b"]}</script>' }), runLLM: async () => '' };
  const res = await handleExtract({ url: 'https://example.com/t' }, {}, deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.recipe.name, 'T');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the orchestrator**

Append to `worker/src/extract.js`:

```js
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
 * Orchestrate extraction: JSON-LD first, LLM fallback. deps are injected so
 * tests use fixtures (no network, no Workers AI).
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test`
Expected: PASS — all extract tests green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/extract.js worker/test/extract.test.js
git commit -m "feat(extract): SSRF guard, text cleaning, orchestrated extractRecipe + handleExtract"
```

---

### Task 4: Wire `/api/extract` into the Worker with real deps + rate limiting

**Files:**
- Modify: `worker/src/index.js`
- Modify: `worker/wrangler.toml`

**Interfaces:**
- Produces: `POST /api/extract` route, authorized via `authorize`, calling `handleExtract` with real `fetchPage` (fetch + size/timeout caps) and `runLLM` (Workers AI via `env.AI`). A simple in-memory per-email rate limiter.

- [ ] **Step 1: Add the AI binding + limits to wrangler config**

In `worker/wrangler.toml`, append:

```toml
[ai]
binding = "AI"

# Extraction limits
[vars_extract]
MAX_BYTES = "2000000"
TIMEOUT_MS = "15000"
RATE_PER_MIN = "10"
```

> Wrangler flattens `[vars]` only; nested tables for limits are illustrative. Instead, add these as additional keys under the existing `[vars]` block:

```toml
[vars]
APP_ORIGIN = "http://localhost:8000"
GOOGLE_CLIENT_ID = "replace-me.apps.googleusercontent.com"
ALLOWED_EMAILS = "you@example.com"
SESSION_TTL = "604800"
EXTRACT_MAX_BYTES = "2000000"
EXTRACT_TIMEOUT_MS = "15000"
EXTRACT_RATE_PER_MIN = "10"
```

(Use the flattened `[vars]` form; remove the illustrative `[vars_extract]` block.)

- [ ] **Step 2: Wire the route with real deps + rate limiter**

In `worker/src/index.js`, add imports at the top:

```js
import { handleExtract } from './extract.js';
```

Add a tiny in-memory rate limiter and real deps above `export default` (or inside the handler scope as a module-level `Map`). Add after the `deps` definition:

```js
const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';
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

const realDeps = (env) => ({
  fetchPage: async (url) => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), Number(env.EXTRACT_TIMEOUT_MS) || 15000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'CookbookExtractor/1.0 (+https://schema.org/Recipe)' },
      });
      const max = Number(env.EXTRACT_MAX_BYTES) || 2_000_000;
      const reader = res.body.getReader();
      let received = 0; const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > max) { ctrl.abort(); break; }
        chunks.push(value);
      }
      const html = new TextDecoder().decode(Buffer.concat(chunks));
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
});
```

In the `fetch(request, env)` handler, add the extract route inside the `url.pathname.startsWith('/api/')` block, before the generic 404:

```js
    if (url.pathname === '/api/extract' && request.method === 'POST') {
      const auth = await authorize(request, env, deps);
      if (!auth.ok) return json(auth.status, auth.body, env);
      const perMin = Number(env.EXTRACT_RATE_PER_MIN) || 10;
      if (rateLimited(auth.claims.email, perMin)) {
        return json(429, { error: 'rate_limited' }, env);
      }
      let body;
      try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }, env); }
      const { status, body: out } = await handleExtract(body, env, realDeps(env));
      return json(status, out, env);
    }
```

> `Buffer` may be unavailable in the Workers runtime; if `wrangler dev` errors, replace `Buffer.concat(chunks)` with `new TextDecoder().decode(chunks.reduce((acc, c) => { const tmp = new Uint8Array(acc.length + c.length); tmp.set(acc); tmp.set(c, acc.length); return tmp; }, new Uint8Array(0)))`. Use whichever compiles.

- [ ] **Step 3: Verify the suite still passes**

Run: `cd worker && npm test`
Expected: PASS (the route is integration-tested manually next).

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.toml worker/src/index.js
git commit -m "feat(extract): wire /api/extract with Workers AI + fetch caps + rate limit"
```

---

### Task 5: Frontend "Import from URL" — refactor drawer filling + URL modal

**Files:**
- Modify: `docs/index.html` (nav item + modal)
- Modify: `docs/js/app.js` (refactor `openDrawer`, add URL import flow)
- Modify: `docs/css/styles.css` (reuse modal styles; small additions)

**Interfaces:**
- Consumes: `parseImport` from `docs/js/lib/schema.js`; `authFetch`, `getToken` from `docs/js/lib/auth.js`; `formBuffers`, `rebuildIngEditor`, `rebuildStepsList`, `FIELD_MAP`, `NUTRI_MAP` from `docs/js/components/recipeForm.js`; `state`, `save` from `docs/js/lib/store.js`.
- Produces: `openDrawerPrefilled(recipe)` (new) and the URL-import flow that opens it. `openDrawer(id)` is refactored to call a shared `fillDrawerFromRecipe(r)`.

- [ ] **Step 1: Refactor drawer filling in `app.js`**

In `docs/js/app.js`, replace the body of `openDrawer(id)` (lines ~143-164) with a shared filler:

```js
function fillDrawerFromRecipe(r) {
  state.editingId = (r && r._id) || null;
  $('drawer-title').textContent = state.editingId ? 'Edit Recipe' : 'New Recipe';
  $('f-id').value = state.editingId || '';
  Object.entries(FIELD_MAP).forEach(([elId, key]) => {
    $(elId).value = r ? r[key] || '' : '';
  });
  const n = (r && r.nutrition) || {};
  Object.entries(NUTRI_MAP).forEach(([elId, key]) => {
    $(elId).value = n[key] || '';
  });
  formBuffers.ingredients = r ? [...(r.recipeIngredient || [])] : [];
  formBuffers.steps = r ? [...(r.recipeInstructions || [''])] : [''];
  rebuildIngEditor();
  rebuildStepsList();
}

function openDrawer(id) {
  const r = id ? state.recipes.find((x) => x._id === id) : null;
  fillDrawerFromRecipe(r);
  openSheet('drawer');
  setTimeout(() => $('f-name').focus(), 80);
}

/** Open the drawer pre-filled with an unsaved recipe (no _id) for review. */
function openDrawerPrefilled(recipe) {
  fillDrawerFromRecipe(recipe);
  openSheet('drawer');
  setTimeout(() => $('f-name').focus(), 80);
}
```

- [ ] **Step 2: Add the nav item + modal markup**

In `docs/index.html`, in the `.sidebar-nav` Tools group (around lines 33-41), add a new nav item after the Import button:

```html
    <button class="nav-item" id="nav-import-url">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      <span class="nav-tab-label">From URL</span>
    </button>
```

Add the modal before the closing `</body>` (near the other modals, e.g. after the schema modal):

```html
<!-- ─────────────────────────────── URL import modal -->
<div class="schema-overlay" id="url-overlay">
  <div class="schema-modal" style="max-width:520px">
    <div class="schema-modal-header">
      <h4>Import from URL</h4>
      <button id="url-close-btn" aria-label="Close">
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div style="padding:1rem">
      <div id="url-signedout" style="display:none;color:var(--ink-light,#a8a29e);font-size:.9rem">
        Sign in to import from a URL. <button class="btn btn-ghost btn-sm" id="url-signin-hint-btn">Sign in</button>
      </div>
      <div id="url-signedin">
        <input type="url" id="url-input" placeholder="https://example.com/recipe" style="width:100%;margin-bottom:.75rem;padding:.5rem;border-radius:6px;border:1px solid var(--border,#3a3531);background:var(--surface,#26221e);color:inherit">
        <button class="btn btn-primary btn-sm" id="url-extract-btn">Extract</button>
        <span id="url-status" style="margin-left:.5rem;color:var(--ink-light,#a8a29e);font-size:.85rem"></span>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add the URL-import flow in `app.js`**

In `docs/js/app.js`, add imports near the top:

```js
import { parseImport } from './lib/schema.js';
import { authFetch, getToken } from './lib/auth.js';
```

> `parseImport` is already imported on line 7 (`import { toSchema, parseImport } from './lib/schema.js';`) — do not duplicate it; just ensure `parseImport` is in that import. Add only the `auth.js` import.

Add the URL-import functions (near the import/export section, after `importRecipes`):

```js
function openUrlModal() {
  const signedOut = !getToken();
  $('url-signedout').style.display = signedOut ? '' : 'none';
  $('url-signedin').style.display = signedOut ? 'none' : '';
  $('url-input').value = '';
  $('url-status').textContent = '';
  $('url-overlay').classList.add('open');
}

async function extractFromUrl() {
  const url = $('url-input').value.trim();
  if (!url) return;
  $('url-status').textContent = 'Extracting…';
  $('url-extract-btn').disabled = true;
  try {
    const res = await authFetch('/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('url-status').textContent = data.error || 'failed';
      if (data.partial) {
        const [recipe] = parseImport([data.partial]);
        if (recipe) {
          $('url-overlay').classList.remove('open');
          openDrawerPrefilled(recipe);
        }
      }
      return;
    }
    const [recipe] = parseImport([data.recipe]);
    if (!recipe) { $('url-status').textContent = 'no recipe found'; return; }
    $('url-overlay').classList.remove('open');
    openDrawerPrefilled(recipe);
    toast('Recipe extracted — review and save');
  } catch (e) {
    $('url-status').textContent = e.message || 'network';
  } finally {
    $('url-extract-btn').disabled = false;
  }
}
```

Wire the controls inside `wire()` (near the import-file wiring, after line ~430):

```js
  $('nav-import-url').addEventListener('click', openUrlModal);
  $('url-close-btn').addEventListener('click', () => $('url-overlay').classList.remove('open'));
  $('url-overlay').addEventListener('click', (e) => { if (e.target === $('url-overlay')) $('url-overlay').classList.remove('open'); });
  $('url-extract-btn').addEventListener('click', extractFromUrl);
  $('url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); extractFromUrl(); } });
  $('url-signin-hint-btn').addEventListener('click', openUrlModal); // reminder to sign in first
```

Also extend the Esc handler (around line ~433-438) to close the URL modal:

```js
    if ($('url-overlay').classList.contains('open')) $('url-overlay').classList.remove('open');
    else if ($('schema-overlay').classList.contains('open')) $('schema-overlay').classList.remove('open');
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS (frontend not unit-tested; manual verification next).

- [ ] **Step 5: Manual smoke test**

1. With the Worker running (`cd worker && wrangler dev`) and the frontend dev API base set (`window.COOKBOOK_API = 'http://localhost:8787/api'`), sign in (auth plan).
2. Click "From URL". Paste a known JSON-LD recipe URL (e.g. a schema.org-enabled recipe page). Click Extract → the drawer opens pre-filled; edit if needed and Save → recipe appears in the library.
3. Paste a messy blog URL → the LLM fallback runs; a reviewable recipe opens (or a clear error + partial if it fails).
4. Sign out → "From URL" shows "Sign in to import from a URL."
5. Confirm recipes/pantry/cart still work signed-out.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/js/app.js docs/css/styles.css
git commit -m "feat(extract): frontend Import-from-URL modal, drawer prefill, authFetch"
```

---

## Self-review (run against PRD 2)

- **Structured-data first, LLM fallback (§7.2, §7.4):** `extractRecipe` tries `findRecipeInHtml` then LLM (Task 3), repair pass on bad LLM output (Task 3). ✓
- **Reuse existing import path (§7.5, §8):** frontend feeds `data.recipe` through `parseImport` → `openDrawerPrefilled` (Task 5); no silent save (review then Save). ✓
- **Auth-gated (§6.1, §9):** `/api/extract` calls `authorize` before running (Task 4). ✓
- **SSRF guard (§7.1, §9):** `isBlockedUrl` blocks private/loopback/localhost/non-https (Task 3, tested). DNS-rebinding limitation noted inline. ✓
- **Size + timeout caps (§7.1):** `fetchPage` caps bytes and aborts on timeout (Task 4). ✓
- **Rate limit per token (§6.2):** `rateLimited` in-memory per email (Task 4). ✓
- **Workers AI, no key (§7.4):** `env.AI.run(AI_MODEL, …)` (Task 4); model chosen; no secret. ✓
- **JSON-only prompt + escape (§7.4, §9):** `buildExtractionPrompt` demands JSON-only; rendered text uses `esc` (existing). ✓
- **Errors (§6.1):** 400/401/403/422/429/502 mapped (Tasks 3-4); partial opened in drawer on 422 (Task 5). ✓
- **Pure helpers unit-tested (§10):** `findRecipeInHtml`, `hasRequiredFields`, `toSimpleRecipe`, `buildExtractionPrompt`, `parseLLMRecipe`, `isBlockedUrl`, `cleanText`, `extractRecipe`, `handleExtract` all tested with fixtures (Tasks 1-3). ✓
- **Rest of app works signed-out/offline (§13):** no offline feature depends on extraction. ✓

No placeholders; all referenced symbols exist (`authorize`, `json`, `deps` from the auth plan; `parseImport`, `formBuffers`, `FIELD_MAP`, `NUTRI_MAP`, `rebuildIngEditor`, `rebuildStepsList`, `openSheet` from the existing codebase; `authFetch`, `getToken` from the auth plan). The two Workers-runtime caveats (`Buffer` availability) are flagged inline with concrete fallbacks.