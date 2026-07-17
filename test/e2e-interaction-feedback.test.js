import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const CAPTURE = process.env.ISSUE23_CAPTURE || '';
const ARTIFACTS = join(ROOT, 'artifacts', 'issue-23', CAPTURE || 'test');
const RECIPE_ID = 'issue-23-soup';
let server;
let browser;
let baseUrl;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function launchBrowser() {
  try { return await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { return chromium.launch({ headless: true }); }
}

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.js')], { cwd: ROOT, stdio: 'pipe' });
  mkdirSync(ARTIFACTS, { recursive: true });
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
});

async function appPage(viewport, { haptics = true, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const token = [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from('{"sub":"kay"}').toString('base64url'), 'test'].join('.');
  await context.addInitScript(({ tokenValue, hapticsSupported }) => {
    localStorage.setItem('cb_token', tokenValue);
    localStorage.setItem('cb_email', 'kay@example.test');
    localStorage.setItem('cb_tour_cookbook_v1_kay', 'complete');
    localStorage.setItem('cb_summer_theme_recommendation_v1:kay', '1');
    window.__feedbackEvents = [];
    window.__audioStarts = [];
    window.__hapticCalls = [];
    document.addEventListener('cookbook:feedback', (event) => window.__feedbackEvents.push(event.detail));
    class TestAudioContext {
      constructor() { this.currentTime = 1; this.destination = {}; this.state = 'running'; window.__audioContexts = (window.__audioContexts || 0) + 1; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
      createOscillator() {
        const oscillator = { type: '', frequency: {
          value: 0,
          setValueAtTime(value) { oscillator.frequency.value = value; },
          exponentialRampToValueAtTime(value) { oscillator.frequency.value = value; },
          linearRampToValueAtTime(value) { oscillator.frequency.value = value; },
        }, connect() {}, disconnect() {}, start() { window.__audioStarts.push({ type: oscillator.type, frequency: oscillator.frequency.value }); }, stop() {}, onended: null };
        return oscillator;
      }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    }
    window.AudioContext = TestAudioContext;
    if (hapticsSupported) Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern) => { window.__hapticCalls.push(pattern); return true; } });
    else Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
  }, { tokenValue: token, hapticsSupported: haptics });

  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/household') return json(route, { household: { id: 'home', name: 'Our kitchen' }, member: { id: 'kay', displayName: 'Kaysser', role: 'owner', sub: 'kay' } });
    if (url.pathname === '/api/community' && request.method() === 'GET') return json(route, { recipes: [{
      id: RECIPE_ID, author: { sub: 'kay', name: 'Kaysser' }, createdAt: 1, updatedAt: 1,
      recipe: { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Responsive Tomato Soup', recipeCategory: 'Dinner', recipeYield: '4 servings', totalTime: 'PT30M', recipeIngredient: ['2 cans tomatoes', '1 onion'], recipeInstructions: [{ '@type': 'HowToStep', position: 1, text: 'Simmer until cozy.' }] },
    }], nextCursor: null });
    if (url.pathname === '/api/workspace' && request.method() === 'GET') return json(route, { householdId: 'home', revision: 0, plan: [], cart: [], pantry: [{ id: 'pantry-onion', name: 'onion', displayName: 'Onion', quantityText: '1', category: 'produce', createdAt: 1, updatedAt: 1 }], shoppingChecked: {}, manualItems: [{ id: 'milk', name: 'milk', displayName: 'Milk', quantity: '1 carton', checked: false }], recentMutations: [] });
    if (url.pathname === '/api/workspace' && request.method() === 'PATCH') return json(route, { householdId: 'home', revision: 1, plan: [], cart: [], pantry: [], shoppingChecked: {}, manualItems: [], recentMutations: [] });
    if (url.pathname === '/api/cooks' && request.method() === 'GET') return json(route, { events: [], reactions: [] });
    return json(route, {});
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  return { context, page };
}

async function captureSurface(page, name) {
  await page.screenshot({ path: join(ARTIFACTS, `${name}.png`), fullPage: false });
}

test('captures mobile and desktop baselines for the primary interaction patterns', { timeout: 90_000 }, async () => {
  if (!CAPTURE) return;
  for (const [label, viewport] of [['mobile', { width: 402, height: 874 }], ['desktop', { width: 1280, height: 800 }]]) {
    const { context, page } = await appPage(viewport, { haptics: label === 'mobile' });
    try {
      await captureSurface(page, `${label}-week`);
      await page.locator('button[data-panel="recipes"]').click();
      await captureSurface(page, `${label}-recipes`);
      await page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`).click();
      await page.locator('#detail-modal.open').waitFor();
      await captureSurface(page, `${label}-recipe-detail`);
      await page.locator('#detail-close-btn').click();
      await page.locator('button[data-panel="pantry"]').click();
      await captureSurface(page, `${label}-pantry`);
      await page.locator('button[data-panel="cart"]').click();
      await captureSurface(page, `${label}-shopping`);
      await page.locator('button[data-panel="settings"]').click();
      await captureSurface(page, `${label}-settings`);
    } finally { await context.close(); }
  }
});

test('mobile journey emits semantic feedback with immediate pressed state and independent settings', { timeout: 45_000 }, async () => {
  const { context, page } = await appPage({ width: 402, height: 874 });
  try {
    const recipes = page.locator('button[data-panel="recipes"]');
    await recipes.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    assert.equal(await recipes.evaluate((element) => element.classList.contains('is-feedback-pressed')), true, 'press state must begin before click/action completion');
    await recipes.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    await recipes.click();
    assert.ok((await page.evaluate(() => window.__feedbackEvents)).some((event) => event.type === 'select'), 'navigation must emit select');

    await page.locator('button[data-panel="settings"]').click();
    const sounds = page.locator('#feedback-sounds-toggle');
    const haptics = page.locator('#feedback-haptics-toggle');
    await sounds.waitFor();
    await haptics.waitFor();
    assert.equal(await sounds.isChecked(), true);
    assert.equal(await haptics.isChecked(), true);
    assert.equal(await haptics.isEnabled(), true);
    for (const control of [sounds, haptics]) {
      const box = await control.locator('xpath=..').boundingBox();
      assert.ok(box && box.height >= 44 && box.width >= 44, `feedback setting must be touch-safe: ${JSON.stringify(box)}`);
    }
    assert.ok((await page.evaluate(() => window.__audioStarts.length)) > 0, 'semantic interactions should use the Web Audio palette');
    assert.ok((await page.evaluate(() => window.__hapticCalls.length)) > 0, 'meaningful touch interactions should use progressive haptics');
  } finally { await context.close(); }
});

test('unsupported desktop hides haptics while sounds remain independently restart-safe', { timeout: 45_000 }, async () => {
  const { context, page } = await appPage({ width: 1280, height: 800 }, { haptics: false, reducedMotion: 'reduce' });
  try {
    await page.locator('button[data-panel="settings"]').click();
    const hapticState = await page.locator('#feedback-haptics-setting').evaluate((element) => ({ hidden: element.hidden, display: getComputedStyle(element).display, supported: typeof navigator.vibrate }));
    assert.equal(hapticState.hidden, true, JSON.stringify(hapticState));
    assert.equal(hapticState.display, 'none', JSON.stringify(hapticState));
    const sounds = page.locator('#feedback-sounds-toggle');
    await sounds.uncheck();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('button[data-panel="settings"]').click();
    assert.equal(await page.locator('#feedback-sounds-toggle').isChecked(), false);
    assert.deepEqual(await page.evaluate(() => window.__hapticCalls), []);
  } finally { await context.close(); }
});
