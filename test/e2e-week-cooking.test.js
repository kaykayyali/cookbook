import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const recipeId = 'recipe-shakshuka';
const actorSub = 'kay';

let server;
let baseUrl;
let browser;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

function createServerState() {
  return {
    workspace: {
      householdId: 'household-home', revision: 0, plan: [], cart: [],
      pantry: ['2 cups olive oil', 'to 4 basil leaves'],
      shoppingChecked: {}, manualItems: [], recentMutations: [],
    },
    events: [],
    reactions: [],
    cookWriteCount: 0,
  };
}

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
      response.writeHead(404); response.end(); return;
    }
    const types = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
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

test('a household plans every meal period and remembers cooking without waiting for D1', { timeout: 45_000 }, async () => {
  const serverState = createServerState();
  const viewport = process.env.E2E_VIEWPORT === 'desktop'
    ? { width: 1280, height: 800 }
    : { width: 402, height: 874 };
  const context = await browser.newContext({ viewport });
  const token = [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: actorSub })).toString('base64url'),
    'test',
  ].join('.');
  await context.addInitScript(({ tokenValue }) => {
    localStorage.setItem('cb_token', tokenValue);
    localStorage.setItem('cb_email', 'kay@example.test');
    localStorage.setItem('cb_tour_cookbook_v1_kay', 'complete');
    localStorage.setItem('cb_summer_theme_recommendation_v1:kay', '1');
    window.__clickCount = 0;
    class TestAudioContext {
      constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
      resume() { return Promise.resolve(); }
      createOscillator() {
        return {
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {}, start: () => { window.__clickCount += 1; }, stop() {},
        };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    }
    window.AudioContext = TestAudioContext;
  }, { tokenValue: token });

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/household') {
      return json(route, {
        household: { id: 'household-home', name: 'Our kitchen' },
        member: { id: 'member-kay', displayName: 'Kaysser', role: 'owner', sub: actorSub },
      });
    }
    if (url.pathname === '/api/community' && method === 'GET') {
      return json(route, {
        recipes: [{
          id: recipeId, author: { sub: actorSub, name: 'Kaysser' }, createdAt: 1, updatedAt: 1,
          recipe: {
            '@context': 'https://schema.org', '@type': 'Recipe', name: 'Weeknight Shakshuka',
            recipeYield: '4 servings', recipeCategory: 'Breakfast', totalTime: 'PT30M',
            recipeIngredient: ['2 eggs', '1 can tomatoes'],
            recipeInstructions: [{ '@type': 'HowToStep', position: 1, text: 'Simmer and add eggs.' }],
          },
        }],
        nextCursor: null,
      });
    }
    if (url.pathname === '/api/workspace' && method === 'GET') return json(route, serverState.workspace);
    if (url.pathname === '/api/workspace' && method === 'PATCH') {
      const mutation = request.postDataJSON();
      await pause(350);
      const next = applyWorkspaceOperation(serverState.workspace, mutation);
      serverState.workspace = {
        ...next,
        revision: serverState.workspace.revision + 1,
        recentMutations: [...serverState.workspace.recentMutations, mutation.mutationId].slice(-50),
      };
      return json(route, serverState.workspace);
    }
    if (url.pathname === '/api/cooks' && method === 'GET') {
      return json(route, { events: serverState.events, reactions: serverState.reactions });
    }
    if (url.pathname === '/api/cooks' && method === 'POST') {
      const input = request.postDataJSON();
      await pause(1_200);
      const event = {
        id: input.eventId, recipeId: input.recipeId, planEntryId: input.planEntryId || null,
        cookedAt: input.cookedAt, participants: input.participants, cookSub: input.cookSub,
        servings: input.servings, occasion: input.occasion || '', notes: input.notes || '',
        photoUrl: '', createdBySub: actorSub, createdAt: Date.now(), updatedAt: Date.now(),
        deletedAt: null, revision: 1,
      };
      serverState.events = [event, ...serverState.events.filter((item) => item.id !== event.id)];
      serverState.workspace.plan = serverState.workspace.plan.map((entry) => (
        entry.id === event.planEntryId ? { ...entry, status: 'cooked', cookSub: actorSub } : entry
      ));
      return json(route, { event });
    }
    if (url.pathname === '/api/cooks' && method === 'PATCH') {
      const input = request.postDataJSON();
      serverState.cookWriteCount += 1;
      await pause(serverState.cookWriteCount === 1 ? 5_000 : 250);
      if (input.reaction) {
        const event = serverState.events.find((item) => item.id === input.eventId);
        const reaction = {
          cookEventId: input.eventId, recipeId: event.recipeId, memberSub: actorSub,
          taste: input.reaction.taste, complexity: input.reaction.complexity,
          review: input.reaction.review || '', reaction: input.reaction.reaction || null,
          note: input.reaction.note || '', dismissed: false, updatedAt: Date.now(),
        };
        serverState.reactions = [
          ...serverState.reactions.filter((item) => !(item.cookEventId === reaction.cookEventId && item.memberSub === actorSub)),
          reaction,
        ];
        return json(route, { reaction });
      }
      const index = serverState.events.findIndex((event) => event.id === input.eventId);
      const event = {
        ...serverState.events[index], occasion: input.occasion ?? serverState.events[index].occasion,
        revision: serverState.events[index].revision + 1, updatedAt: Date.now(),
      };
      serverState.events[index] = event;
      return json(route, { event });
    }
    return json(route, { error: `unhandled ${method} ${url.pathname}` }, 404);
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
  const tonight = page.locator('.week-day.is-tonight');
  await tonight.waitFor();

  await page.locator('[data-panel="pantry"]').click();
  const pantry = page.locator('#pantry-grid');
  await pantry.getByText('Olive Oil', { exact: true }).waitFor();
  assert.equal(await pantry.getByText('2 cups', { exact: true }).count(), 1);
  assert.equal(await pantry.getByText('Not sure', { exact: true }).count(), 1);
  assert.equal(await pantry.getByText(/As needed/i).count(), 0);
  const pantryIds = await pantry.locator('[data-pantry-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.pantryId));
  assert.equal(pantryIds.length, 2);
  assert.ok(pantryIds.every(Boolean));
  await page.locator('[data-panel="week"]').click();

  async function addMeal(slot) {
    if (slot !== 'dinner') {
      await tonight.locator('[data-action="toggle-meal-slot"]').click();
      await tonight.locator(`[data-action="select-meal-slot"][data-slot="${slot}"]`).click();
    }
    const started = Date.now();
    await tonight.locator('[data-action="add-meal"]').click();
    await tonight.locator(`.week-meal-slot:text-is("${slot[0].toUpperCase()}${slot.slice(1)}")`).waitFor({ timeout: 700 });
    assert.ok(Date.now() - started < 700, `${slot} should render before delayed workspace synchronization`);
  }

  await addMeal('breakfast');
  assert.equal(await page.locator('#sync-status').isHidden(), true, 'routine fast synchronization stays silent');
  await addMeal('lunch');
  await addMeal('dinner');
  assert.deepEqual(await tonight.locator('.week-meal-slot').allTextContents(), ['Breakfast', 'Lunch', 'Dinner']);
  assert.deepEqual(await tonight.locator('.week-meal-controls > span').allTextContents(), ['2', '2', '2']);
  assert.equal(await tonight.getByText('Repeat', { exact: true }).count(), 0);
  while (serverState.workspace.revision < 3) await pause(20);
  await page.waitForFunction(async () => {
    const selector = '.week-day.is-tonight .week-meal-remove';
    const controls = [...document.querySelectorAll(selector)];
    if (controls.length !== 3 || document.body.dataset.panel !== 'week') return false;
    await document.fonts?.ready;
    const first = controls[0];
    const before = first.getBoundingClientRect();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!first.isConnected || first !== document.querySelector(selector)) return false;
    const after = first.getBoundingClientRect();
    const style = getComputedStyle(first);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && before.width > 0 && before.height > 0
      && Math.abs(before.x - after.x) < 0.25
      && Math.abs(before.y - after.y) < 0.25
      && Math.abs(before.width - after.width) < 0.25
      && Math.abs(before.height - after.height) < 0.25;
  }, null, { timeout: 60_000 });
  const removeControl = tonight.locator('.week-meal-remove').first();
  await removeControl.waitFor({ state: 'visible', timeout: 60_000 });
  const removeBox = await removeControl.boundingBox();
  assert.ok(removeBox, 'remove control must remain attached and measurable after Week synchronization settles');
  assert.ok(removeBox.width >= 44 && removeBox.height >= 44,
    `remove control must be touch-safe: ${JSON.stringify(removeBox)}`);

  await page.waitForTimeout(80);
  const clickCount = await page.evaluate(() => window.__clickCount);
  await tonight.locator('[data-action="servings-up"]').first().click();
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.__clickCount), clickCount + 3, 'initiating tone and two-tone successful outcome both remain reachable');

  const breakfast = tonight.locator('.week-meal', { hasText: 'Breakfast' });
  const cookedStarted = Date.now();
  await breakfast.getByRole('button', { name: 'Mark cooked' }).click();
  await breakfast.getByText('Cooked', { exact: true }).waitFor({ timeout: 700 });
  assert.ok(Date.now() - cookedStarted < 700, 'Mark cooked should confirm before delayed D1');

  await page.locator('button[data-panel="recipes"]').click();
  await page.locator(`.recipe-card[data-id="${recipeId}"]`).click();
  const memory = page.locator('.cook-history-card').first();
  await memory.waitFor({ timeout: 3_000 });
  await memory.locator('[data-occasion]').fill('Thursday dinner together');
  await memory.locator('[data-action="save-occasion"]').click();
  await memory.locator('[data-rating="taste"][data-value="5"]').click();
  await memory.locator('[data-rating="complexity"][data-value="2"]').click();
  await memory.locator('[data-review]').fill('Bright, cozy, and easy enough for a weeknight.');
  const reviewStarted = Date.now();
  await memory.locator('[data-action="save-review"]').click();
  await memory.getByText('Taste ★★★★★ · Complexity ★★☆☆☆', { exact: true }).waitFor({ timeout: 700 });
  assert.ok(Date.now() - reviewStarted < 700, 'review should render before delayed D1');

  await page.locator('#detail-close-btn').click();
  assert.equal((await page.locator('#detail-modal').getAttribute('class')).includes('open'), false);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('button[data-panel="recipes"]').click();
  await page.locator(`.recipe-card[data-id="${recipeId}"]`).click();
  const restored = page.locator('.cook-history-card').first();
  await restored.waitFor();
  assert.equal(await restored.locator('[data-occasion]').inputValue(), 'Thursday dinner together');
  assert.equal(await restored.locator('[data-review]').inputValue(), 'Bright, cozy, and easy enough for a weeknight.');
  assert.equal(await restored.locator('[data-rating="taste"][data-value="5"]').getAttribute('aria-checked'), 'true');
  assert.equal(await restored.locator('[data-rating="complexity"][data-value="2"]').getAttribute('aria-checked'), 'true');

  await pause(1_200);
  assert.equal(serverState.events[0].occasion, 'Thursday dinner together');
  assert.equal(serverState.reactions[0].taste, 5);
  assert.equal(serverState.reactions[0].complexity, 2);
  assert.equal(serverState.reactions[0].review, 'Bright, cozy, and easy enough for a weeknight.');
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(geometry.content <= geometry.viewport, `page must not overflow horizontally: ${JSON.stringify(geometry)}`);
  assert.deepEqual(browserErrors, []);
  await context.close();
});
