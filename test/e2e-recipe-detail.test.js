import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const RECIPE_ID = 'recipe-tall-ingredients';
const SCALAR_RECIPE_ID = 'recipe-scalar-yield';
const INGREDIENTS = Array.from({ length: 40 }, (_, index) => `${index + 1} ingredient ${index + 1}`);

let server;
let baseUrl;
let browser;

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.js')], { cwd: ROOT, stdio: 'pipe' });
  server = createServer((request, response) => {
    const requestPath = request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0];
    const filePath = normalize(join(DOCS, requestPath));
    if (!filePath.startsWith(DOCS) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webmanifest': 'application/manifest+json',
    };
    response.writeHead(200, { 'content-type': types[extname(filePath)] || 'application/octet-stream' });
    response.end(readFileSync(filePath));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function createRecipePage(viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const token = [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'kay' })).toString('base64url'),
    'test',
  ].join('.');
  await context.addInitScript(({ tokenValue }) => {
    localStorage.setItem('cb_token', tokenValue);
    localStorage.setItem('cb_email', 'kay@example.test');
    localStorage.setItem('cb_tour_cookbook_v1_kay', 'complete');
    localStorage.setItem('cb_summer_theme_recommendation_v1:kay', '1');
  }, { tokenValue: token });

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/household') {
      return json(route, {
        household: { id: 'household-home', name: 'Our kitchen' },
        member: { id: 'member-kay', displayName: 'Kaysser', role: 'owner', sub: 'kay' },
      });
    }
    if (url.pathname === '/api/community' && request.method() === 'GET') {
      return json(route, {
        recipes: [{
          id: RECIPE_ID,
          author: { sub: 'kay', name: 'Kaysser Kayyali' },
          createdAt: 1,
          updatedAt: 1,
          recipe: {
            '@context': 'https://schema.org',
            '@type': 'Recipe',
            name: 'Forty Ingredient Pizza',
            recipeCategory: ['Dinner', 'Weeknight'],
            recipeCuisine: ['Italian', 'American'],
            recipeYield: ['4 servings', '1 10-inch pizza'],
            recipeIngredient: INGREDIENTS,
            recipeInstructions: [
              { '@type': 'HowToStep', position: 1, text: 'Mix the dough.' },
              { '@type': 'HowToStep', position: 2, text: 'Bake until golden.' },
            ],
            nutrition: {
              '@type': 'NutritionInformation',
              servingSize: '1/4 pizza',
              calories: '474 kcal',
              proteinContent: '18 g',
              fatContent: '19 g',
              carbohydrateContent: '56 g',
            },
          },
        }, {
          id: SCALAR_RECIPE_ID,
          author: { sub: 'kay', name: 'Kaysser Kayyali' },
          createdAt: 2,
          updatedAt: 2,
          recipe: {
            '@context': 'https://schema.org',
            '@type': 'Recipe',
            name: 'Four Serving Soup',
            recipeCategory: 'Dinner',
            recipeYield: '4 servings',
            recipeIngredient: ['4 cups stock'],
            recipeInstructions: [{ '@type': 'HowToStep', position: 1, text: 'Simmer.' }],
          },
        }],
        nextCursor: null,
      });
    }
    if (url.pathname === '/api/workspace' && request.method() === 'GET') {
      return json(route, {
        householdId: 'household-home', revision: 0, plan: [], cart: [], pantry: [],
        shoppingChecked: {}, manualItems: [], recentMutations: [],
      });
    }
    if (url.pathname === '/api/cooks' && request.method() === 'GET') {
      return json(route, { events: [], reactions: [] });
    }
    return json(route, { error: `unhandled ${request.method()} ${url.pathname}` }, 404);
  });

  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) browserErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) browserErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.panel === 'week', null, { timeout: 60_000 });
  const recipesNav = page.locator('button[data-panel="recipes"]');
  await recipesNav.click();
  await page.waitForFunction(() => document.body.dataset.panel === 'recipes', null, { timeout: 60_000 });
  assert.equal(await recipesNav.evaluate((element) => element.classList.contains('active')), true, 'Recipes navigation is active');
  const card = page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`);
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  assert.deepEqual(await card.locator('.badge').allTextContents(), [
    'Dinner · Weeknight',
    'Italian · American',
  ]);
  const arrayYieldPill = card.locator('.meta-pill');
  assert.equal(await arrayYieldPill.textContent(), 'Serves 4 · One 10-inch pizza');
  assert.equal(await arrayYieldPill.locator('svg.icon').count(), 1);
  assert.doesNotMatch(await arrayYieldPill.textContent(), /Serves Makes|4 servings,1 10-inch pizza/);

  const scalarYieldPill = page.locator(`.recipe-card[data-id="${SCALAR_RECIPE_ID}"] .meta-pill`);
  assert.equal(await scalarYieldPill.textContent(), 'Serves 4');
  assert.equal(await scalarYieldPill.locator('svg.icon').count(), 1);
  await card.click();
  await page.locator('#detail-modal.open').waitFor();
  return { context, page, browserErrors };
}

test('desktop nutrition follows a short method instead of the forty-ingredient grid row', { timeout: 90_000 }, async () => {
  const { context, page, browserErrors } = await createRecipePage({ width: 1440, height: 900 });
  try {
    const ingredients = await page.locator('.detail-ingredients').boundingBox();
    const method = await page.locator('#dm-steps').boundingBox();
    const nutrition = await page.locator('#dm-nutrition').boundingBox();
    assert.ok(ingredients && method && nutrition, 'detail sections must have measurable geometry');

    const measurements = {
      ingredientsTop: Math.round(ingredients.y),
      ingredientsBottom: Math.round(ingredients.y + ingredients.height),
      methodBottom: Math.round(method.y + method.height),
      nutritionTop: Math.round(nutrition.y),
      methodToNutritionGap: Math.round(nutrition.y - (method.y + method.height)),
    };
    console.log(`ISSUE17_DESKTOP_LAYOUT ${JSON.stringify(measurements)}`);
    assert.ok(
      nutrition.y < ingredients.y + ingredients.height,
      `nutrition should flow in the short method column before the ingredients end: ${JSON.stringify(measurements)}`,
    );
    assert.ok(
      measurements.methodToNutritionGap < 400,
      `nutrition should remain attached to the short method: ${JSON.stringify(measurements)}`,
    );

    assert.equal(await page.locator('#dm-eyebrow').textContent(), 'Dinner · Weeknight · Italian · American');
    const yieldMeta = page.locator('.detail-meta-item', { hasText: 'Serves' });
    assert.equal(await yieldMeta.locator('.k').textContent(), 'Serves');
    assert.equal(await yieldMeta.locator('.v').textContent(), '4 · One 10-inch pizza');
    await page.locator('.nutrition-strip[aria-label="Nutrition per serving"]').waitFor();
    assert.match(await page.locator('#dm-nutrition').innerText(), /per serving/i);
    await page.locator('#detail-modal [aria-label="Added by Kaysser Kayyali"]').waitFor();

    const footerBefore = await page.locator('.detail-footer').boundingBox();
    await page.locator('.detail-body').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const footerAfter = await page.locator('.detail-footer').boundingBox();
    assert.ok(footerBefore && footerAfter && Math.abs(footerBefore.y - footerAfter.y) < 1, 'footer stays fixed while detail content scrolls');
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});

test('mobile keeps ingredients first in the vertical recipe-detail flow', { timeout: 30_000 }, async () => {
  const { context, page, browserErrors } = await createRecipePage({ width: 402, height: 874 });
  try {
    const ingredients = await page.locator('.detail-ingredients').boundingBox();
    const method = await page.locator('.detail-steps').boundingBox();
    const nutrition = await page.locator('#dm-nutrition').boundingBox();
    assert.ok(ingredients && method && nutrition, 'mobile detail sections must have measurable geometry');
    assert.ok(ingredients.y < method.y, 'ingredients remain before the method in vertical flow');
    assert.ok(method.y < nutrition.y, 'nutrition remains after the cooking method');
    assert.equal(await page.locator('.detail-body').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});
