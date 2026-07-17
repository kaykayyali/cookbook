import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { applyWorkspaceOperation } from '../docs/js/lib/workspace-sync.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const CAPTURE = process.env.ISSUE23_CAPTURE || '';
const ARTIFACTS = join(ROOT, 'artifacts', 'issue-23', CAPTURE || 'test');
const RECIPE_ID = 'issue-23-soup';
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
let server;
let browser;
let baseUrl;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const workspaceFixture = (revision = 0) => ({
  householdId: 'home', revision,
  plan: [{ id: 'plan-soup', date: TODAY, slot: 'dinner', type: 'recipe', recipeId: RECIPE_ID, targetServings: 4, status: 'active', note: '', plannedBySub: 'kay', cookSub: null }],
  cart: [{ recipeId: RECIPE_ID, recipeName: 'Responsive Tomato Soup', sourceServings: 4, targetServings: 4, ingredients: [
    { raw: '2 cans tomatoes', name: 'tomato', displayName: 'Tomatoes', quantity: 2, purchaseQuantity: 2, unit: 'count', countLabel: 'can', category: 'produce', kind: 'indivisible' },
    { raw: '1 onion', name: 'onion', displayName: 'Onion', quantity: 1, purchaseQuantity: 1, unit: 'count', countLabel: '', category: 'produce', kind: 'indivisible' },
  ] }],
  pantry: [{ id: 'pantry-onion', name: 'onion', displayName: 'Onion', quantity: 1, unit: 'count', countLabel: '', quantityText: '1', category: 'produce', createdAt: 1, updatedAt: 1 }],
  shoppingChecked: {}, manualItems: [{ id: 'milk', name: 'milk', displayName: 'Milk', quantity: 1, unit: 'count', countLabel: 'carton', category: 'dairy-eggs', checked: false }], recentMutations: [],
});

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

async function appPage(viewport, {
  haptics = true,
  reducedMotion = 'no-preference',
  touch = false,
  patchDelay = 0,
  patchFailures = 0,
  patchFailureStatus = 503,
  adapterFailures = false,
} = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, hasTouch: touch });
  const token = [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from('{"sub":"kay"}').toString('base64url'), 'test'].join('.');
  await context.addInitScript(({ tokenValue, hapticsSupported, failAdapters }) => {
    localStorage.setItem('cb_token', tokenValue);
    localStorage.setItem('cb_email', 'kay@example.test');
    localStorage.setItem('cb_tour_cookbook_v1_kay', 'complete');
    localStorage.setItem('cb_summer_theme_recommendation_v1:kay', '1');
    window.__feedbackEvents = [];
    window.__audioStarts = [];
    window.__hapticCalls = [];
    document.addEventListener('cookbook:feedback', (event) => window.__feedbackEvents.push(event.detail));
    class TestAudioContext {
      constructor() {
        if (failAdapters) throw new Error('test audio adapter failure');
        this.currentTime = 1; this.destination = {}; this.state = 'running'; window.__audioContexts = (window.__audioContexts || 0) + 1;
      }
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
    if (hapticsSupported) Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern) => {
      if (failAdapters) throw new Error('test haptic adapter failure');
      window.__hapticCalls.push(pattern); return true;
    } });
    else Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
  }, { tokenValue: token, hapticsSupported: haptics, failAdapters: adapterFailures });

  let authoritative = workspaceFixture();
  let cookEvents = [];
  let reactions = [];
  const patchState = { attempts: 0, failuresRemaining: patchFailures };
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/household') return json(route, { household: { id: 'home', name: 'Our kitchen' }, member: { id: 'kay', displayName: 'Kaysser', role: 'owner', sub: 'kay' } });
    if (url.pathname === '/api/community' && request.method() === 'GET') return json(route, { recipes: [{
      id: RECIPE_ID, author: { sub: 'kay', name: 'Kaysser' }, createdAt: 1, updatedAt: 1,
      recipe: { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Responsive Tomato Soup', recipeCategory: 'Dinner', recipeYield: '4 servings', totalTime: 'PT30M', recipeIngredient: ['2 cans tomatoes', '1 onion'], recipeInstructions: [{ '@type': 'HowToStep', position: 1, text: 'Simmer until cozy.' }] },
    }], nextCursor: null });
    if (url.pathname === '/api/workspace' && request.method() === 'GET') return json(route, authoritative);
    if (url.pathname === '/api/workspace' && request.method() === 'PATCH') {
      patchState.attempts += 1;
      if (patchDelay) await new Promise((resolve) => setTimeout(resolve, patchDelay));
      if (patchState.failuresRemaining > 0) {
        patchState.failuresRemaining -= 1;
        return json(route, { error: 'temporary_sync_failure' }, patchFailureStatus);
      }
      const mutation = request.postDataJSON();
      authoritative = applyWorkspaceOperation(authoritative, mutation);
      authoritative.revision += 1;
      authoritative.recentMutations = [...authoritative.recentMutations, mutation.mutationId];
      return json(route, authoritative);
    }
    if (url.pathname === '/api/cooks' && request.method() === 'GET') return json(route, { events: cookEvents, reactions });
    if (url.pathname === '/api/cooks' && request.method() === 'POST') {
      const input = request.postDataJSON();
      const event = {
        id: input.eventId, recipeId: input.recipeId, planEntryId: input.planEntryId || null,
        cookedAt: input.cookedAt, participants: input.participants, cookSub: input.cookSub,
        servings: input.servings, occasion: '', notes: '', photoUrl: '', createdBySub: 'kay',
        createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, revision: 1,
      };
      cookEvents = [event, ...cookEvents.filter((item) => item.id !== event.id)];
      authoritative.plan = authoritative.plan.map((entry) => entry.id === event.planEntryId
        ? { ...entry, status: 'cooked', cookSub: 'kay' } : entry);
      return json(route, { event });
    }
    if (url.pathname === '/api/cooks' && request.method() === 'PATCH') {
      const input = request.postDataJSON();
      if (input.reaction) {
        const reaction = { cookEventId: input.eventId, recipeId: RECIPE_ID, memberSub: 'kay', ...input.reaction, updatedAt: Date.now() };
        reactions = [reaction];
        return json(route, { reaction });
      }
      return json(route, { event: cookEvents[0] });
    }
    return json(route, {});
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  return { context, page, patchState, authoritative: () => authoritative };
}

async function waitForSettled(locator) {
  await locator.evaluate(async (element) => {
    const animations = element.getAnimations?.({ subtree: true }) || [];
    await Promise.allSettled(animations.map((animation) => animation.finished));
    await new Promise((resolve, reject) => {
      let previous = null;
      let stableFrames = 0;
      let frames = 0;
      const sample = () => {
        const rect = element.getBoundingClientRect();
        const current = [rect.x, rect.y, rect.width, rect.height, getComputedStyle(element).opacity].join(':');
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
        frames += 1;
        if (stableFrames >= 2) resolve();
        else if (frames >= 20) reject(new Error(`capture never settled: ${current}`));
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
}

async function assertTransientPurity(page, { allowSync = false, toast = null } = {}) {
  const activeSync = page.locator('#sync-status:not([hidden]), #recipe-sync-status:not([hidden]), #cook-sync-status:not([hidden])');
  if (!allowSync) {
    const unexpectedSync = await activeSync.evaluateAll((elements) => elements.map((element) => ({
      id: element.id,
      text: element.textContent.trim(),
    })));
    assert.deepEqual(unexpectedSync, [], `unrelated sync banners must be absent: ${JSON.stringify(unexpectedSync)}`);
  }
  const visibleToast = page.locator('#toast.show');
  if (toast) {
    assert.equal(await visibleToast.count(), 1, 'the scenario-specific toast must be present');
    assert.match(await visibleToast.innerText(), toast);
  } else {
    await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('show'));
    assert.equal(await visibleToast.count(), 0, 'unrelated toast must be absent');
  }
}

async function assertFreshFixture(page) {
  await page.locator('[data-entry-id="plan-soup"]').waitFor();
  await page.waitForFunction(() => ['sync-status', 'recipe-sync-status', 'cook-sync-status']
    .every((id) => document.getElementById(id)?.hidden !== false));
  assert.equal(await page.locator('[data-entry-id="plan-soup"].is-skipped').count(), 0, 'each evidence scenario starts from an active plan');
  assert.equal(await page.locator('[data-pantry-id="pantry-onion"]').count(), 1, 'each evidence scenario starts with the pantry fixture');
  assert.equal(await page.locator('#detail-modal').getAttribute('hidden'), '', 'each evidence scenario starts with detail closed');
  assert.equal((await page.locator('#recipe-drawer').getAttribute('class')).includes('open'), false, 'each evidence scenario starts with the drawer closed');
  await assertTransientPurity(page);
}

async function captureSurface(page, name, purity = {}) {
  if (!CAPTURE) return;
  await assertTransientPurity(page, purity);
  await waitForSettled(page.locator('body'));
  await page.screenshot({ path: join(ARTIFACTS, `${name}.png`), fullPage: false });
}

async function captureElement(page, locator, name, purity = {}) {
  if (!CAPTURE) return;
  await assertTransientPurity(page, purity);
  await waitForSettled(locator);
  await locator.screenshot({ path: join(ARTIFACTS, `${name}.png`) });
}

test('production bundle loads interaction surfaces at mobile and desktop viewports', async () => {
  for (const viewport of [{ width: 402, height: 874 }, { width: 1280, height: 800 }]) {
    const { context, page } = await appPage(viewport, { reducedMotion: 'reduce' });
    assert.equal(await page.locator('#week-grid').count(), 1);
    await context.close();
  }
});

test('mobile journey emits semantic feedback with immediate pressed state and independent settings', { timeout: 45_000 }, async () => {
  const { context, page } = await appPage({ width: 402, height: 874 }, { touch: true });
  try {
    const recipes = page.locator('button[data-panel="recipes"]');
    await recipes.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    assert.equal(await recipes.evaluate((element) => element.classList.contains('is-feedback-pressed')), true, 'press state must begin before click/action completion');
    await recipes.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    await recipes.tap();
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

test('primary controls are 44px touch-safe on mobile without desktop bloat', { timeout: 60_000 }, async () => {
  for (const [label, viewport] of [['mobile', { width: 402, height: 874 }], ['desktop', { width: 1280, height: 800 }]]) {
    const { context, page } = await appPage(viewport, { reducedMotion: 'reduce' });
    try {
      const measurements = {};
      async function measure(selectors) {
        for (const selector of selectors) {
          const box = await page.locator(selector).first().boundingBox();
          assert.ok(box, `${label} missing ${selector}`);
          measurements[selector] = { width: box.width, height: box.height };
          if (label === 'mobile') {
            assert.ok(box.width >= 44 && box.height >= 44, `${selector} is not touch-safe: ${JSON.stringify(box)}`);
          } else if (selector === '.pantry-tag') {
            assert.ok(box.height <= 48, `${selector} content row bloats desktop: ${JSON.stringify(box)}`);
          } else if (!selector.includes('detail-ing-item')) {
            assert.ok(box.height <= 44.5, `${selector} bloats desktop: ${JSON.stringify(box)}`);
          }
        }
      }

      assert.equal(await page.locator('[data-entry-id="plan-soup"]').count(), 1);
      await measure([
        '[data-entry-id="plan-soup"] [data-action="servings-down"]',
        '[data-entry-id="plan-soup"] [data-action="servings-up"]',
        '[data-entry-id="plan-soup"] [data-action="skip"]',
        '[data-entry-id="plan-soup"] [data-action="mark-cooked"]',
      ]);
      await page.locator('button[data-panel="pantry"]').click();
      const pantryRow = page.locator('.pantry-tag').first();
      await pantryRow.waitFor();
      await measure(['.pantry-tag']);
      await pantryRow.click();
      await page.locator('#pantry-item-modal').waitFor({ state: 'visible' });
      await measure(['#pantry-item-close', '#pantry-item-remove', '#pantry-item-save']);
      await page.locator('#pantry-item-close').click();
      await page.locator('button[data-panel="cart"]').click();
      await page.locator('.cart-check').first().waitFor();
      await measure([
        '.cart-serving-controls [data-action="servings-down"]',
        '.cart-check',
        '.cart-item-menu > summary',
        '.cart-recipe-menu > summary',
      ]);
      await page.locator('button[data-panel="recipes"]').click();
      await page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`).click();
      await page.locator('#detail-modal.open .detail-ing-item').first().waitFor();
      await measure([
        '#detail-close-btn',
        '#detail-modal.open .detail-ing-item',
        '#dm-add-all-btn',
        '#dm-pantry-note [data-action="add-missing"]',
      ]);
      await page.locator('#dm-mark-cooked-btn').click();
      await page.locator('.cook-history-card').first().waitFor({ timeout: 1_000 });
      await measure([
        '.cook-history-card [data-action="save-occasion"]',
        '.cook-history-card [data-action="save-review"]',
        '.cook-history-card [data-action="edit-history"]',
        '.cook-history-card [data-action="delete-history"]',
      ]);
      console.log(`# ${label} target measurements ${JSON.stringify(measurements)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, JSON.stringify(measurements));
    } finally { await context.close(); }
  }
});

test('production bundle preserves optimistic flows, recovery, modal transitions, and input modality at both viewports', { timeout: 120_000 }, async () => {
  for (const [label, viewport] of [['mobile', { width: 402, height: 874 }], ['desktop', { width: 1280, height: 800 }]]) {
    const { context, page, patchState, authoritative } = await appPage(viewport, {
      reducedMotion: 'reduce', touch: label === 'mobile', patchDelay: 350, patchFailures: 1, patchFailureStatus: 400,
    });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const hapticsAtStart = await page.evaluate(() => window.__hapticCalls.length);
      const recipesNav = page.locator('button[data-panel="recipes"]');
      await recipesNav.focus();
      await recipesNav.press('Enter');
      assert.equal(await page.locator('#panel-recipes').getAttribute('class').then((value) => value.includes('active')), true);
      assert.equal(await page.evaluate(() => window.__hapticCalls.length), hapticsAtStart, 'keyboard navigation must not vibrate');
      assert.equal((await page.evaluate(() => window.__feedbackEvents.at(-1))).modality, 'keyboard');

      const card = page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`);
      assert.equal(await page.locator('#detail-modal').getAttribute('aria-modal'), null, 'closed detail is not modal');
      assert.equal(await page.locator('#detail-modal').getAttribute('hidden'), '', 'closed detail is not rendered');
      assert.equal(await page.locator('#detail-modal').getAttribute('aria-hidden'), 'true');
      assert.equal(await page.locator('#detail-modal').getAttribute('inert'), '');
      assert.equal((await page.locator('#detail-modal').ariaSnapshot()).trim(), '', 'closed detail contributes no accessibility tree');
      assert.equal(await page.locator('#detail-close-btn').isVisible(), false, 'closed controls are unreachable');
      const feedbackBeforeCard = await page.evaluate(() => window.__feedbackEvents.length);
      await card.focus();
      await card.press('Enter');
      const modal = page.locator('#detail-modal.open');
      await modal.waitFor();
      const cardFeedback = await page.evaluate((start) => window.__feedbackEvents.slice(start), feedbackBeforeCard);
      assert.ok(cardFeedback.some((event) => event.type === 'select' && event.modality === 'keyboard'), 'keyboard role-button activation emits select');
      assert.equal(await modal.getAttribute('aria-modal'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'detail-close-btn');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#detail-modal').getAttribute('class').then((value) => value.includes('open')), false);
      assert.equal(await page.locator('#detail-modal').getAttribute('aria-modal'), null, 'closed detail releases modal semantics');
      assert.equal(await page.locator('#detail-modal').getAttribute('hidden'), '');
      assert.equal(await page.locator('#detail-modal').getAttribute('aria-hidden'), 'true');
      assert.equal(await page.locator('#detail-modal').getAttribute('inert'), '');
      assert.equal((await page.locator('#detail-modal').ariaSnapshot()).trim(), '', 'closed detail content leaves the accessibility tree');
      assert.equal(await page.locator('#detail-close-btn').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.id), RECIPE_ID);

      const beforeMouse = await page.evaluate(() => window.__hapticCalls.length);
      await page.locator('button[data-panel="pantry"]').click();
      assert.equal(await page.evaluate(() => window.__hapticCalls.length), beforeMouse, 'mouse navigation must not vibrate');

      const weekNav = page.locator('button[data-panel="week"]');
      if (label === 'mobile') await weekNav.tap(); else await weekNav.click();
      if (label === 'mobile') {
        const afterTouch = await page.evaluate(() => window.__hapticCalls.length);
        assert.ok(afterTouch > beforeMouse, 'touch navigation should vibrate');
        await weekNav.focus();
        await weekNav.press('Enter');
        assert.equal(await page.evaluate(() => window.__hapticCalls.length), afterTouch, 'keyboard after touch must not inherit touch origin');
        await weekNav.click();
        assert.equal(await page.evaluate(() => window.__hapticCalls.length), afterTouch, 'mouse after touch must not inherit touch origin');
      }
      const skip = page.locator('[data-entry-id="plan-soup"] [data-action="skip"]');
      await skip.dispatchEvent('pointerdown', { pointerId: 7, pointerType: label === 'mobile' ? 'touch' : 'mouse', isPrimary: true });
      await skip.dispatchEvent('pointercancel', { pointerId: 7, pointerType: label === 'mobile' ? 'touch' : 'mouse', isPrimary: true });
      const optimisticStarted = Date.now();
      if (label === 'mobile') await skip.tap(); else await skip.click();
      await page.locator('[data-entry-id="plan-soup"].is-skipped').waitFor({ timeout: 700 });
      assert.ok(Date.now() - optimisticStarted < 700, 'Week skip must publish before delayed sync');
      await page.locator('#sync-status:not([hidden])').waitFor({ timeout: 2_000 });
      assert.match(await page.locator('#sync-status').innerText(), /needs attention/i);
      await page.locator('#sync-status').scrollIntoViewIfNeeded();
      const retry = page.locator('#sync-status [data-action="retry-sync"]');
      if (label === 'mobile') await retry.tap(); else await retry.click();
      await page.waitForFunction(() => document.querySelector('#sync-status')?.hidden === true, null, { timeout: 3_000 });
      assert.ok(patchState.attempts >= 2);
      assert.equal(authoritative().plan.find((entry) => entry.id === 'plan-soup')?.status, 'skipped');

      await page.locator('button[data-panel="pantry"]').click();
      const pantryFeedbackStart = await page.evaluate(() => window.__feedbackEvents.length);
      const pantryRow = page.locator('[data-pantry-id="pantry-onion"]');
      if (label === 'mobile') await pantryRow.tap(); else await pantryRow.click();
      await page.locator('#pantry-item-modal').waitFor({ state: 'visible' });
      const remove = page.locator('#pantry-item-remove');
      if (label === 'mobile') await remove.tap(); else await remove.click();
      const confirmRemove = page.locator('[data-action="confirm-pantry-remove"]');
      if (label === 'mobile') await confirmRemove.tap(); else await confirmRemove.click();
      await pantryRow.waitFor({ state: 'detached', timeout: 700 });
      await page.waitForFunction(
        (start) => window.__feedbackEvents.slice(start).some(({ type }) => type === 'success'),
        pantryFeedbackStart,
        { timeout: 2_000 },
      );
      const pantryFeedback = await page.evaluate((start) => window.__feedbackEvents.slice(start), pantryFeedbackStart);
      assert.deepEqual(pantryFeedback.map(({ type }) => type), ['select', 'select', 'destructive', 'success']);
      if (label === 'mobile') {
        assert.ok(pantryFeedback.every(({ modality, touchOrigin }) => modality === 'touch' && touchOrigin), JSON.stringify(pantryFeedback));
      }

      await page.locator('button[data-panel="cart"]').click();
      const activeRow = page.locator('.shopping-list:not(.shopping-list-completed) .cart-row').first();
      await activeRow.locator('.cart-check').click();
      await page.locator('.cart-completed .cart-row').first().waitFor({ state: 'attached', timeout: 1_000 });
      assert.match(await page.locator('.cart-completed > summary').innerText(), /Completed \(1\)/);

      await page.locator('button[data-panel="recipes"]').click();
      await page.locator('#fab-new').click();
      assert.equal((await page.evaluate(() => window.__feedbackEvents)).filter((event) => event.targetId === 'fab-new').length, 1, 'capture integration must not duplicate FAB feedback');
      await page.locator('[data-fab-action="manual"]').click();
      await page.locator('#recipe-drawer.open').waitFor();
      await page.locator('#drawer-cancel-btn').click();
      await page.locator('#recipe-drawer').waitFor({ state: 'attached' });
      assert.equal((await page.locator('#recipe-drawer').getAttribute('class')).includes('open'), false);

      await page.locator('button[data-panel="recipes"]').click();
      await card.click();
      await page.locator('#dm-mark-cooked-btn').click();
      await page.locator('.cook-history-card').first().waitFor({ timeout: 1_000 });
      assert.match(await page.locator('#dm-history').innerText(), /Occasion/);

      await page.locator('#detail-close-btn').click();
      const deleteButton = card.locator('[data-action="delete"]');
      const eventsBeforeCancel = await page.evaluate(() => window.__feedbackEvents.length);
      const cancelDialogPromise = page.waitForEvent('dialog');
      const cancelClick = label === 'mobile' ? deleteButton.tap() : deleteButton.click();
      const cancelDialog = await cancelDialogPromise;
      await cancelDialog.dismiss();
      await cancelClick;
      assert.equal(await page.evaluate(() => window.__feedbackEvents.length), eventsBeforeCancel, 'cancelled delete stays silent');

      const hapticsBeforeDelete = await page.evaluate(() => window.__hapticCalls.length);
      const eventsBeforeDelete = await page.evaluate(() => window.__feedbackEvents.length);
      const acceptDialogPromise = page.waitForEvent('dialog');
      const acceptClick = label === 'mobile' ? deleteButton.tap() : deleteButton.click();
      const acceptDialog = await acceptDialogPromise;
      await acceptDialog.accept();
      await acceptClick;
      await page.waitForFunction(
        (start) => window.__feedbackEvents.slice(start).some((event) => event.type === 'success'),
        eventsBeforeDelete,
        { timeout: 2_000 },
      );
      await card.waitFor({ state: 'detached', timeout: 2_000 });
      const deleteFeedback = await page.evaluate((start) => window.__feedbackEvents.slice(start), eventsBeforeDelete);
      assert.deepEqual(deleteFeedback.map((event) => event.type), ['destructive', 'success']);
      if (label === 'mobile') {
        assert.ok(deleteFeedback.every((event) => event.modality === 'touch' && event.touchOrigin), JSON.stringify(deleteFeedback));
        assert.ok(await page.evaluate(() => window.__hapticCalls.length) > hapticsBeforeDelete, 'confirmed touch delete keeps touch provenance');
      }
      assert.deepEqual(pageErrors, []);
    } finally { await context.close(); }
  }
});

test('scenario-pure evidence resets fixtures, asserts labels, and captures only settled intended state', { skip: !CAPTURE, timeout: 180_000 }, async () => {
  for (const [label, viewport] of [['mobile', { width: 402, height: 874 }], ['desktop', { width: 1280, height: 800 }]]) {
    const touch = label === 'mobile';
    const activate = (locator) => (touch ? locator.tap() : locator.click());
    async function scenario(options, run) {
      const app = await appPage(viewport, { reducedMotion: 'reduce', touch, ...options });
      try {
        await assertFreshFixture(app.page);
        await run(app);
      } finally { await app.context.close(); }
    }

    await scenario({ patchDelay: 1_000 }, async ({ page, authoritative }) => {
      const skip = page.locator('[data-entry-id="plan-soup"] [data-action="skip"]');
      assert.equal(await skip.innerText(), 'Skip');
      await captureSurface(page, `${label}-01-week-before`);
      await skip.dispatchEvent('pointerdown', { pointerId: 31, pointerType: touch ? 'touch' : 'mouse', isPrimary: true });
      assert.equal(await skip.evaluate((element) => element.classList.contains('is-feedback-pressed')), true);
      await captureSurface(page, `${label}-02-week-pressed`);
      await skip.dispatchEvent('pointercancel', { pointerId: 31, pointerType: touch ? 'touch' : 'mouse', isPrimary: true });
      await activate(skip);
      await page.locator('[data-entry-id="plan-soup"].is-skipped').waitFor();
      assert.equal(await skip.innerText(), 'Unskip');
      assert.equal(authoritative().plan[0].status, 'active', 'capture proves optimistic UI before server authority');
      await captureSurface(page, `${label}-03-week-optimistic`);
    });

    await scenario({ patchDelay: 100, patchFailureStatus: 400 }, async ({ page, patchState, authoritative }) => {
      patchState.failuresRemaining = 1;
      const skip = page.locator('[data-entry-id="plan-soup"] [data-action="skip"]');
      await activate(skip);
      const status = page.locator('#sync-status:not([hidden])');
      await status.waitFor();
      assert.match(await status.innerText(), /needs attention/i);
      await captureElement(page, status, `${label}-04-sync-blocked`, { allowSync: true });
      await activate(status.locator('[data-action="retry-sync"]'));
      await page.waitForFunction(() => document.querySelector('#sync-status')?.hidden === true);
      assert.ok(patchState.attempts >= 2);
      assert.equal(authoritative().plan[0].status, 'skipped');
      const recoveredEntry = page.locator('[data-entry-id="plan-soup"].is-skipped');
      assert.equal(await recoveredEntry.count(), 1);
      await captureElement(page, recoveredEntry, `${label}-05-sync-recovered`);
    });

    await scenario({ patchDelay: 1_000 }, async ({ page, authoritative }) => {
      await page.locator('button[data-panel="pantry"]').click();
      const onion = page.locator('[data-pantry-id="pantry-onion"]');
      await onion.waitFor();
      await captureSurface(page, `${label}-06-pantry-before`);
      await activate(onion);
      await page.locator('#pantry-item-modal').waitFor({ state: 'visible' });
      await activate(page.locator('#pantry-item-remove'));
      await activate(page.locator('[data-action="confirm-pantry-remove"]'));
      await onion.waitFor({ state: 'detached' });
      assert.equal(authoritative().pantry.length, 1, 'pantry capture is optimistic, not a reused settled fixture');
      await captureSurface(page, `${label}-07-pantry-optimistic`, { toast: /removed.*onion/i });
    });

    await scenario({ patchDelay: 1_000 }, async ({ page, authoritative }) => {
      await page.locator('button[data-panel="cart"]').click();
      const active = page.locator('.shopping-list:not(.shopping-list-completed) .cart-row').first();
      await active.waitFor();
      await captureSurface(page, `${label}-08-shopping-active`);
      await active.locator('.cart-check').click();
      const completed = page.locator('.cart-completed .cart-row').first();
      await completed.waitFor({ state: 'attached' });
      const completedSummary = page.locator('.cart-completed > summary');
      assert.match(await completedSummary.innerText(), /Completed \(1\)/);
      await completedSummary.click();
      await completed.waitFor();
      assert.deepEqual(authoritative().shoppingChecked, {}, 'shopping capture remains the intended optimistic state');
      await captureSurface(page, `${label}-09-shopping-completed`);
    });

    await scenario({}, async ({ page }) => {
      await page.locator('button[data-panel="recipes"]').click();
      await page.locator('#fab-new').click();
      await page.locator('[data-fab-action="manual"]').click();
      const drawer = page.locator('#recipe-drawer.open');
      await drawer.waitFor();
      assert.equal(await page.locator('#detail-modal').getAttribute('hidden'), '');
      await captureSurface(page, `${label}-10-drawer-open`);
    });

    await scenario({}, async ({ page }) => {
      await page.locator('button[data-panel="recipes"]').click();
      await page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`).click();
      const modal = page.locator('#detail-modal.open');
      await modal.waitFor();
      assert.equal(await modal.getAttribute('aria-modal'), 'true');
      assert.equal(await page.locator('#dm-title').innerText(), 'Responsive Tomato Soup');
      assert.equal((await page.locator('#recipe-drawer').getAttribute('class')).includes('open'), false);
      await captureSurface(page, `${label}-11-modal-open`);
    });

    await scenario({}, async ({ page }) => {
      await page.locator('button[data-panel="recipes"]').click();
      await page.locator(`.recipe-card[data-id="${RECIPE_ID}"]`).click();
      await page.locator('#dm-mark-cooked-btn').click();
      const history = page.locator('.cook-history-card').first();
      await history.waitFor();
      assert.match(await history.innerText(), /Occasion/);
      await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('show'));
      await captureSurface(page, `${label}-12-completion-history`);
    });
  }
});

test('adapter failures cannot erase primary actions or semantic outcomes', { timeout: 60_000 }, async () => {
  for (const viewport of [{ width: 402, height: 874 }, { width: 1280, height: 800 }]) {
    const { context, page } = await appPage(viewport, { adapterFailures: true, touch: true, patchDelay: 100 });
    try {
      const skip = page.locator('[data-entry-id="plan-soup"] [data-action="skip"]');
      await skip.tap();
      await page.locator('[data-entry-id="plan-soup"].is-skipped').waitFor({ timeout: 700 });
      await page.waitForFunction(
        () => window.__feedbackEvents.some((event) => event.type === 'success'),
        null,
        { timeout: 2_000 },
      );
      const types = (await page.evaluate(() => window.__feedbackEvents)).map((event) => event.type);
      assert.ok(types.includes('toggle-on'));
      assert.ok(types.includes('success'));
    } finally { await context.close(); }
  }
});
