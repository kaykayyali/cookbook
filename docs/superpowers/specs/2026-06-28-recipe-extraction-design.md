# PRD 2 — Recipe extraction from a URL

**Status:** Proposed (awaiting implementation plan)
**Depends on:** PRD 3 (Google auth) — the `/api/extract` endpoint is auth-gated; auth must be in
place (or stubbed behind a dev bypass) before extraction ships.
**Scope:** a single feature with a server component.

## 1. Problem

Today a user can only add recipes by hand or by importing a JSON-LD file. Most recipes live on
web pages. Asking the user to manually copy ingredients, steps, timings, and nutrition is tedious
and error-prone — and many sites already publish this data as structured schema.org/Recipe, which
is exactly the format Cookbook uses.

## 2. Goal

Let a signed-in user paste a recipe URL and have the app produce a schema.org/Recipe JSON-LD
object ready to review and save — using structured data when the page provides it, and an LLM as
a fallback for unstructured pages.

## 3. User stories

- As a cook, I find a recipe online, paste its URL, and get it in my library without typing.
- As a user on a well-structured site (JSON-LD present), my extraction is instant and accurate,
  with no AI involved.
- As a user on a messy blog page, the LLM still produces a usable recipe I can review and fix
  before saving.

## 4. Out of scope (YAGNI)

- No bulk import, no browser bookmarklet, no bookmarklet/extension.
- No image fetching/storage (recipe image URL may be preserved as `image` if present, but the
  app does not download or host images).
- No scheduled re-extraction or change detection.
- No support for sites behind paywalls/logins.
- v1 supports only `https://` URLs.

## 5. Architecture

A **Cloudflare Worker** hosts the extraction API. The static frontend (recommended to move to
Cloudflare Pages so frontend + API share one origin — see §11) calls it.

```
Browser (signed in, Bearer token)
   │  POST /api/extract { url }
   ▼
Cloudflare Worker
   ├── verify session JWT   (PRD 3)
   ├── fetch(url)            (server-side; bypasses browser CORS)
   ├── [1] parse JSON-LD <script> blocks → schema.org/Recipe?  → normalize → return
   ├── [2] (optional) parse microdata / h-recipe                 → return
   └── [3] LLM fallback (Workers AI) → prompt → validate → return
```

The extracted JSON-LD re-enters the app through the **existing import path**
(`parseImport` / `fromSchema`), then opens the recipe form drawer for review/edit before save — the
user never blindly imports.

## 6. API

### 6.1 `POST /api/extract`
- **Request:** `{ "url": "https://…" }`, with `Authorization: Bearer <session JWT>` (PRD 3).
- **Response (success):** `{ "recipe": <schema.org/Recipe JSON-LD> }`.
- **Response (error):** `{ "error": "<code>", "message": "<human text>" }` with an HTTP status.
  - `400` invalid URL / unsupported scheme.
  - `401` missing/invalid token.
  - `403` email not on whitelist (PRD 3).
  - `422` page fetched but no recipe could be extracted (LLM fallback also failed/partial).
  - `429` rate limited.
  - `502` upstream fetch failed / timed out.

### 6.2 Rate limiting
- Per-token in-memory rate limit (e.g. N extractions per minute) to protect the Workers AI budget.
  A KV-backed limit can replace in-memory if the Worker scales; v1 uses in-memory.

## 7. Extraction pipeline

### 7.1 Validate & fetch
- Reject non-`https` and obviously invalid URLs.
- **SSRF guard:** resolve the host and block private/loopback/link-local ranges (10/8, 172.16/12,
  192.168/16, 127/8, 169.254/16, ::1, fc00::/7). Reject if resolution fails or lands on a blocked
  range.
- Fetch with a **size cap** (e.g. 2 MB) and **timeout** (e.g. 15 s), following redirects up to a
  small limit. Use a descriptive `User-Agent`.

### 7.2 Structured-data first (no LLM)
- Parse the HTML; collect every `<script type="application/ld+json">` block.
- Handle `@graph` arrays and `@type` values that are string or array; find an object whose `@type`
  includes `"Recipe"`.
- If a candidate has at least `name` + a non-empty `recipeIngredient` + `recipeInstructions`,
  normalize it through the **existing `fromSchema`** and return it. No LLM call.

### 7.3 Optional lightweight structured fallback
- If no JSON-LD Recipe, look for microdata (`itemprop="recipeIngredient"` etc.) or `h-recipe`
  classes. If found and complete enough, normalize and return.
- This tier is best-effort; if it yields nothing usable, proceed to the LLM.

### 7.4 LLM fallback (Workers AI)
- Strip `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, and boilerplate; send the remaining
  visible text, **capped** to the model's context budget (e.g. truncate to ~6–8k tokens).
- Model: a **Workers AI** text model (e.g. `@cf/meta/llama-3.1-8b-instruct`) — no API key, runs
  in-process on Cloudflare, free tier.
- System prompt instructs the model to return **only** a JSON object conforming to
  schema.org/Recipe with the fields Cookbook uses (name, recipeCategory, recipeCuisine,
  recipeYield, cookingMethod, suitableForDiet, prepTime, cookTime, totalTime, recipeIngredient[],
  recipeInstructions[], nutrition, image, url). Use the model's JSON/grammar mode if available;
  otherwise parse the fenced JSON and repair.
- Validate required fields: `name`, non-empty `recipeIngredient[]`, non-empty
  `recipeInstructions[]`. Map instructions to text strings (the app wraps HowToSteps on export).
- **Repair pass:** if the JSON is invalid or required fields are missing, retry once with a
  corrective prompt. If still bad, return `422` with whatever partial fields could be recovered
  attached, so the user can finish it in the form drawer.

### 7.5 Normalization
- All successful paths produce a schema.org/Recipe-shaped object that is fed to `fromSchema`,
  producing the internal model — identical to the JSON-LD file import path. This guarantees
  extracted recipes behave exactly like manually entered ones.

## 8. Frontend integration

- A new **"Import from URL"** affordance (alongside the existing JSON file Import).
  - When signed out: shows "Sign in to import from a URL" (links to the sign-in flow, PRD 3).
  - When signed in: a URL input + "Extract" button.
- On success: the extracted recipe is passed through `parseImport`, added to the form buffers,
  and the recipe **drawer opens in edit-not-yet-saved mode** for review. The user saves
  explicitly (no silent insert).
- On error: toast with the human message; `422` partial still opens the drawer pre-filled so the
  user can complete it.

## 9. Security & safety

- Auth-gated (PRD 3): every `/api/extract` call requires a valid session JWT.
- SSRF protection (§7.1), size + timeout caps.
- The Worker never follows `javascript:` or `data:` URLs.
- No HTML is stored server-side; the page content is processed in-memory for the request and
  discarded.
- The LLM prompt must instruct the model to return **only** the JSON object (no surrounding
  prose) to minimize injection of arbitrary content into the saved recipe; the app escapes all
  rendered text via the existing `esc()`.

## 10. Testing

- **Pure helpers** (JSON-LD `@graph` walking, Recipe detection, `fromSchema` normalization, prompt
  construction, quantity validation) unit-tested with HTML/JSON fixtures, runnable under Node.
  Where feasible, factor these into a module that does not require the Workers runtime.
- **Integration:** the live fetch + Workers AI path tested with a small set of fixture URLs (one
  JSON-LD site, one microdata site, one unstructured site) as a manual/CI smoke test. Live Workers
  AI calls may be gated behind an env flag in CI to avoid non-determinism.
- **SSRF guard** unit-tested: blocked-IP rejection, public-IP acceptance.

## 11. Deployment shape (open decision, recommended below)

- **Recommended:** move the frontend to **Cloudflare Pages** and serve the Worker (or Pages
  Functions) from the same origin. Frontend and `/api/*` share an origin → no CORS, simpler token
  handling, one platform.
- **Alternative:** keep the frontend on GitHub Pages and run the Worker as a separate origin,
  enabling CORS for the Pages origin and validating the token on every request. More moving
  parts, but preserves the current GitHub Pages deploy.
- This PRD assumes the recommended shape; if the alternative is chosen, add CORS allow-listing to
  §9.

## 12. Acceptance criteria

1. A signed-in user can paste a URL, and a recipe is extracted and opened in the form drawer for
   review — for a JSON-LD site without any LLM call.
2. For an unstructured page, the Workers AI fallback produces a reviewable recipe; if it can't,
   the user gets a clear error and, where possible, a pre-filled partial.
3. Unsigned users cannot call `/api/extract` (401/403).
4. SSRF: requests to private/loopback IPs are rejected.
5. Per-token rate limiting prevents runaway LLM spend.
6. Extracted recipes are indistinguishable from manually entered ones (same `fromSchema` path).
7. The rest of the app works offline and signed-out exactly as today.