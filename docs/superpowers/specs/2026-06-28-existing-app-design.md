# PRD 0 — Cookbook (existing application)

**Status:** Reference (documents current state as of 2026-06-28)
**Type:** Baseline / "as-is" PRD. No new work. Exists to anchor the three feature PRDs that follow.

## 1. Purpose

Cookbook is a **mobile-first, local-first recipe manager** that stores recipes as
[schema.org/Recipe](https://schema.org/Recipe) JSON-LD. It has no build step, no framework, and no
runtime dependencies — only native ES modules. It runs entirely in the browser; all data lives in
`localStorage`. Nothing is transmitted to any server.

This document describes what exists today so the feature PRDs (shopping cart, web extraction,
Google auth) have a shared baseline to build on and reference.

## 2. Goals (as built)

- Store a personal recipe library with full schema.org/Recipe metadata.
- Track a pantry and use it to show which recipes are makeable (complete / partial / missing).
- Provide flexible search and category filtering.
- Keep all data on the user's device, portable via JSON-LD import/export.

## 3. Non-goals (as built)

- No accounts, no sign-in, no server, no database.
- No sharing, no sync, no cross-device access.
- No recipe discovery or import from the web (only manual entry and JSON-LD file import/export).

## 4. Architecture

```
cookbook/
├── docs/                      ← static site served by GitHub Pages
│   ├── index.html             ← markup only (no inline logic)
│   ├── css/styles.css
│   └── js/
│       ├── app.js             ← orchestration: wires logic + components to the DOM (only DOM-touching file)
│       ├── lib/               ← pure logic, no DOM, fully unit-tested under Node
│       │   ├── schema.js      ← schema.org/Recipe ↔ internal model
│       │   ├── pantry.js      ← pantry matching, eligibility, ingredient parsing
│       │   ├── filters.js     ← search & filtering
│       │   ├── format.js      ← duration formatting, HTML escaping, pluralize
│       │   ├── store.js       ← app state + localStorage persistence
│       │   ├── constants.js   ← categories, diets, seed data
│       │   ├── icons.js       ← inline SVG registry
│       │   └── dom.js          ← minimal DOM helpers ($, els, toast)
│       └── components/        ← presentational modules returning HTML strings
│           ├── recipeCard.js
│           ├── recipeDetail.js
│           └── recipeForm.js
├── test/                      ← Node built-in test runner (no deps)
│   ├── schema.test.js
│   ├── pantry.test.js
│   └── filters.test.js
├── cookbook.html              ← legacy single-file standalone build (still works)
└── package.json               ← type: module, single script: "test"
```

**Layering principle.** `lib/` modules are pure — data in, data out, never touching the DOM. This
makes them trivial to unit-test under Node without a browser or DOM shim. `components/` turn data
into HTML strings. `app.js` is the **only** file that reads/writes the DOM and wires events. This
separation is the reason the test suite runs with zero dependencies.

## 5. Data model

### 5.1 Internal recipe (`schema.js`)
```
{
  _id, name, url, dateCreated, dateModified,
  recipeCategory, recipeCuisine, recipeYield, cookingMethod, suitableForDiet,
  prepTime, cookTime, totalTime,                  // ISO 8601 durations, e.g. "PT10M"
  recipeIngredient: string[],                    // raw lines, e.g. "2 tablespoons olive oil"
  recipeInstructions: string[],                  // text only
  nutrition: { servingSize, calories, proteinContent, fatContent, carbohydrateContent }
}
```

### 5.2 JSON-LD (`toSchema` / `fromSchema`)
- Export wraps `@context`, `@type: Recipe`, direct fields, `recipeIngredient[]`, and
  `recipeInstructions` as `HowToStep` objects (`{ '@type': 'HowToStep', position, text }`).
- `nutrition` is emitted as `NutritionInformation` when any nutrient is present.
- `fromSchema` is tolerant: accepts string or HowToStep instructions, missing fields, and a
  `@graph`-free single object. `_id` is generated via `uuid()` (with a fallback when
  `crypto.randomUUID` is unavailable).
- `parseImport(data)` accepts a single object or array, keeps entries that look like recipes
  (`@type === 'Recipe'` or have a `name`), and maps through `fromSchema`.

### 5.3 Pantry (`pantry.js`)
- `string[]` of **lowercase** ingredient names, persisted at `cb_pantry`.
- Matching is **substring-based**: pantry `"olive oil"` satisfies recipe line `"2 tbsp olive oil"`
  (`haveIngredient`).
- `baseName(raw)` strips leading quantity and unit (`"2 tablespoons olive oil"` → `"olive oil"`)
  using two regexes (`LEADING_QTY`, `LEADING_UNIT`). It **discards** the qty/unit.
- `allRecipeIngredients(recipes)` builds a sorted, deduped suggestion list (base noun + full line)
  for the pantry autocomplete datalist.
- `addToPantry` / `removeFromPantry` / `togglePantry` are pure (return new arrays).
- `normalizePantry` migrates legacy `{name, quantity}` objects to `string[]`.

### 5.4 State & persistence (`store.js`)
- `state`: `{ recipes, pantry, editingId, detailId, searchTerm, categoryFilter, eligibleOnly }`.
- `save()` writes `cb_recipes` and `cb_pantry` to `localStorage`.
- `init()` loads, then seeds first-run defaults (`SEED_RECIPES`, `SEED_PANTRY`) if the library is
  empty.

## 6. Views & interaction

- **Sidebar / bottom nav:** Recipes, Pantry, Import, Export.
- **Recipes panel:** search input, category chips, "Can make" toggle, recipe grid of cards.
  Card corner folds to indicate eligibility (complete / partial / missing).
- **Pantry panel:** add-ingredient input with autocomplete datalist, pantry tag chips with
  remove buttons, flexible-matching hint.
- **Recipe detail modal:** meta pills (prep/cook/total/serves/method), tappable ingredient
  checklist (tap to toggle pantry membership), numbered steps, optional nutrition, footer buttons
  (View JSON-LD, Edit).
- **Recipe form drawer:** identity fields, timing (ISO 8601), ingredient editor, steps editor,
  nutrition. Create or edit.
- **JSON-LD modal:** preview of the schema.org/Recipe JSON-LD with Copy.
- **Import/Export:** JSON file import (parsed via `parseImport`) and JSON-LD export of the whole
  library.

## 7. Testing

Node built-in test runner (`node --test`), no dependencies. Requires Node ≥ 18.

- `schema.test.js` — JSON-LD serialisation, HowToStep wrapping, round-trip fidelity, import parsing.
- `pantry.test.js` — substring matching, eligibility classification, base-name extraction, pure
  add/remove/toggle, legacy migration.
- `filters.test.js` — search across fields, category/eligibility filtering, combined filters,
  format helpers.

CI runs the suite on every push/PR (`.github/workflows/test.yml`).

## 8. Deployment

`docs/` is deployed to **GitHub Pages** on push to `main`
(`.github/workflows/deploy.yml`), source = GitHub Actions. Static, no server.

## 9. Constraints that the feature PRDs must respect

- **Local-first:** the device (`localStorage`) remains the source of truth. New features may not
  make the app require a server to function for existing flows (manual recipes, pantry, search,
  import/export all stay offline-capable).
- **Zero-dependency ethos:** `lib/` stays pure and testable under Node without a DOM shim. New
  client logic belongs in `lib/`, new markup in `components/`, wiring in `app.js`.
- **schema.org/Recipe is canonical:** any new data brought in (e.g. extracted recipes) must round-
  trip through `fromSchema`/`toSchema`.
- **Pantry matching is substring-based and lossy on quantities** — feature PRDs that need
  quantities (shopping cart) must extend, not replace, this.