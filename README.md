# Cookbook

A mobile-first recipe manager that stores recipes as **[schema.org/Recipe](https://schema.org/Recipe)** JSON-LD. No build step, no framework, no dependencies — just native ES modules.

**Live demo:** https://kaykayyali.github.io/cookbook/

![Tests](https://github.com/kaykayyali/cookbook/actions/workflows/test.yml/badge.svg)

## Features

- **Recipe library** with full schema.org metadata — prep/cook/total time, yield, cuisine, category, cooking method, dietary suitability, nutrition
- **Pantry tracking** — mark what you have on hand and instantly see which recipes you can make (complete / partial / missing, shown as a folded card corner)
- **Tap-to-toggle ingredients** — from any recipe's detail view, tap an ingredient to add or remove it from your pantry
- **Pantry autocomplete** — suggestions drawn from every ingredient across your recipes
- **Search & filter** — by name, cuisine, category, or ingredient; filter to "can make" only
- **JSON-LD import/export** — everything is valid schema.org/Recipe, so recipes are portable
- **Offline-first** — all data lives in your browser's `localStorage`, nothing is sent anywhere

## Project Structure

```
cookbook/
├── docs/                      ← GitHub Pages serves this folder
│   ├── index.html             ← markup only
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js             ← orchestration: wires logic + components to the DOM
│       ├── lib/               ← pure logic (no DOM) — fully unit-tested
│       │   ├── schema.js      ← schema.org/Recipe ↔ internal model
│       │   ├── pantry.js      ← matching, eligibility, ingredient parsing
│       │   ├── filters.js     ← search & filtering
│       │   ├── format.js      ← duration formatting, HTML escaping
│       │   ├── store.js       ← state + localStorage persistence
│       │   ├── constants.js   ← categories, diets, seed data
│       │   ├── icons.js       ← inline SVG registry
│       │   └── dom.js         ← minimal DOM helpers
│       └── components/        ← presentational modules (return HTML strings)
│           ├── recipeCard.js
│           ├── recipeDetail.js
│           └── recipeForm.js
├── test/                      ← Node built-in test runner (no deps)
│   ├── schema.test.js
│   ├── pantry.test.js
│   └── filters.test.js
├── cookbook.html              ← legacy single-file build (standalone, still works)
└── package.json
```

### Why this layout

The `lib/` modules are **pure** — they take data in and return data out, never touching the DOM. That makes them trivial to unit-test under Node and easy to reason about. The `components/` modules turn data into HTML strings. `app.js` is the only place that reads/writes the DOM and wires up events. This separation is what lets the test suite run without a browser or any DOM-shimming dependency.

## Development

Requires **Node 18+** (uses the built-in test runner; no `npm install` needed).

```bash
# Run the test suite
npm test

# Serve locally (any static server works, because there's no build step)
npx serve docs
# or
python3 -m http.server -d docs 8000
```

Then open http://localhost:8000.

> ES modules require `http://` — opening `index.html` via `file://` will be blocked by the browser's module CORS policy. Use a static server, or open the standalone `cookbook.html` which has everything inlined.

## Testing

Tests cover the pure logic layer using Node's built-in test runner:

- **schema.test.js** — JSON-LD serialisation, HowToStep wrapping, round-trip fidelity, import parsing
- **pantry.test.js** — substring matching, eligibility classification, ingredient base-name extraction, immutable add/remove/toggle, legacy data migration
- **filters.test.js** — search across fields, category/eligibility filtering, combined filters; plus format helpers

```bash
npm test
```

CI runs the suite on every push and pull request (`.github/workflows/test.yml`).

## Deployment

`docs/` is deployed to GitHub Pages automatically on push to `main` via `.github/workflows/deploy.yml`. To enable it once: **Settings → Pages → Source → GitHub Actions**.

## Data & Privacy

All recipes and pantry data are stored locally in your browser. Nothing is transmitted to any server. Use **Export** to back up your library as a JSON-LD file you can re-import anytime.

## License

MIT
