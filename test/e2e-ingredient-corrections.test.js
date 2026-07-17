import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchE2eBrowser } from './helpers/playwright-browser.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const CANONICAL_EVIDENCE = process.env.COOKBOOK_ISSUE22_EVIDENCE_DIR
  ? resolve(process.env.COOKBOOK_ISSUE22_EVIDENCE_DIR)
  : join(HERE, 'evidence');
const CAPTURE_EVIDENCE = process.env.COOKBOOK_CAPTURE_EVIDENCE === '1';
const EVIDENCE = mkdtempSync(join(tmpdir(), 'cookbook-issue22-evidence-'));
const EXPECTED_EVIDENCE = [
  'issue-22-before-mobile.png', 'issue-22-after-mobile.png',
  'issue-22-before-desktop.png', 'issue-22-after-desktop.png',
];
const RECIPE_ID = 'recipe-reviewed-basil';
const SOURCE_URL = 'https://example.test/recipes/basil-pasta';
const RAW_LINE = 'to 4 basil leaves';

let server;
let baseUrl;
let browser;
const completedCaptures = new Set();

const json = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

async function launchBrowser() {
  return launchE2eBrowser(chromium, {
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-threaded-animation',
      '--disable-threaded-scrolling',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=1',
    ],
  });
}

before(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  server = createServer((request, response) => {
    const requestPath = request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0];
    const filePath = normalize(join(DOCS, requestPath));
    if (!filePath.startsWith(DOCS) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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
  try {
    if (completedCaptures.size !== 2) return;
    assert.deepEqual(readdirSync(EVIDENCE).sort(), [...EXPECTED_EVIDENCE].sort());
    for (const name of EXPECTED_EVIDENCE) {
      const bytes = readFileSync(join(EVIDENCE, name));
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} must be a PNG`);
    }
    if (CAPTURE_EVIDENCE) {
      mkdirSync(CANONICAL_EVIDENCE, { recursive: true });
      for (const name of EXPECTED_EVIDENCE) copyFileSync(join(EVIDENCE, name), join(CANONICAL_EVIDENCE, name));
    }
  } finally {
    rmSync(EVIDENCE, { recursive: true, force: true });
  }
});

async function settledScreenshot(page, name) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  let previous = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'device' });
    if (previous?.equals(current)) {
      writeFileSync(join(EVIDENCE, name), current);
      return;
    }
    previous = current;
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  }
  assert.fail(`${name} did not reach two byte-identical settled browser frames`);
}

function recipeItem(recipe, updatedAt = 1000) {
  return {
    id: RECIPE_ID,
    author: null,
    createdAt: 900,
    updatedAt,
    provenance: {
      sourceType: 'url', sourceUrl: SOURCE_URL, importedAt: 800,
      extractorMethod: 'json-ld', extractorVersion: 'extractor-v3',
    },
    recipe,
  };
}

async function createPage(viewport, evidenceLabel) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce' });
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

  let authorityRecipe = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Basil Pasta',
    recipeYield: '2 servings', recipeIngredient: [RAW_LINE, '8 oz pasta'],
    recipeInstructions: [{ '@type': 'HowToStep', position: 1, text: 'Toss and serve.' }],
  };
  let updatedAt = 1000;
  let reviewRequests = 0;
  let normalizationRequests = 0;
  let pantryMutations = 0;
  let workspace = { householdId: 'household-home', revision: 0, plan: [], cart: [], pantry: [], shoppingChecked: {}, manualItems: [], recentMutations: [] };

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/household') return json(route, { household: { id: 'household-home', name: 'Our kitchen' }, member: { id: 'member-kay', displayName: 'Kaysser', role: 'owner', sub: 'kay' } });
    if (url.pathname === '/api/community' && request.method() === 'GET') return json(route, { recipes: [recipeItem(authorityRecipe, updatedAt)], nextCursor: null });
    if (url.pathname === '/api/workspace' && request.method() === 'GET') return json(route, workspace);
    if (url.pathname === '/api/workspace' && request.method() === 'PATCH') {
      const body = JSON.parse(request.postData() || '{}');
      if (body.op === 'cart.upsertSelection') workspace = { ...workspace, revision: workspace.revision + 1, cart: [body.payload.selection] };
      if (body.op?.startsWith('pantry.')) pantryMutations += 1;
      return json(route, workspace);
    }
    if (url.pathname === '/api/cooks' && request.method() === 'GET') return json(route, { events: [], reactions: [] });
    if (url.pathname === '/api/normalize') { normalizationRequests += 1; return json(route, { error: 'should_not_repeat_llm' }, 503); }
    if (url.pathname === '/api/recipe-mutations' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      if (body.op !== 'recipe.ingredient.review') return json(route, { error: `unexpected ${body.op}` }, 400);
      reviewRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(body.payload.id, RECIPE_ID);
      assert.equal(body.payload.expectedUpdatedAt, updatedAt);
      assert.equal(Object.hasOwn(body.payload, 'raw'), false, 'immutable source line is not client writable');
      assert.equal(Object.hasOwn(body.payload, 'sourceUrl'), false, 'immutable provenance is not client writable');
      updatedAt += 1;
      authorityRecipe = {
        ...authorityRecipe,
        ingredientNormalizations: [{
          id: body.payload.ingredientId,
          raw: RAW_LINE,
          ...body.payload.correction,
          reviewStatus: 'reviewed', parserVersion: 2,
          reviewedAt: updatedAt, reviewedBy: { sub: 'kay', name: 'Kaysser Kayyali' },
        }],
      };
      return json(route, { recipes: [recipeItem(authorityRecipe, updatedAt)] });
    }
    return json(route, { error: `unhandled ${request.method()} ${url.pathname}` }, 404);
  });

  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.stack || error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) browserErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/api/normalize')) browserErrors.push(`${response.status()} ${response.url()}`); });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.panel === 'week', null, { timeout: 60_000 });
  await page.locator('button[data-panel="recipes"]').click();
  await page.waitForFunction(() => document.body.dataset.panel === 'recipes', null, { timeout: 60_000 });
  await page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`).click();
  await page.locator('#detail-modal.open').waitFor();
  await settledScreenshot(page, `issue-22-before-${evidenceLabel}.png`);
  return { context, page, browserErrors, stats: () => ({ reviewRequests, normalizationRequests, pantryMutations }) };
}

async function completeReviewedCorrection(page, { alreadyOpen = false } = {}) {
  const action = page.locator('.ingredient-correction-action').first();
  assert.equal(await action.getAttribute('aria-label'), `Correct ${RAW_LINE}`);
  const box = await action.boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44, `correction action must be at least 44px: ${JSON.stringify(box)}`);
  if (!alreadyOpen) await action.click();

  const dialog = page.getByRole('dialog', { name: 'Correct ingredient' });
  await dialog.waitFor();
  await assert.rejects(() => dialog.getByLabel('Original source line').fill('forged'), /not editable|not fillable|not enabled|not an <input>/i);
  assert.equal(await dialog.getByLabel('Original source line').textContent(), RAW_LINE);
  const source = dialog.getByRole('link', { name: 'Open import source' });
  assert.equal(await source.getAttribute('href'), SOURCE_URL);
  assert.equal(await source.getAttribute('data-feedback'), 'touch');
  assert.equal(await action.getAttribute('data-feedback'), 'select');
  assert.match(await dialog.getByText(/json-ld/i).textContent(), /extractor-v3/i);
  assert.match(await dialog.getByText(/not reviewed/i).textContent(), /not reviewed/i);

  await dialog.getByLabel('Amount state').selectOption('unknown');
  assert.equal(await dialog.getByLabel('Amount', { exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByLabel('Measurement family').isDisabled(), true);
  assert.deepEqual(await dialog.evaluate(() => ['ingredient-correction-amount-group', 'ingredient-correction-family-group', 'ingredient-correction-unit-group', 'ingredient-correction-count-label-group']
    .map((id) => ({ id, hidden: document.getElementById(id).hidden, display: getComputedStyle(document.getElementById(id)).display }))), [
    { id: 'ingredient-correction-amount-group', hidden: true, display: 'none' },
    { id: 'ingredient-correction-family-group', hidden: true, display: 'none' },
    { id: 'ingredient-correction-unit-group', hidden: true, display: 'none' },
    { id: 'ingredient-correction-count-label-group', hidden: true, display: 'none' },
  ]);
  await dialog.getByLabel('Ingredient name').fill('basil');
  await dialog.getByLabel('Amount state').selectOption('numeric');
  await dialog.getByLabel('Amount', { exact: true }).fill('4 to 2');
  await dialog.getByLabel('Measurement family').selectOption('count');
  await dialog.getByLabel('Unit').selectOption('count');
  await dialog.getByLabel('Count label').selectOption('leaf');
  const save = dialog.getByRole('button', { name: 'Save reviewed correction' });
  assert.equal(await save.getAttribute('data-feedback'), 'commit');
  await save.click();
  assert.match(await dialog.locator('#ingredient-correction-error').textContent(), /range|smaller/i);
  await dialog.getByLabel('Amount', { exact: true }).fill('2 to 4');
  const pendingObserved = page.evaluate(() => new Promise((resolve) => {
    const modal = document.getElementById('ingredient-correction-modal');
    const saveButton = document.getElementById('ingredient-correction-save');
    const pendingText = document.getElementById('ingredient-correction-pending');
    const observe = new MutationObserver(() => {
      if (modal?.getAttribute('aria-busy') === 'true') {
        observe.disconnect();
        resolve({ disabled: saveButton?.disabled, pending: pendingText?.textContent || '' });
      }
    });
    observe.observe(modal, { attributes: true, subtree: true, childList: true, characterData: true });
    setTimeout(() => { observe.disconnect(); resolve(null); }, 1000);
  }));
  await save.click();
  const observed = await pendingObserved;
  assert.deepEqual(observed, { disabled: true, pending: 'Saving reviewed correction…' });
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('Reviewed', { exact: true }).waitFor();
  assert.match(await page.locator('#toast').textContent(), /reviewed ingredient correction saved/i);
  assert.match(await page.locator('.detail-ing-item').first().innerText(), /2–4 basil leaves/i);
}

test('mobile reviews malformed ingredient evidence, persists it, and reuses it downstream without another LLM call', { timeout: 120_000 }, async () => {
  const { context, page, browserErrors, stats } = await createPage({ width: 402, height: 874 }, 'mobile');
  try {
    const keyboardAction = page.getByRole('button', { name: `Correct ${RAW_LINE}` });
    await keyboardAction.focus();
    await page.keyboard.press('Enter');
    const keyboardDialog = page.getByRole('dialog', { name: 'Correct ingredient' });
    await keyboardDialog.waitFor();
    assert.deepEqual(await page.locator('#detail-modal').evaluate((element) => ({
      inert: element.hasAttribute('inert'), hidden: element.getAttribute('aria-hidden'), modal: element.getAttribute('aria-modal'),
    })), { inert: true, hidden: 'true', modal: null });
    assert.equal(stats().pantryMutations, 0, 'Enter on Correct must not toggle Pantry');
    await page.keyboard.press('Escape');
    await keyboardDialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.locator('#detail-modal').evaluate((element) => ({
      inert: element.hasAttribute('inert'), hidden: element.getAttribute('aria-hidden'), modal: element.getAttribute('aria-modal'),
    })), { inert: false, hidden: null, modal: 'true' });
    await keyboardAction.focus();
    await page.keyboard.press('Space');
    await keyboardDialog.waitFor();
    assert.equal(stats().pantryMutations, 0, 'Space on Correct must not toggle Pantry');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('body *')].map((element) => {
        const box = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id, className: String(element.className || ''), left: box.left, right: box.right, width: box.width };
      }).filter((row) => row.right > document.documentElement.clientWidth + 1 || row.left < -1).slice(0, 20),
    }));
    assert.equal(overflow.scrollWidth <= overflow.width, true, `200% text must not overflow the document: ${JSON.stringify(overflow)}`);
    await completeReviewedCorrection(page, { alreadyOpen: true });
    const trigger = page.getByRole('button', { name: `Correct ${RAW_LINE}` });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Correct ingredient' });
    assert.match(await dialog.getByText(/reviewed by/i).textContent(), /Kaysser/i);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction((label) => document.activeElement?.getAttribute('aria-label') === label,
      `Correct ${RAW_LINE}`);

    await page.locator('#dm-add-all-btn').click();
    await page.locator('#detail-close-btn').click();
    await page.locator('button[data-panel="cart"]').click();
    await page.waitForFunction(() => document.body.dataset.panel === 'cart');
    assert.match(await page.locator('#cart-grid').innerText(), /Basil[\s\S]*5 leaves/i);

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('button[data-panel="recipes"]').click();
    await page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`).click();
    await page.getByText('Reviewed', { exact: true }).waitFor();
    assert.match(await page.locator('.detail-ing-item').first().innerText(), /2–4 basil leaves/i);
    const reloadedTrigger = page.getByRole('button', { name: `Correct ${RAW_LINE}` });
    await reloadedTrigger.click();
    const reloadedDialog = page.getByRole('dialog', { name: 'Correct ingredient' });
    assert.equal(await reloadedDialog.getByLabel('Original source line').textContent(), RAW_LINE);
    assert.equal(await reloadedDialog.getByRole('link', { name: 'Open import source' }).getAttribute('href'), SOURCE_URL);
    assert.match(await reloadedDialog.getByText(/reviewed by/i).textContent(), /Kaysser/i);
    await page.keyboard.press('Escape');
    assert.deepEqual(stats(), { reviewRequests: 1, normalizationRequests: 0, pantryMutations: 0 });
    assert.deepEqual(browserErrors, []);
    await settledScreenshot(page, 'issue-22-after-mobile.png');
    completedCaptures.add('mobile');
  } finally { await context.close(); }
});

test('desktop correction dialog is accessible, compact, and free of horizontal overflow', { timeout: 90_000 }, async () => {
  const { context, page, browserErrors } = await createPage({ width: 1440, height: 900 }, 'desktop');
  try {
    const action = page.getByRole('button', { name: `Correct ${RAW_LINE}` });
    await action.click();
    const dialog = page.getByRole('dialog', { name: 'Correct ingredient' });
    await dialog.waitFor();
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    assert.equal(await dialog.getByLabel('Ingredient name').evaluate((element) => document.activeElement === element), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.width <= 640 && bounds.height <= 850, JSON.stringify(bounds));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await action.evaluate((element) => document.activeElement === element), true);
    await action.click();
    await completeReviewedCorrection(page, { alreadyOpen: true });
    assert.deepEqual(browserErrors, []);
    await settledScreenshot(page, 'issue-22-after-desktop.png');
    completedCaptures.add('desktop');
  } finally { await context.close(); }
});
