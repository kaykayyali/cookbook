import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { normalizePantry } from '../docs/js/lib/pantry.js';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const EVIDENCE = join(HERE, 'evidence');

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
  mkdirSync(EVIDENCE, { recursive: true });
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

async function createPantryPage(viewport = { width: 1440, height: 900 }) {
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

  const pantry = normalizePantry([
    {
      id: 'pantry-olive-oil', raw: '2 cups Olive Oil', name: 'olive oil', displayName: 'Olive Oil',
      quantity: 16, unit: 'ounce', kind: 'divisible', countLabel: '', category: 'pantry',
      confidence: 0.91, normalizationVersion: 1, updatedAt: 100,
    },
    {
      id: 'pantry-oil-bottles', raw: '2 bottles olive oil', name: 'olive oil', displayName: 'Olive Oil',
      quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', category: 'pantry',
      confidence: 0.88, normalizationVersion: 1, updatedAt: 101,
    },
  ]);
  let workspace = {
    householdId: 'household-home', revision: 1, plan: [], cart: [], pantry,
    shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 101,
  };
  const mutations = [];

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/household') return json(route, {
      household: { id: 'household-home', name: 'Our kitchen' },
      member: { id: 'member-kay', displayName: 'Kaysser', role: 'owner', sub: 'kay' },
    });
    if (url.pathname === '/api/community' && request.method() === 'GET') {
      return json(route, { recipes: [], nextCursor: null });
    }
    if (url.pathname === '/api/workspace' && request.method() === 'GET') return json(route, workspace);
    if (url.pathname === '/api/workspace' && request.method() === 'PATCH') {
      const mutation = request.postDataJSON();
      mutations.push(mutation);
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
  return { context, page, browserErrors, mutations, workspace: () => workspace };
}

test('desktop Pantry row opens an immediately editable item modal', { timeout: 60_000 }, async () => {
  const { context, page, browserErrors } = await createPantryPage();
  try {
    const beforePath = join(EVIDENCE, 'issue-20-before-desktop.png');
    if (!existsSync(beforePath)) await page.screenshot({ path: beforePath, fullPage: true });
    await page.locator('[data-pantry-id="pantry-olive-oil"]').click();
    const modal = page.locator('#pantry-item-modal');
    assert.equal(await modal.count(), 1, 'clicking the Pantry row should expose an item editor modal');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.getAttribute('role'), 'dialog');
    assert.equal(await modal.getAttribute('aria-modal'), 'true');
    assert.equal(await modal.getAttribute('aria-labelledby'), 'pantry-item-title');
    assert.equal(await page.locator('#pantry-item-name').inputValue(), 'Olive Oil');
    assert.equal(await page.locator('#pantry-item-family').inputValue(), 'fluid');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '2');
    assert.equal(await page.locator('#pantry-item-unit').inputValue(), 'cup');
    assert.match(await modal.innerText(), /Original text[\s\S]*2 cups Olive Oil/i);
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

test('desktop edit converts, persists by stable ID, removes exactly, and undoes', { timeout: 60_000 }, async () => {
  const { context, page, browserErrors, mutations, workspace } = await createPantryPage();
  try {
    const target = page.locator('[data-pantry-id="pantry-olive-oil"]');
    await target.click();
    await page.locator('#pantry-item-family').selectOption('solid');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '16', '2 cups becomes 16 water-equivalent ounces');
    assert.deepEqual(await page.locator('#pantry-item-unit option').evaluateAll((options) => options.map(({ value }) => value)), [
      'ounce', 'pound', 'gram', 'kilogram',
    ]);
    await page.locator('#pantry-item-name').fill('Avocado Oil');
    await page.screenshot({ path: join(EVIDENCE, 'issue-20-after-desktop.png'), fullPage: true });
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
    assert.deepEqual(mutations[0].payload.item.rawEvidence, ['2 cups Olive Oil', '16 ounces Avocado Oil']);
    assert.equal(mutations[0].payload.item.confidence, 0.91);
    assert.equal(mutations[0].payload.item.normalizationVersion, 1);
    assert.ok(mutations[0].payload.item.updatedAt > 100, 'correction advances updatedAt');
    assert.equal(workspace().pantry.find(({ id }) => id === 'pantry-olive-oil').name, 'avocado oil');

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
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.pantryId), 'pantry-oil-bottles', 'removal focuses the next Pantry record');
    assert.deepEqual({ op: mutations[1].op, id: mutations[1].payload.id }, { op: 'pantry.remove', id: 'pantry-olive-oil' });

    const undoResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('#toast [data-toast-action]', { hasText: 'Undo' }).click();
    await undoResponse;
    await page.locator('[data-pantry-id="pantry-olive-oil"]').waitFor();
    assert.equal(mutations[2].op, 'pantry.add');
    assert.equal(mutations[2].payload.item.id, 'pantry-olive-oil');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.pantryId), 'pantry-olive-oil', 'Undo returns focus to the restored record');
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});

test('mobile add-new is accessible, trapped, safe-area sized, and authoritative', { timeout: 60_000 }, async () => {
  const { context, page, browserErrors, mutations, workspace } = await createPantryPage({ width: 402, height: 874 });
  try {
    const input = page.locator('#pantry-input');
    const addButton = page.locator('#pantry-add-btn');
    await input.fill('3 bottles sparkling water');
    await addButton.click();
    const modal = page.locator('#pantry-item-modal');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pantry-item-title').textContent(), 'Add Pantry item');
    assert.equal(await page.locator('#pantry-item-name').inputValue(), 'Sparkling Water');
    assert.equal(await page.locator('#pantry-item-family').inputValue(), 'count');
    assert.equal(await page.locator('#pantry-item-quantity').inputValue(), '3');
    assert.equal(await page.locator('#pantry-item-unit').inputValue(), 'bottle');

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
    await page.screenshot({ path: join(EVIDENCE, 'issue-20-after-mobile.png'), fullPage: true });

    const addResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'
      && response.request().method() === 'PATCH');
    await page.locator('#pantry-item-save').click();
    await addResponse;
    await modal.waitFor({ state: 'hidden' });
    const added = workspace().pantry.find(({ name }) => name === 'sparkling water');
    assert.ok(added?.id, 'new item reaches authoritative workspace with a stable ID');
    await page.locator(`[data-pantry-id="${added.id}"]`).waitFor();
    assert.equal(mutations[0].op, 'pantry.add');
    assert.equal(mutations[0].payload.item.countLabel, 'bottle');
    assert.equal(await input.inputValue(), '', 'accepted add clears the source field');
    assert.deepEqual(browserErrors, []);
  } finally {
    await context.close();
  }
});
