// test/e2e-render.test.js — jsdom-based end-to-end render test.
//
// Executes the SOURCE docs/js/app.js boot against a real DOM (jsdom) and
// asserts the page actually renders. This catches the regression where
// app.js called controller factories that returned `render` functions but
// never called them or registered them with the panels router — so the
// recipe grid never rendered and the GIS sign-in button never mounted.
//
// No build required: we import the SOURCE app.js (not the gitignored bundle).
// jsdom's `runScripts: 'outside-only'` loads the HTML DOM but does NOT execute
// the page's <script> tags — so the bundle never runs; only our manual
// `import('../docs/js/app.js')` runs the boot. That isolates the test to the
// source wiring.
//
// Since the app now requires auth to boot, we pre-populate localStorage with
// a fake token and mock fetch to return seed recipes from the API.
//
// Run via: node --test test/e2e-render.test.js (or `npm test` for everything).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Seed recipes (mirrors constants.js) for the API mock response.
const SEED_RECIPES = [
  {
    id: 'seed-1', recipe: {
      '@context': 'https://schema.org', '@type': 'Recipe', name: 'Classic Shakshuka',
      recipeCategory: 'Breakfast', recipeCuisine: 'Middle Eastern', recipeYield: '6 servings',
      cookingMethod: 'Stovetop', suitableForDiet: 'https://schema.org/VegetarianDiet',
      prepTime: 'PT10M', cookTime: 'PT20M', totalTime: 'PT30M',
      recipeIngredient: [
        '2 tablespoons olive oil', '1 medium onion, diced',
        '1 red bell pepper, seeded and diced', '4 garlic cloves, finely chopped',
        '2 tsp paprika', '1 tsp cumin', '¼ tsp chili powder',
        '1 (28-oz) can whole peeled tomatoes', '6 large eggs',
        'salt and pepper to taste', 'fresh cilantro, chopped', 'fresh parsley, chopped',
      ],
      recipeInstructions: [
        { '@type': 'HowToStep', position: 1, text: 'Heat olive oil in a large sauté pan over medium heat.' },
        { '@type': 'HowToStep', position: 2, text: 'Add garlic and spices and cook an additional minute.' },
        { '@type': 'HowToStep', position: 3, text: 'Pour in tomatoes. Simmer.' },
        { '@type': 'HowToStep', position: 4, text: 'Crack eggs into wells. Cook 5-8 minutes.' },
        { '@type': 'HowToStep', position: 5, text: 'Garnish with cilantro and parsley.' },
      ],
    },
    author: { sub: 'seed-author', name: 'Community Cook', picture: null },
    createdAt: Date.now(), updatedAt: Date.now(),
  },
  {
    id: 'seed-2', recipe: {
      '@context': 'https://schema.org', '@type': 'Recipe', name: 'Spaghetti Carbonara',
      recipeCategory: 'Entree', recipeCuisine: 'Italian', recipeYield: '4 servings',
      cookingMethod: 'Boiling', prepTime: 'PT10M', cookTime: 'PT15M', totalTime: 'PT25M',
      recipeIngredient: [
        '400g spaghetti', '200g pancetta or guanciale', '4 large eggs',
        '100g pecorino romano, grated', '50g parmesan, grated',
        'black pepper to taste', 'salt to taste',
      ],
      recipeInstructions: [
        { '@type': 'HowToStep', position: 1, text: 'Boil spaghetti al dente.' },
        { '@type': 'HowToStep', position: 2, text: 'Fry pancetta until crispy.' },
        { '@type': 'HowToStep', position: 3, text: 'Whisk eggs with cheeses and pepper.' },
        { '@type': 'HowToStep', position: 4, text: 'Toss pasta with pancetta, fold in egg mixture.' },
        { '@type': 'HowToStep', position: 5, text: 'Add pasta water for creaminess. Serve.' },
      ],
    },
    author: { sub: 'seed-author', name: 'Community Cook', picture: null },
    createdAt: Date.now(), updatedAt: Date.now(),
  },
];

const GLOBAL_KEYS = [
  'document', 'window', 'localStorage', 'navigator', 'atob', 'btoa',
  'HTMLElement', 'Node', 'Event', 'CustomEvent', 'crypto', 'fetch',
];
const savedDescriptors = {};

function installGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

before(async () => {
  const html = readFileSync(
    fileURLToPath(new URL('../docs/index.html', import.meta.url)),
    'utf8'
  );
  const dom = new JSDOM(html, {
    url: 'https://cookbook.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  const overrides = {
    document: dom.window.document,
    window: dom.window,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    atob: dom.window.atob,
    btoa: dom.window.btoa,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    crypto: webcrypto,
    // Mock fetch: return seed recipes for GET /api/community, 200 for everything else
    fetch: async (url, init) => {
      const u = typeof url === 'string' ? url : url?.url || '';
      if (u.includes('/community') && (!init || init.method === undefined || init.method === 'GET')) {
        return new Response(JSON.stringify({ recipes: SEED_RECIPES, nextCursor: null }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      // For create/update/delete, return success
      if (u.includes('/community') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'new-id' }), {
          status: 201, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('/community') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (u.includes('/community') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      // Default: success
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  for (const k of GLOBAL_KEYS) {
    savedDescriptors[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    installGlobal(k, overrides[k]);
  }

  // Pre-populate auth so the app boots past the login gate
  overrides.localStorage.setItem('cb_token', 'fake-jwt-token');
  overrides.localStorage.setItem('cb_email', 'test@example.com');

  // Import app.js and wait for the async boot to complete.
  const app = await import('../docs/js/app.js');
  await app.ready;
});

after(() => {
  for (const k of GLOBAL_KEYS) {
    const desc = savedDescriptors[k];
    if (desc) {
      Object.defineProperty(globalThis, k, desc);
    } else {
      delete globalThis[k];
    }
  }
});

test('recipe grid renders on boot (seed recipes)', () => {
  const grid = globalThis.document.getElementById('recipe-grid');
  assert.ok(grid, '#recipe-grid exists in the DOM');
  assert.ok(
    grid.children.length > 0,
    'recipe grid populated — render wiring works (recipes.render registered + showPanel("recipes") called it)'
  );
});

test('auth zone renders on boot', () => {
  const zone = globalThis.document.getElementById('settings-auth-zone');
  assert.ok(zone, '#settings-auth-zone exists');
  // With the fake token set, renderAuth shows signed-in state.
  // Without a token, it would mount #g-signin-btn.
  // Either way, the zone should not be empty.
  const hasSignIn = zone.querySelector('#g-signin-btn');
  const hasSignedIn = zone.textContent.toLowerCase().includes('signed in');
  assert.ok(
    hasSignIn || hasSignedIn,
    'auth zone populated — either GIS button (signed out) or sign-in status (signed in)'
  );
});

test('panel router marked the recipes panel active on boot', () => {
  const panel = globalThis.document.getElementById('panel-recipes');
  assert.ok(panel, '#panel-recipes exists');
  assert.ok(
    panel.classList.contains('active'),
    'recipes panel has .active after panels.showPanel("recipes")'
  );
});

test('recipe count label reflects seeded library', () => {
  const countEl = globalThis.document.getElementById('recipe-count');
  assert.ok(countEl, '#recipe-count exists');
  assert.match(countEl.textContent, /recipe/i, 'recipe-count label populated');
});
