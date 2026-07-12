# Cookbook

A mobile-first recipe manager that stores recipes as **[schema.org/Recipe](https://schema.org/Recipe)** JSON-LD. **Login-required** — all recipes are stored in Cloudflare D1 and synced across devices. Pantry and shopping cart stay local.

**Live demo:** https://kaykayyali.github.io/cookbook/

![Tests](https://github.com/kaykayyali/cookbook/actions/workflows/test.yml/badge.svg)

## Features

- **Recipe library** with full schema.org metadata — prep/cook/total time, yield, cuisine, category, cooking method, dietary suitability, nutrition
- **Pantry tracking** — mark what you have on hand and instantly see which recipes you can make (complete / partial / missing, shown as a folded card corner)
- **Tap-to-toggle ingredients** — from any recipe's detail view, tap an ingredient to add or remove it from your pantry
- **Pantry autocomplete** — suggestions drawn from every ingredient across your recipes
- **Search & filter** — by name, cuisine, category, or ingredient; filter to "can make" only
- **JSON-LD import/export** — everything is valid schema.org/Recipe, so recipes are portable
- **Shopping cart** — add ingredients to a cart for shopping, with pantry-matching intelligence
- **5 color themes** — light, dark, sepia, forest, and ocean
- **Community sharing** — share recipes to a community feed; save others' recipes to your library (requires Google Sign-In)
- **AI recipe extraction** — paste a URL and have Workers AI extract the recipe into your library
- **Login-required** — Google Sign-In gate; all recipes stored server-side, synced across devices
- **Offline-tolerant** — pantry and shopping cart work without connectivity

## Architecture

```
cookbook/
├── docs/                          ← Pages static assets
│   ├── index.html                 ← shell markup
│   ├── css/
│   │   ├── tokens.css             ← design tokens (colours, spacing, z-index)
│   │   ├── base.css               ← reset, typography, focus-visible
│   │   ├── layout.css             ← Stack, Cluster, Grid, Container primitives
│   │   ├── components.css         ← .card, .badge, .toast, .drawer, .modal, .tabs
│   │   └── app.css                ← application-specific styles (theme layer)
│   ├── js/
│   │   ├── app.js                 ← 65-line bootstrap: inits controllers, wires callbacks
│   │   ├── lib/                   ← pure logic (no DOM) — fully unit-tested
│   │   │   ├── schema.js          ← schema.org/Recipe ↔ internal model
│   │   │   ├── pantry.js          ← matching, eligibility, ingredient parsing
│   │   │   ├── filters.js         ← search & filtering
│   │   │   ├── format.js          ← duration formatting, HTML escaping
│   │   │   ├── store.js           ← state + localStorage persistence
│   │   │   ├── constants.js       ← categories, diets, seed data
│   │   │   ├── icons.js           ← inline SVG registry
│   │   │   ├── dom.js             ← minimal DOM helpers ($, escapeHtml)
│   │   │   ├── ui.js              ← Button, IconButton, Input, Icon, Toast factories
│   │   │   ├── theme.js           ← 5-theme palette and switching
│   │   │   ├── auth.js            ← Google Sign-In token management
│   │   │   ├── community.js       ← community API client (authFetch wrappers)
│   │   │   ├── cart.js            ← cart logic (parse, group, check)
│   │   │   ├── api.js             ← personal recipes API client (CRUD)
│   │   │   └── schema-modal.js    ← JSON-LD modal + export helper
│   │   ├── components/            ← HTML-string factories
│   │   │   ├── recipeCard.js
│   │   │   ├── recipeDetail.js
│   │   │   ├── recipeForm.js
│   │   │   ├── cart.js
│   │   │   └── communityCard.js
│   │   └── controllers/           ← DOM wiring + state mutations (one per feature)
│   │       ├── panels.js          ← tab router (recipes/pantry/cart/community/settings)
│   │       ├── recipes.js
│   │       ├── pantry.js
│   │       ├── cart.js
│   │       ├── detail.js
│   │       ├── drawer.js
│   │       ├── extract.js
│   │       ├── fab.js
│   │       ├── search.js
│   │       ├── settings.js
│   │       └── community.js
│   └── superpowers/               ← design specs, plans, and D1 migrations
├── functions/                     ← Cloudflare Pages Functions (backend)
│   ├── _middleware.js             ← login gate (session verification)
│   ├── api/
│   │   ├── _middleware.js         ← JWT auth gate (context.data.auth)
│   │   ├── auth.js                ← Google token verification → session cookie
│   │   ├── recipes.js             ← GET/POST personal recipes
│   │   ├── recipes/[id].js        ← GET/PUT/DELETE personal recipes
│   │   ├── community.js           ← GET/POST shared recipes
│   │   ├── community/[id].js      ← PUT/DELETE individual shared recipes
│   │   └── extract.js             ← URL → Workers AI → schema.org/Recipe
│   └── _lib/
│       ├── recipes.js             ← personal recipe CRUD + seed (D1)
│       ├── session.js             ← JWT sign/verify (jose)
│       ├── google.js              ← Google token verification
│       ├── whitelist.js           ← ALLOWED_EMAILS gate
│       ├── community.js           ← D1 CRUD + self-healing schema
│       ├── extract.js             ← fetch + AI extraction + SSRF guard
│       ├── handler.js             ← shared request handler
│       ├── http.js                ← JSON response helpers
│       └── seed-data.js           ← seed recipes for first-time users
├── scripts/
│   ├── build.js                   ← esbuild: bundles JS + CSS with @layer cascade
│   └── app.entry.js               ← controller init re-exports for build test contract
├── test/                          ← ~300 tests via Node built-in test runner
│   ├── schema.test.js
│   ├── pantry.test.js
│   ├── filters.test.js
│   ├── cart.test.js
│   ├── ui.test.js
│   ├── theme.test.js
│   ├── design-system.test.js
│   ├── css-themes.test.js
│   ├── inline-css.test.js
│   ├── build.test.js
│   ├── app-bootstrap.test.js
│   ├── auth-google.test.js
│   ├── auth-handler.test.js
│   ├── auth-jwks.test.js
│   ├── auth-session.test.js
│   ├── auth-whitelist.test.js
│   ├── community.test.js
│   ├── community-client.test.js
│   ├── community-route.test.js
│   ├── extract.test.js
│   ├── extract-route.test.js
│   ├── e2e-render.test.js
│   ├── e2e-smoke.test.js
│   └── controllers/              ← one test file per controller
│       ├── cart.test.js
│       ├── community.test.js
│       ├── detail.test.js
│       ├── drawer.test.js
│       ├── extract.test.js
│       ├── fab.test.js
│       ├── panels.test.js
│       ├── pantry.test.js
│       ├── recipes.test.js
│       ├── search.test.js
│       └── settings.test.js
├── cookbook.html                  ← legacy standalone build (all JS/CSS inlined)
├── wrangler.toml
├── package.json
└── LICENSE
```

Controllers own their DOM and state. Cross-controller communication happens through callback contracts wired in `app.js`. The `lib/` modules are pure functions — data in, data out — making them trivial to test under Node without a browser.

## Development

Requires **Node 18+**.

```bash
# Install dependencies
npm install

# Run the full test suite (~297 tests)
npm test

# Build JS + CSS bundles
npm run build

# Serve locally with Cloudflare Pages Functions (auth, recipes, community, extraction)
npm run dev

# Or serve static-only (no backend, login gate will show):
npx serve docs
```

## Testing

All tests use Node's built-in test runner. The suite covers:

| Area | Files | What it covers |
|------|-------|----------------|
| **Pure logic** | schema, pantry, filters, cart, ui, theme | Data transformations, matching, formatting |
| **Controllers** | 11 files in `test/controllers/` | DOM wiring, state mutations, callback contracts |
| **Auth** | auth-google, auth-handler, auth-jwks, auth-session, auth-whitelist | Token verification, JWT sign/verify, whitelist, fail-closed |
| **Community** | community, community-client, community-route | D1 CRUD, authFetch, share/edit/delete flows |
| **Extraction** | extract, extract-route | AI extraction, SSRF blocking, rate limiting, partial recovery |
| **Build & CSS** | build, design-system, css-themes, inline-css, app-bootstrap | Bundle contents, @layer order, token integrity, controller wiring |
| **E2E** | e2e-render (jsdom), e2e-smoke | DOM rendering, self-building smoke assertions |

```bash
npm test                # full suite
npm run test:e2e        # e2e smoke only
```

CI runs the full suite on every push and pull request (`.github/workflows/test.yml`).

## Deployment

The app is deployed to **Cloudflare Pages** (git-connected, from `main`).

- `docs/` is the Pages output directory (`pages_build_output_dir = "docs"`)
- The build command (`npm ci && npm run build`) must be set in the Cloudflare Pages dashboard (Settings → Builds & deployments) — it cannot live in `wrangler.toml`
- `wrangler.toml` defines bindings (D1, Workers AI) and non-secret vars (GOOGLE_CLIENT_ID, ALLOWED_EMAILS, rate limits)
- **One secret** must be set separately: `SESSION_SECRET` (≥32 chars) — `wrangler pages secret put SESSION_SECRET`

### Local dev with the full backend

```bash
# Create .dev.vars with the session secret
echo 'SESSION_SECRET="your-32-char-secret"' > .dev.vars

# Start the local dev server (Pages + Functions)
npm run dev
```

## Data & Privacy

Recipes are stored in Cloudflare D1 and require Google Sign-In. Pantry and shopping cart data remain in your browser's `localStorage`.

- **What goes to the server**: Your recipes (when signed in), author name/email/avatar in the session JWT and on community-shared recipes, URLs sent for AI recipe extraction
- **What stays local**: Pantry items, shopping cart, color theme preference
- **Export** backs up your library as a portable JSON-LD file

## License

MIT
