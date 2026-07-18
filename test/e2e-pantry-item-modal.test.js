import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { normalizePantry } from '../docs/js/lib/pantry.js';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';
import { launchE2eBrowser } from './helpers/playwright-browser.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const EVIDENCE = join(HERE, 'evidence');
const CAPTURE_ISSUE20_EVIDENCE = process.env.COOKBOOK_ISSUE20_CAPTURE === '1';

let server;
let baseUrl;
let browser;

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function launchBrowser() {
  return launchE2eBrowser(chromium, { headless: true });
}

before(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  server = createServer((request, response) => {
    const requestPath = request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0];
    const filePath = normalize(join(DOCS, requestPath));
    if (!filePath.startsWith(DOCS) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    const types = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
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

async function createPantryPage(viewport = { width: 1440, height: 900 }, options = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: Boolean(options.touch) });
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
    window.__pantryFeedbackEvents = [];
    window.__pantryHaptics = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern) => { window.__pantryHaptics.push(pattern); return true; },
    });
    document.addEventListener('cookbook:feedback', (event) => window.__pantryFeedbackEvents.push(event.detail));
  }, { tokenValue: token });
  if (options.disableIndexedDb) {
    await context.addInitScript(() => {
      Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
    });
  }

  const pantry = normalizePantry([
    {
      id: 'pantry-olive-oil', raw: '2 cups Olive Oil', rawEvidence: ['olive oil from bottle', '2 cups Olive Oil'],
      name: 'olive oil', displayName: 'Olive Oil',
      quantity: 16, unit: 'ounce', kind: 'divisible', countLabel: '', category: 'pantry',
      confidence: 0.91, normalizationVersion: 1, updatedAt: 100,
    },
    {
      id: 'pantry-oil-bottles', raw: '2 bottles olive oil', name: 'olive oil', displayName: 'Olive Oil',
      quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', category: 'pantry',
      confidence: 0.88, normalizationVersion: 1, updatedAt: 101,
    },
    {
      id: 'pantry-eggs', raw: 'eggs', rawEvidence: ['eggs'], name: 'egg', displayName: 'Eggs',
      quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', category: 'dairy-eggs',
      confidence: 0.4, normalizationVersion: 1, updatedAt: 102, amountState: 'unknown',
    },
    {
      id: 'pantry-basil', raw: 'fresh basil', rawEvidence: ['fresh basil'], name: 'basil', displayName: 'Basil',
      quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', category: 'produce',
      confidence: 0.9, normalizationVersion: 2, updatedAt: 103, amountState: 'qualitative',
    },
  ]);
  let workspace = {
    householdId: 'household-home', revision: 1, plan: [], cart: [], pantry,
    shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 101,
  };
  let recipeAuthority = structuredClone(options.recipes || []);
  const mutations = [];

  await context.route('https://images.example.test/**', (route) => route.fulfill({
    path: join(DOCS, 'icons', 'icon-192.png'),
    contentType: 'image/png',
  }));
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/household') return json(route, {
      household: { id: 'household-home', name: 'Our kitchen' },
      member: { id: 'member-kay', displayName: 'Kaysser', role: 'owner', sub: 'kay' },
    });
    if (url.pathname === '/api/community' && request.method() === 'GET') {
      return json(route, {
        recipes: recipeAuthority.map((recipe) => ({
          id: recipe._id,
          recipe,
          author: { sub: 'kay', displayName: 'Kaysser' },
          createdAt: 1,
          updatedAt: 1,
        })),
        nextCursor: null,
      });
    }
    if (url.pathname === '/api/recipe-mutations' && request.method() === 'POST') {
      const mutation = request.postDataJSON();
      if (mutation.op === 'recipe.delete') {
        recipeAuthority = recipeAuthority.filter((recipe) => String(recipe._id || recipe.id) !== String(mutation.payload.id));
      } else if (mutation.op === 'recipe.update' || mutation.op === 'recipe.create') {
        const item = structuredClone(mutation.payload.item);
        const id = String(mutation.payload.id || item._id || item.id);
        item._id ||= id;
        item.id ||= id;
        recipeAuthority = [...recipeAuthority.filter((recipe) => String(recipe._id || recipe.id) !== id), item];
      }
      return json(route, {
        recipes: recipeAuthority.map((recipe) => ({
          id: recipe._id || recipe.id, recipe,
          author: { sub: 'kay', displayName: 'Kaysser' }, createdAt: 1, updatedAt: Date.now(),
        })),
      });
    }
    if (url.pathname === '/api/workspace' && request.method() === 'GET') return json(route, workspace);
    if (url.pathname === '/api/workspace' && request.method() === 'PATCH') {
      const mutation = request.postDataJSON();
      mutations.push(mutation);
      options.onPatch?.(mutation);
      if (options.patchGate) await options.patchGate;
      if (options.patchFailureStatus) return json(route, { error: 'workspace_unavailable' }, options.patchFailureStatus);
      if (mutation.baseRevision !== workspace.revision) return json(route, { error: 'revision_conflict', workspace }, 409);
      workspace = {
        ...applyWorkspaceOperation(workspace, mutation),
        revision: workspace.revision + 1,
        updatedAt: mutation.createdAt,
        recentMutations: [...workspace.recentMutations, mutation.mutationId],
      };
      return json(route, workspace);
    }
    if (url.pathname === '/api/cooks' && request.method() === 'GET') return json(route, { events: [], reactions: [] });
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
  await page.locator('button[data-panel="pantry"]').click();
  await page.waitForFunction(() => document.body.dataset.panel === 'pantry', null, { timeout: 60_000 });
  await page.locator('[data-pantry-id="pantry-olive-oil"]').waitFor({ state: 'visible', timeout: 60_000 });
  return {
    context, page, browserErrors, mutations, workspace: () => workspace,
    setWorkspace: (next) => { workspace = next; },
  };
}

test('desktop Pantry row opens an immediately editable item modal', { timeout: 60_000 }, async () => {
  const { context, page, browserErrors } = await createPantryPage();
  try {
    const beforePath = join(EVIDENCE, 'issue-20-before-desktop.png');
    if (CAPTURE_ISSUE20_EVIDENCE && !existsSync(beforePath)) await page.screenshot({ path: beforePath, fullPage: true });
    const modal = page.locator('#pantry-item-modal');
    assert.equal(await modal.getAttribute('aria-hidden'), 'true');
    assert.equal(await modal.getAttribute('inert'), '');
    assert.equal((await modal.ariaSnapshot()).trim(), '', 'closed Pantry editor contributes no accessibility tree');
    await page.locator('[data-pantry-id="pantry-olive-oil"]').click();
    assert.equal(await modal.count(), 1, 'clicking the Pantry row should expose an item editor modal');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.getAttribute('role'), 'dialog');
    assert.equal(await modal.getAttribute('aria-modal'), 'true');
    assert.equal(await modal.getAttribute('aria-labelledby'), 'pantry-item-title');
    assert.equal(await modal.getAttribute('aria-hidden'), null);
    assert.equal(await modal.getAttribute('inert'), null);
    assert.equal(await page.locator('#pantry-item-name').inputValue(), 'Olive Oil');
    assert.equal(await page.locator('#pantry-item-family').inputValue(), 'fluid');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '2');
    assert.equal(await page.locator('#pantry-item-unit').inputValue(), 'cup');
    assert.match(await modal.innerText(), /Original text[\s\S]*2 cups Olive Oil/i);
    assert.match(await modal.innerText(), /olive oil from bottle/i, 'earlier unique evidence remains visible');
    await page.locator('#pantry-item-family').selectOption('unknown');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '');
    assert.equal(await page.locator('#pantry-item-quantity').isDisabled(), true);
    assert.equal(await page.locator('#pantry-item-quantity-group').isHidden(), true);
    assert.match(await page.locator('#pantry-item-status').textContent(), /clears the trusted amount/i);
    assert.match(await page.locator('#pantry-item-raw').textContent(), /2 cups Olive Oil/i, 'Not sure retains raw context');
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});

test('selected Pantry ingredient discovers canonical recipe uses and opens detail accessibly', { timeout: 60_000 }, async () => {
  const recipes = [
    { _id: 'basil-pasta', name: 'Basil Pasta', image: 'https://images.example.test/basil-pasta.jpg', recipeIngredient: ['2 basil leaves', '1 tomato', 'pasta'], recipeInstructions: ['Cook.'] },
    { _id: 'green-soup', name: 'Green Soup', recipeIngredient: ['basil', '2 onions', '1 cup stock'] },
    {
      _id: 'herb-toast',
      name: 'Herb Toast with a deliberately long household recipe title that must wrap without horizontal overflow',
      recipeIngredient: ['fresh basil, torn into very small pieces for serving across the entire platter', '4 slices bread', '1 clove garlic'],
    },
    { _id: 'summer-salad', name: 'Summer Salad', recipeIngredient: ['basil leaves', '2 tomatoes', 'olive oil'] },
    { _id: 'basilisk-stew', name: 'Basilisk Stew', recipeIngredient: ['1 basilisk steak', '1 onion'] },
    { _id: 'thai-sauce', name: 'Thai Sauce', recipeIngredient: ['1 cup thai basil sauce', '1 lime'] },
  ];
  const { context, page, browserErrors } = await createPantryPage({ width: 402, height: 874 }, { touch: true, recipes });
  try {
    const pantryRow = page.locator('[data-pantry-id="pantry-basil"]');
    assert.equal(await pantryRow.count(), 1, 'basil Pantry fixture is rendered');
    await pantryRow.click({ timeout: 5_000 });
    const modal = page.locator('#pantry-item-modal');
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    const discovery = page.locator('#pantry-recipe-discovery');
    assert.equal(await discovery.count(), 1, 'Pantry editor should expose recipe discovery');
    assert.equal(await discovery.getByRole('heading', { name: 'Recipes using Basil' }).count(), 1);
    const rows = discovery.locator('[data-pantry-recipe-id]');
    assert.equal(await rows.count(), 3, 'the compact initial result set is bounded');
    assert.match(await rows.first().innerText(), /(?:All|Some|Few) · \d+ of \d+ Pantry names/i, 'coverage sorts before the stable recipe tie-breakers');
    const basilPasta = rows.filter({ hasText: 'Basil Pasta' });
    assert.equal(await basilPasta.count(), 1, 'canonical basil leaves recipe is in the initial set');
    assert.match(await basilPasta.innerText(), /2 basil leaves/i, 'immutable original line is visible evidence');
    assert.equal(await basilPasta.locator('img').getAttribute('src'), 'https://images.example.test/basil-pasta.jpg');
    await basilPasta.locator('img').evaluate((image) => image.dispatchEvent(new Event('error')));
    assert.equal(await basilPasta.locator('img').count(), 0, 'failed lazy images are removed');
    assert.equal(await basilPasta.locator('.pantry-recipe-image-fallback').count(), 1, 'failed lazy images get a useful fallback');
    assert.equal(await discovery.getByText('Basilisk Stew').count(), 0, 'arbitrary substrings never match');
    assert.equal(await discovery.getByText('Thai Sauce').count(), 0, 'compound sauce identity never matches basil');
    assert.match(await discovery.innerText(), /Pantry names, not exact quantities/i);

    const toggleNode = discovery.locator('#pantry-recipe-toggle');
    assert.equal(await toggleNode.isHidden(), false, `expected more than three canonical matches:\n${await discovery.innerText()}`);
    const toggle = discovery.getByRole('button', { name: 'View all recipes' });
    await toggle.tap();
    assert.equal(await rows.count(), 4);
    assert.equal(await toggleNode.evaluate((element) => element === document.activeElement), true, 'expansion preserves focus');
    assert.equal(await toggleNode.getAttribute('aria-expanded'), 'true');
    const bodyScroll = page.locator('.pantry-item-body');
    await bodyScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await toggleNode.tap();
    assert.equal(await rows.count(), 3);
    assert.equal(await toggleNode.evaluate((element) => element === document.activeElement), true, 'View fewer preserves focus');
    assert.equal(await toggleNode.getAttribute('aria-expanded'), 'false');
    const collapsedScroll = await bodyScroll.evaluate((element) => ({ top: element.scrollTop, max: Math.max(0, element.scrollHeight - element.clientHeight) }));
    assert.ok(Math.abs(collapsedScroll.top - collapsedScroll.max) <= 1, JSON.stringify(collapsedScroll));
    await toggleNode.tap();
    assert.equal(await rows.count(), 4);
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktopModal = await modal.boundingBox();
    const desktopRows = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    assert.ok(desktopModal && desktopModal.width <= 600, `desktop modal stays compact: ${JSON.stringify(desktopModal)}`);
    assert.ok(desktopRows.every((height) => height >= 44 && height <= 120), JSON.stringify(desktopRows));

    await page.locator('html').evaluate((element) => { element.style.fontSize = '200%'; });
    const overflowAt200 = await page.locator('#pantry-item-modal, .pantry-item-body, .pantry-recipe-row').evaluateAll((elements) => elements.map((element) => ({
      id: element.id || element.className,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    })));
    assert.ok(overflowAt200.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 1), JSON.stringify(overflowAt200));
    await page.locator('html').evaluate((element) => { element.style.fontSize = ''; });
    await page.setViewportSize({ width: 390, height: 844 });

    const target = discovery.locator('[data-pantry-recipe-id="basil-pasta"]');
    const targetBox = await target.boundingBox();
    assert.ok(targetBox && targetBox.height >= 44, JSON.stringify(targetBox));
    await target.tap();
    await page.locator('#detail-modal').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#dm-title').textContent(), 'Basil Pasta');
    assert.equal(await page.locator('#detail-modal').getAttribute('aria-modal'), 'true');
    assert.equal(await modal.getAttribute('aria-modal'), null, 'only the top modal owns aria-modal');
    assert.equal(await modal.getAttribute('inert'), '');
    assert.equal((await modal.ariaSnapshot()).trim(), '');

    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.getAttribute('aria-modal'), 'true');
    assert.equal(await target.evaluate((element) => element === document.activeElement), true, 'detail Escape restores the selected result');

    await target.tap();
    await page.locator('#detail-modal').waitFor({ state: 'visible' });
    await page.locator('#detail-close-btn').click();
    await modal.waitFor({ state: 'visible' });
    assert.equal(await target.evaluate((element) => element === document.activeElement), true, 'detail Back control restores the selected result');
    await page.keyboard.press('Escape');
    assert.equal(await pantryRow.evaluate((element) => element === document.activeElement), true, 'second Escape returns to the Pantry row');
    assert.equal(await page.locator('body').evaluate((element) => element.style.overflow), '', 'nested modal teardown restores page scrolling');
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});

test('two production recipe runtimes refresh an open Pantry modal after remote rename and delete without losing its draft', { timeout: 90_000 }, async () => {
  const recipe = { _id: 'shared-pesto', id: 'shared-pesto', name: 'Shared Pesto', recipeIngredient: ['basil'], recipeInstructions: ['Mix.'] };
  const fixture = await createPantryPage({ width: 1280, height: 900 }, { recipes: [recipe] });
  const { context, page: first, browserErrors } = fixture;
  const second = await context.newPage();
  const secondErrors = [];
  second.on('pageerror', (error) => secondErrors.push(error.message));
  second.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) secondErrors.push(message.text()); });
  try {
    await second.goto(baseUrl, { waitUntil: 'networkidle' });
    await second.locator('button[data-panel="pantry"]').click();
    await second.locator('[data-pantry-id="pantry-basil"]').click();
    const modal = second.locator('#pantry-item-modal');
    await modal.waitFor({ state: 'visible' });
    await second.locator('#pantry-item-name').fill('Unsaved basil draft');
    assert.match(await second.locator('#pantry-recipe-discovery').innerText(), /Shared Pesto/);

    await first.locator('button[data-panel="recipes"]').click();
    const card = first.locator('.recipe-card[data-id="shared-pesto"]');
    await card.locator('[data-action="edit"]').click();
    await first.locator('#f-name').fill('Renamed Shared Pesto');
    const renamed = first.waitForResponse((response) => new URL(response.url()).pathname === '/api/recipe-mutations'
      && response.request().postDataJSON()?.op === 'recipe.update' && response.ok());
    await first.locator('#save-recipe-btn').click();
    await renamed;
    await second.waitForFunction(() => document.getElementById('pantry-recipe-discovery')?.textContent.includes('Renamed Shared Pesto'));
    assert.equal(await second.locator('#pantry-item-name').inputValue(), 'Unsaved basil draft');

    first.once('dialog', (dialog) => dialog.accept());
    const deleted = first.waitForResponse((response) => new URL(response.url()).pathname === '/api/recipe-mutations'
      && response.request().postDataJSON()?.op === 'recipe.delete' && response.ok());
    await first.locator('.recipe-card[data-id="shared-pesto"] [data-action="delete"]').click();
    await deleted;
    await second.waitForFunction(() => /No recipes use this item yet/i.test(document.getElementById('pantry-recipe-discovery')?.textContent || ''));
    assert.equal(await second.locator('#pantry-item-name').inputValue(), 'Unsaved basil draft');
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(secondErrors, []);
  } finally {
    await context.close();
  }
});

test('desktop edit converts, persists by stable ID, removes exactly, and undoes', { timeout: 60_000 }, async () => {
  const { context, page, browserErrors, mutations, workspace } = await createPantryPage();
  try {
    const target = page.locator('[data-pantry-id="pantry-olive-oil"]');
    await page.evaluate(() => { window.__pantryFeedbackEvents.length = 0; });
    await target.click();
    assert.deepEqual((await page.evaluate(() => window.__pantryFeedbackEvents)).map(({ type }) => type), ['select']);
    await page.locator('#pantry-item-family').selectOption('solid');
    assert.equal((await page.evaluate(() => window.__pantryFeedbackEvents)).at(-1).type, 'toggle-on');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '16', '2 cups becomes 16 water-equivalent ounces');
    assert.deepEqual(await page.locator('#pantry-item-unit option').evaluateAll((options) => options.map(({ value }) => value)), [
      'ounce', 'pound', 'gram', 'kilogram',
    ]);
    await page.locator('#pantry-item-name').fill('Avocado Oil');
    if (CAPTURE_ISSUE20_EVIDENCE) await page.screenshot({ path: join(EVIDENCE, 'issue-20-after-desktop.png'), fullPage: true });
    const updateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('#pantry-item-save').click();
    await updateResponse;
    await page.locator('#pantry-item-modal').waitFor({ state: 'hidden' });
    const updatedRow = page.locator('[data-pantry-id="pantry-olive-oil"]');
    assert.match(await updatedRow.innerText(), /Avocado Oil/);
    assert.equal(await updatedRow.evaluate((element) => element === document.activeElement), true, 'focus returns to the edited row');
    assert.equal(await page.locator('[data-pantry-id="pantry-oil-bottles"]').count(), 1, 'same-name sibling survives the edit');
    assert.equal(mutations[0].op, 'pantry.update');
    assert.equal(mutations[0].payload.id, 'pantry-olive-oil');
    assert.equal(mutations[0].payload.item.raw, '16 ounces Avocado Oil');
    assert.deepEqual(mutations[0].payload.item.rawEvidence, ['olive oil from bottle', '2 cups Olive Oil', '16 ounces Avocado Oil']);
    assert.equal(mutations[0].payload.item.confidence, 1);
    assert.equal(mutations[0].payload.item.amountSource, 'manual');
    assert.equal(mutations[0].payload.item.normalizationVersion, 1);
    assert.ok(mutations[0].payload.item.updatedAt > 100, 'correction advances updatedAt');
    assert.equal(workspace().pantry.find(({ id }) => id === 'pantry-olive-oil').name, 'avocado oil');
    assert.deepEqual((await page.evaluate(() => window.__pantryFeedbackEvents)).map(({ type }) => type),
      ['select', 'toggle-on', 'commit', 'success']);

    await updatedRow.click();
    await page.keyboard.press('Escape');
    await page.locator('#pantry-item-modal').waitFor({ state: 'hidden' });
    assert.equal(await updatedRow.evaluate((element) => element === document.activeElement), true, 'Escape returns focus');

    await updatedRow.click();
    await page.locator('#pantry-item-remove').click();
    assert.equal(await page.locator('#pantry-remove-confirm').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'cancel-pantry-remove');
    await page.locator('[data-action="cancel-pantry-remove"]').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'pantry-item-remove');
    await page.locator('#pantry-item-remove').click();
    const removeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('[data-action="confirm-pantry-remove"]').click();
    await removeResponse;
    assert.equal(await page.locator('[data-pantry-id="pantry-olive-oil"]').count(), 0);
    assert.equal(await page.locator('[data-pantry-id="pantry-oil-bottles"]').count(), 1);
    assert.notEqual(await page.evaluate(() => document.activeElement?.dataset.pantryId), 'pantry-olive-oil', 'removal never focuses the deleted record');
    assert.ok(await page.evaluate(() => Boolean(document.activeElement?.dataset.pantryId)), 'removal focuses a remaining Pantry record');
    assert.deepEqual({ op: mutations[1].op, id: mutations[1].payload.id }, { op: 'pantry.remove', id: 'pantry-olive-oil' });
    assert.deepEqual((await page.evaluate(() => window.__pantryFeedbackEvents)).slice(-2).map(({ type }) => type),
      ['destructive', 'success']);

    const undoResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('#toast [data-toast-action]', { hasText: 'Undo' }).click();
    await undoResponse;
    await page.locator('[data-pantry-id="pantry-olive-oil"]').waitFor();
    assert.equal(mutations[2].op, 'pantry.restore');
    assert.equal(mutations[2].payload.expectedAbsent, true);
    assert.equal(mutations[2].payload.item.id, 'pantry-olive-oil');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.pantryId), 'pantry-olive-oil', 'Undo returns focus to the restored record');
    assert.deepEqual((await page.evaluate(() => window.__pantryFeedbackEvents)).slice(-2).map(({ type }) => type),
      ['commit', 'success']);
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});

test('two production tabs block stale remove after the other tab updates the same record', { timeout: 60_000 }, async () => {
  const fixture = await createPantryPage({ width: 1440, height: 900 }, { disableIndexedDb: true });
  const { context, page: first, mutations, workspace } = fixture;
  const second = await context.newPage();
  try {
    await second.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await second.locator('button[data-panel="pantry"]').waitFor({ state: 'visible', timeout: 10_000 });
    await second.locator('button[data-panel="pantry"]').click({ timeout: 10_000 });
    await second.locator('[data-pantry-id="pantry-olive-oil"]').waitFor({ state: 'visible', timeout: 10_000 });

    await first.locator('[data-pantry-id="pantry-olive-oil"]').click();
    await second.locator('[data-pantry-id="pantry-olive-oil"]').click();
    await second.locator('#pantry-item-quantity').fill('3');
    const updateResponse = second.waitForResponse((response) => response.request().method() === 'PATCH'
      && response.request().postDataJSON()?.op === 'pantry.update');
    await second.locator('#pantry-item-save').click();
    assert.equal((await updateResponse).status(), 200);

    await first.locator('#pantry-item-remove').click();
    const removeResponse = first.waitForResponse((response) => response.request().method() === 'PATCH'
      && response.request().postDataJSON()?.op === 'pantry.remove');
    await first.locator('[data-action="confirm-pantry-remove"]').click();
    assert.equal((await removeResponse).status(), 409);
    await first.locator('[data-pantry-id="pantry-olive-oil"]').waitFor();
    await first.waitForFunction(() => document.querySelector('[data-pantry-id="pantry-olive-oil"]')?.textContent.includes('3 cups'));
    assert.deepEqual(workspace().pantry.filter(({ id }) => id === 'pantry-olive-oil').map(({ id, quantity }) => ({ id, quantity })),
      [{ id: 'pantry-olive-oil', quantity: 24 }]);
    assert.equal(mutations.filter(({ op }) => op === 'pantry.remove').length, 1, 'same-record change prevents remove rebase');
    assert.equal(await first.locator('#pantry-item-modal').isVisible(), true, 'the conflict keeps the editor open');
    assert.match(await first.locator('#pantry-item-error').textContent(), /could not be removed.*changed.*restored.*review.*try again/i);
    assert.equal(await first.locator('#pantry-item-error').getAttribute('role'), 'alert');
    assert.deepEqual((await first.evaluate(() => window.__pantryFeedbackEvents)).slice(-2).map(({ type }) => type),
      ['destructive', 'blocked']);
  } finally {
    await context.close();
  }
});

test('production Undo collision keeps remotely recreated stable ID and shows actionable conflict', { timeout: 60_000 }, async () => {
  const fixture = await createPantryPage({ width: 1440, height: 900 }, { disableIndexedDb: true });
  const { context, page, mutations, workspace, setWorkspace } = fixture;
  try {
    const removed = structuredClone(workspace().pantry.find(({ id }) => id === 'pantry-olive-oil'));
    await page.locator('[data-pantry-id="pantry-olive-oil"]').click();
    await page.locator('#pantry-item-remove').click();
    const removeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('[data-action="confirm-pantry-remove"]').click();
    await removeResponse;
    const remote = normalizePantry([{ ...removed, raw: '3 cups Olive Oil', quantity: 24, updatedAt: 300 }])[0];
    setWorkspace({
      ...workspace(), revision: workspace().revision + 1, updatedAt: 300,
      pantry: [remote, ...workspace().pantry],
    });
    const restoreResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('#toast [data-toast-action]', { hasText: 'Undo' }).click();
    assert.equal((await restoreResponse).status(), 409);
    await page.locator('[data-pantry-id="pantry-olive-oil"]').waitFor();
    assert.deepEqual(workspace().pantry.filter(({ id }) => id === removed.id).map(({ id, quantity }) => ({ id, quantity })),
      [{ id: removed.id, quantity: 24 }]);
    assert.deepEqual(mutations.filter(({ op }) => op === 'pantry.restore').map(({ payload }) => ({
      id: payload.item.id, expectedAbsent: payload.expectedAbsent,
    })), [{ id: removed.id, expectedAbsent: true }]);
    assert.equal(mutations.some(({ op }) => op === 'pantry.add'), false);
    assert.match(await page.locator('#toast').textContent(), /could not restore.*shared Pantry changed/i);
    assert.deepEqual((await page.evaluate(() => window.__pantryFeedbackEvents)).slice(-2).map(({ type }) => type),
      ['commit', 'blocked']);
  } finally {
    await context.close();
  }
});

test('production editor turns low-confidence eggs into trusted 12-count authority and reopens known', { timeout: 60_000 }, async () => {
  const { context, page, mutations, workspace } = await createPantryPage();
  try {
    const eggs = page.locator('[data-pantry-id="pantry-eggs"]');
    await eggs.click();
    assert.equal(await page.locator('#pantry-item-family').inputValue(), 'unknown');
    await page.locator('#pantry-item-family').selectOption('count');
    await page.locator('#pantry-item-quantity').fill('12');
    await page.locator('#pantry-item-unit').selectOption('item');
    const response = page.waitForResponse((value) => new URL(value.url()).pathname === '/api/workspace'
      && value.request().method() === 'PATCH');
    await page.locator('#pantry-item-save').click();
    await response;
    await eggs.click();
    assert.equal(await page.locator('#pantry-item-family').inputValue(), 'count');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '12');
    const record = workspace().pantry.find(({ id }) => id === 'pantry-eggs');
    assert.deepEqual({ amountState: record.amountState, quantity: record.quantity, unit: record.unit },
      { amountState: 'known', quantity: 12, unit: 'count' });
    assert.equal(record.confidence, 1);
    assert.equal(record.amountSource, 'manual');
    assert.equal(mutations[0].payload.item.raw, '12 items Eggs');
  } finally {
    await context.close();
  }
});

test('production Escape during pending failure is refused and preserves the draft and feedback', { timeout: 60_000 }, async () => {
  let releasePatch;
  let observePatch;
  const patchGate = new Promise((resolve) => { releasePatch = resolve; });
  const patchSeen = new Promise((resolve) => { observePatch = resolve; });
  const { context, page } = await createPantryPage({ width: 1440, height: 900 }, {
    patchGate, patchFailureStatus: 500, onPatch: observePatch, disableIndexedDb: true,
  });
  try {
    await page.locator('[data-pantry-id="pantry-olive-oil"]').click();
    await page.locator('#pantry-item-name').fill('Draft Oil');
    await page.locator('#pantry-item-save').click();
    await patchSeen;
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#pantry-item-modal').isVisible(), true);
    assert.equal(await page.locator('#pantry-item-name').inputValue(), 'Draft Oil');
    assert.match(await page.locator('#pantry-item-status').textContent(), /saving/i);
    releasePatch();
    await page.locator('#pantry-item-error').filter({ hasText: /could not be saved/i }).waitFor();
    assert.equal(await page.locator('#pantry-item-modal').isVisible(), true);
    assert.equal(await page.locator('#pantry-item-name').inputValue(), 'Draft Oil');
    assert.equal(await page.locator('#pantry-item-error').getAttribute('role'), 'alert');
    assert.equal(await page.locator('#pantry-item-status').getAttribute('role'), 'status');
    assert.deepEqual((await page.evaluate(() => window.__pantryFeedbackEvents)).slice(-2).map(({ type }) => type),
      ['commit', 'blocked']);
  } finally {
    releasePatch?.();
    await context.close();
  }
});

test('mobile add-new is accessible, trapped, safe-area sized, semantically touch-provenant, and authoritative', { timeout: 60_000 }, async () => {
  const { context, page, browserErrors, mutations, workspace } = await createPantryPage({ width: 402, height: 874 }, { touch: true });
  try {
    const input = page.locator('#pantry-input');
    const addButton = page.locator('#pantry-add-btn');
    await input.fill('3 bottles sparkling water');
    await page.evaluate(() => { window.__pantryFeedbackEvents.length = 0; window.__pantryHaptics.length = 0; });
    await addButton.tap();
    const modal = page.locator('#pantry-item-modal');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pantry-item-title').textContent(), 'Add Pantry item');
    assert.equal(await page.locator('#pantry-item-name').inputValue(), 'Sparkling Water');
    assert.equal(await page.locator('#pantry-item-family').inputValue(), 'count');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '3');
    assert.equal(await page.locator('#pantry-item-unit').inputValue(), 'bottle');
    assert.deepEqual((await page.evaluate(() => window.__pantryFeedbackEvents)).map(({ type }) => type), ['select']);
    assert.deepEqual(await modal.evaluate((element) => {
      const style = getComputedStyle(element);
      return { transitionDuration: style.transitionDuration, animationDuration: style.animationDuration };
    }), { transitionDuration: '0s', animationDuration: '0s' });

    await page.locator('#pantry-item-close').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#pantry-item-save').evaluate((element) => element === document.activeElement), true, 'focus wraps inside the dialog');
    await page.locator('#pantry-item-name').focus();

    const geometry = await page.evaluate(() => {
      const modalRect = document.getElementById('pantry-item-modal').getBoundingClientRect();
      const targets = ['pantry-item-close', 'pantry-item-name', 'pantry-item-family', 'pantry-item-quantity', 'pantry-item-unit', 'pantry-item-save']
        .map((id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return { id, width: Math.round(rect.width), height: Math.round(rect.height) };
        });
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        modal: { left: Math.round(modalRect.left), right: Math.round(modalRect.right), top: Math.round(modalRect.top), bottom: Math.round(modalRect.bottom) },
        targets,
      };
    });
    console.log(`ISSUE20_MOBILE_GEOMETRY ${JSON.stringify(geometry)}`);
    assert.equal(geometry.documentWidth, geometry.viewportWidth, 'no horizontal page overflow');
    assert.ok(geometry.modal.left >= 0 && geometry.modal.right <= geometry.viewportWidth);
    assert.ok(geometry.modal.top >= 0 && geometry.modal.bottom <= 874);
    assert.ok(geometry.targets.every(({ width, height }) => width >= 44 && height >= 44), JSON.stringify(geometry.targets));
    if (CAPTURE_ISSUE20_EVIDENCE) await page.screenshot({ path: join(EVIDENCE, 'issue-20-after-mobile.png'), fullPage: true });

    const addResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('#pantry-item-save').tap();
    await addResponse;
    await modal.waitFor({ state: 'hidden' });
    const added = workspace().pantry.find(({ name }) => name === 'sparkling water');
    assert.ok(added?.id, 'new item reaches authoritative workspace with a stable ID');
    await page.locator(`[data-pantry-id="${added.id}"]`).waitFor();
    assert.equal(mutations[0].op, 'pantry.add');
    assert.equal(mutations[0].payload.item.countLabel, 'bottle');
    assert.equal(await input.inputValue(), '', 'accepted add clears the source field');
    const saveFeedback = (await page.evaluate(() => window.__pantryFeedbackEvents)).slice(-2);
    assert.deepEqual(saveFeedback.map(({ type }) => type), ['commit', 'success']);
    assert.ok(saveFeedback.every(({ modality, touchOrigin }) => modality === 'touch' && touchOrigin), JSON.stringify(saveFeedback));
    assert.ok((await page.evaluate(() => window.__pantryHaptics.length)) >= 3, 'open, commit, and success stay haptically reachable');
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});
