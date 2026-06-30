# PRD 4 — Shared Recipes (Community)

**Status:** Design (approved 2026-06-30, pending written-spec review)
**Type:** Feature PRD. Builds on PRD 0 (existing app), PRD 3 (Google auth), PRD 2 (recipe extraction).

## 1. Purpose

Let all signed-in users see each other's recipes, with each recipe marked by who added it. Today the
cookbook is local-first (recipes in `localStorage`, private to one device) and auth only gates the
recipe-extraction endpoint. This PRD adds a **shared Community feed** backed by Cloudflare D1, so the
small private group of allowlisted users can browse, share, and copy one another's recipes — while
the existing local-first library stays untouched and fully offline-capable.

## 2. Goals

- A **Community** view listing every signed-in user's shared recipes, each card marked "added by
  {author name}" with an avatar.
- Signed-in users can **share** a recipe from their local library to the Community feed.
- Any signed-in user can **browse** and open any community recipe (read-only detail).
- Any signed-in user can **save** a community recipe into their own local library (copy to
  `localStorage`) so it's available offline.
- The **author** of a shared recipe can **edit** or **delete** it; no one else can.
- The local-first guarantee is preserved: the app keeps working offline for local recipes, pantry,
  search, and import/export; the Community view degrades gracefully when the server is unreachable.

## 3. Non-goals

- **No opening sign-up.** The allowlist (PRD 3) remains the gate; "all signed-in users" = the
  allowlisted members. Adding members is still a manual `ALLOWED_EMAILS` / dashboard change.
- **No sync of the local library.** Local recipes are not auto-pushed to the server. Sharing is an
  explicit action; the local library is never made server-dependent.
- **No user-chosen display names or profile editing.** The author label is auto-captured from the
  Google account (name + avatar) at sign-in, snapshotted onto each recipe.
- **No collaboration on a single canonical recipe, no comments, no ratings, no forks graph.**
  Members edit only their own recipes.
- **No change to extraction.** `/api/extract` still prefills the form drawer (local). Sharing is a
  separate, explicit step taken afterward.

## 4. Audience & scale

Small private invite-only group (the current `ALLOWED_EMAILS` members, grown by hand). Tens of users
at most; hundreds-to-low-thousands of recipes total. Scale stays well within Cloudflare D1 free
tier. No internet-scale abuse defenses are in scope — the allowlist is the trust boundary.

## 5. Architecture

Two recipe collections, cleanly separated:

```
Local library (unchanged):  localStorage.cb_recipes  — private, offline, source of truth for the user
Community (new):            D1 community_recipes     — shared feed, author-marked, server-backed

Sign-in (extended):  GIS scopes "email profile" -> verifyIdToken returns {sub,email,email_verified,name,picture}
                     -> session JWT {sub,email,name,picture}
                     -> _middleware attaches context.data.auth = {sub,email,name,picture}
                     (Author identity rides in the token; no separate users table.)

Share:    local recipe --toSchema()--> POST /api/community
          server stamps author_{sub,name,picture} from context.data.auth + a server UUID
          -> INSERT into D1

Browse:   GET /api/community?cursor=&limit= -> SELECT ... ORDER BY created_at DESC LIMIT n
          -> each row: fromSchema(recipe_json) + author badge -> community card

Save:     community detail -> "Save to my library" -> fromSchema(recipe_json) into state.recipes
          with a fresh local _id -> save()   (offline; no server)

Edit/Del: author-only; server checks row.author_sub === context.data.auth.sub, else 403 not_author
```

### 5.1 Author metadata lives in DB columns, not inside the recipe JSON-LD

`recipe_json` stores the **pure schema.org/Recipe** — `toSchema()` output, read back via
`fromSchema()`. This honors PRD 0's "schema.org/Recipe is canonical; any new data round-trips through
`fromSchema`/`toSchema`." The "added by X" marking is a **community-layer annotation** (DB columns +
UI), not intrinsic recipe data, so:

- A recipe stays portable — existing JSON-LD export/import is not polluted by author fields.
- "Save to my library" copies just the recipe content; the author does not come along (the copy
  becomes the user's own local recipe).

### 5.2 No separate users table

Because the display name is auto-captured from Google (not user-chosen), `author_sub`,
`author_name`, and `author_picture` are **snapshotted** from the session onto each recipe row at
share/edit time. There is no profile-edit UI and no `users` table. If a member changes their Google
name, older recipes keep their snapshot — acceptable, and it avoids a join on every read.

### 5.3 Backend store: Cloudflare D1

D1 (SQLite) bound to Pages Functions as `env.DB`, configured in `wrangler.toml` (same binding pattern
as the existing `[ai]` binding). Chosen over KV (which would require a hand-maintained, race-prone
index for "list all" / "list by author") and Durable Objects (strong consistency that buys nothing
at this scale, with per-request billing). Relational shape fits listing, ownership checks, and
keyset pagination natively.

## 6. Data model

### 6.1 D1 schema (`community_recipes`)

```sql
CREATE TABLE community_recipes (
  id             TEXT PRIMARY KEY,          -- server-generated UUID
  author_sub     TEXT NOT NULL,             -- Google sub (stable identity)
  author_name    TEXT NOT NULL,
  author_picture TEXT,                      -- nullable avatar URL
  recipe_json    TEXT NOT NULL,             -- toSchema() JSON-LD (canonical recipe content)
  created_at     INTEGER NOT NULL,          -- ms epoch
  updated_at     INTEGER NOT NULL           -- ms epoch
);
CREATE INDEX idx_community_created ON community_recipes(created_at DESC, id);
CREATE INDEX idx_community_author  ON community_recipes(author_sub, created_at DESC);
```

- `recipe_json` is the canonical schema.org/Recipe (`toSchema()`). On read, `fromSchema(recipe_json)`
  yields the internal model; the row `id` overrides the internal `_id` and the author columns supply
  the badge.
- `created_at` / `updated_at` are ms-epoch integers (sortable, no timezone pain). `Date.now()` is
  fine server-side (Functions runtime).

### 6.2 Session payload (extended)

`signSession` payload grows from `{sub, email}` to `{sub, email, name, picture}`. `picture` is
nullable (some accounts have no avatar). The session JWT is HS256 with the existing `SESSION_SECRET`
and the existing `ISSUER`/`SESSION_TTL`; only the payload shape changes. `auth-session.test.js`
assertions update accordingly.

### 6.3 Client state (additive)

`state` gains `community: { recipes: [], cursor: null, loading: false, hasMore: true, error: null }`
in a new `lib/community.js`. It does **not** touch `state.recipes` / `state.pantry` / `state.cart`.
Local persistence (`save()`/`load()`) is unchanged.

## 7. API surface

All routes under `/api/community`, auth-gated by the existing `functions/api/_middleware.js`
(which provides `context.data.auth = {sub, email, name, picture}`). Pure handlers live in
`functions/_lib/community.js` with **injected D1 deps** (so they are Node-unit-testable without the
runtime — same pattern as `extract.js` / `handler.js`). Thin `functions/api/community/*` Functions
wire `context` -> handler -> `json()`.

| Method + path                | Body / query                         | Returns                       | Authorization            |
|------------------------------|---------------------------------------|-------------------------------|--------------------------|
| `GET /api/community`         | `?cursor=&limit=` (def 20, max 50)    | `{ recipes, nextCursor }` 200 | any signed-in user       |
| `GET /api/community/:id`     | —                                     | `{ recipe, author }` 200      | any signed-in user       |
| `POST /api/community`        | `{ recipe }` (internal model)         | `{ id, recipe, author }` 201  | author = caller         |
| `PUT /api/community/:id`     | `{ recipe }`                          | `{ recipe, author }` 200      | author only, else 403   |
| `DELETE /api/community/:id`   | —                                     | 204                           | author only, else 403   |

- **Pagination:** keyset cursor on `(created_at DESC, id)` — stable under concurrent inserts, no
  OFFSET drift. `cursor` is an opaque token encoding `(created_at, id)` of the last item.
- **Permissions:** each mutation loads the row's `author_sub`; `author_sub !== context.data.auth.sub`
  -> `403 not_author`. Unknown id -> `404 not_found`.
- **Validation:** a recipe without a non-empty `name` -> `400 bad_recipe` (mirrors `fromSchema`'s
  "Untitled" tolerance but rejects empty names at the boundary).

## 8. Views & interaction

- **Nav:** new **Community** item alongside Recipes / Pantry / Import / Export.
- **Community view:** paginated card grid (newest first); each card shows the recipe + an
  **"added by {name}"** badge with avatar; "Load more" on scroll (or a button). Empty state:
  "No shared recipes yet — share one from your library." Offline/failed-load state: a banner
  ("Community needs a connection") — local recipes, pantry, search, import/export keep working.
- **Community detail modal:** reuses `recipeDetail`. Read-only for non-authors; **the author sees
  Edit + Delete**. Reuses `recipeForm` for editing.
- **"Share to Community":** available on local recipes (detail modal + card menu). Confirms, then
  `toSchema()` -> `POST /api/community`. Success toast; the card stays in the local library
  unchanged (sharing copies, it does not move).
- **"Save to my library":** on a community recipe detail. `fromSchema(recipe_json)` into
  `state.recipes` with a **fresh local `_id`** -> `save()`. Works offline thereafter; no link back to
  the community recipe.
- **Extraction (unchanged):** `/api/extract` prefills the form drawer (local) as today. Sharing is a
  separate explicit step; no new coupling between extract and community.

## 9. Error handling

- Missing or non-functional `env.DB` -> `500 server_misconfigured db_binding` (mirrors `ai_binding`).
- D1 query/prepare failure -> `500`.
- Bad recipe payload (no name) -> `400 bad_recipe`. Malformed JSON -> `400 bad_json`.
- Not author on edit/delete -> `403 not_author`. Unknown id -> `404 not_found`.
- Auth failures still come from the middleware (`401 missing_token` / `invalid_token`,
  `500 server_misconfigured session_secret`).
- **Client:** share/edit/delete failures surface as toasts; the Community list shows an
  error/empty state. **Local-first is never broken** — a server failure never blocks local flows.

## 10. Testing

- `test/community.test.js` (server, pure handlers + stub D1): list + keyset pagination,
  `getCommunity` (200 / 404), `shareRecipe` (author stamping + 201 + `bad_recipe` on empty name +
  `db_binding` guard), `editRecipe` / `deleteRecipe` (author-only 403, 404), query-error 500.
- `test/community-client.test.js`: cursor encoding/decoding + the share/save serialize round-trips
  (`toSchema` -> share; `fromSchema` -> save), pure `lib/community.js`, Node-testable.
- `test/auth-session.test.js`: updated for `{sub, email, name, picture}` payload (round-trip
  preserves name + nullable picture; wrong-secret/expired/garbage still reject).
- Middleware contract already locked by `test/extract-route.test.js` (`context.data.auth`).

## 11. Deployment & configuration

- `wrangler.toml`: add a `[[d1_databases]]` block (`binding = "DB"`, `database_name`,
  `database_id`) alongside `[ai]`. The D1 database is created once via
  `wrangler d1 create cookbook` (or the dashboard); the migration
  (`docs/superpowers/migrations/community_recipes.sql` or a `functions/_lib/migration.js`) is
  applied via `wrangler d1 execute` (and noted for the plan, since git-connected deploys do not run
  D1 migrations automatically).
- GIS scopes extended to `email profile` in `docs/js/lib/auth.js`.
- No new runtime dependencies; `npm ci` build unchanged.

## 12. Constraints honored (from PRD 0 / PRD 3)

- **Local-first:** local library untouched; Community is additive and degrades gracefully offline;
  existing flows stay offline-capable.
- **Zero-dependency `lib/`:** new client logic in `lib/community.js`, new markup in `components/`,
  wiring in `app.js`. Pure modules stay Node-testable.
- **schema.org/Recipe canonical:** `recipe_json` is `toSchema()` output, read via `fromSchema()`;
  author metadata is kept out of the recipe JSON-LD.
- **Auth allowlist preserved:** no open sign-up; author identity = the signed-in session.

## 13. Open items for the implementation plan

- Exact GIS scope string + whether `verifyIdToken` (PRD 3's `functions/_lib/google.js`) already
  surfaces `name` / `picture` from the id_token claims or needs a small change; and the fallback if
  `name` is absent (default to the email local-part so `author_name` is never empty).
- D1 migration mechanism (wrangler CLI `d1 execute` vs a startup-guarded `CREATE TABLE IF NOT
  EXISTS` in the handler) and where the SQL lives.
- Whether to also emit `author` inside the exported JSON-LD of a community recipe (deferred — not
  in scope here; recipe_json stays pure).
- Cursor token encoding (base64url of a small JSON `{c: created_at, i: id}` vs opaque server
  integer) — plan will pick base64url of the JSON pair.