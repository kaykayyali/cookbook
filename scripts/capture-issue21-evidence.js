import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import sharp from 'sharp';

import { launchE2eBrowser } from '../test/helpers/playwright-browser.js';

const RECIPES = [
  { _id: 'basil-pasta', name: 'Basil Pasta', image: 'https://images.example.test/basil-pasta.jpg', recipeIngredient: ['2 basil leaves', '1 tomato', 'pasta'], recipeInstructions: ['Cook the pasta.'] },
  { _id: 'green-soup', name: 'Green Soup', recipeIngredient: ['basil', '2 onions', '1 cup stock'] },
  { _id: 'herb-toast', name: 'Herb Toast', recipeIngredient: ['fresh basil', '4 slices bread', '1 clove garlic'] },
  { _id: 'summer-salad', name: 'Summer Salad', recipeIngredient: ['basil leaves', '2 tomatoes', 'olive oil'] },
  { _id: 'basilisk-stew', name: 'Basilisk Stew', recipeIngredient: ['1 basilisk steak', '1 onion'] },
  { _id: 'thai-sauce', name: 'Thai Sauce', recipeIngredient: ['1 cup thai basil sauce', '1 lime'] },
];
const PANTRY = [
  {
    id: 'pantry-basil', raw: 'fresh basil', rawEvidence: ['fresh basil'], name: 'basil', displayName: 'Basil',
    quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', category: 'produce',
    confidence: 0.9, normalizationVersion: 2, updatedAt: 103, amountState: 'qualitative',
  },
  {
    id: 'pantry-tomato', raw: 'tomatoes', rawEvidence: ['tomatoes'], name: 'tomato', displayName: 'Tomato',
    quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', category: 'produce',
    confidence: 0.9, normalizationVersion: 2, updatedAt: 104, amountState: 'qualitative',
  },
];
const VIEWPORTS = Object.freeze({
  mobile: { width: 402, height: 874, hasTouch: true },
  desktop: { width: 1280, height: 900, hasTouch: false },
});

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Expected --name value arguments; received ${key || '(none)'}`);
    values[key.slice(2)] = value;
  }
  for (const key of ['baseline-docs', 'feature-docs', 'output-dir']) {
    if (!values[key] || !isAbsolute(values[key])) throw new Error(`--${key} must be an explicit absolute path.`);
    values[key] = resolve(values[key]);
  }
  return values;
}

function sourceLabel(docsPath) {
  return `${basename(resolve(docsPath, '..'))}/${basename(docsPath)}`;
}

function contentType(path) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  })[extname(path)] || 'application/octet-stream';
}

async function serveDocs(docsRoot) {
  assert.equal(existsSync(join(docsRoot, 'index.html')), true, `Missing index.html under ${docsRoot}`);
  const root = normalize(docsRoot);
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://evidence.invalid').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = normalize(join(root, relative));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    response.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function settledScreenshot(page, outputPath) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  let previous = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'device' });
    if (previous?.equals(current)) {
      writeFileSync(outputPath, current);
      return;
    }
    previous = current;
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  }
  throw new Error(`${outputPath} did not settle to two byte-identical frames.`);
}

async function captureState(browser, { docsRoot, outputDir, state }) {
  const server = await serveDocs(docsRoot);
  const reports = [];
  try {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.hasTouch,
        reducedMotion: 'reduce',
        deviceScaleFactor: 2,
      });
      const errors = [];
      try {
        const token = [
          Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
          Buffer.from(JSON.stringify({ sub: 'evidence-member' })).toString('base64url'),
          'fixture',
        ].join('.');
        await context.addInitScript(({ tokenValue }) => {
          localStorage.setItem('cb_token', tokenValue);
          localStorage.setItem('cb_email', 'cook@example.test');
          localStorage.setItem('cb_tour_cookbook_v1_evidence-member', 'complete');
          localStorage.setItem('cb_summer_theme_recommendation_v1:evidence-member', '1');
        }, { tokenValue: token });
        await context.route('https://images.example.test/**', (route) => route.fulfill({
          path: join(docsRoot, 'icons', 'icon-192.png'), contentType: 'image/png',
        }));
        await context.route('**/api/**', async (route) => {
          const request = route.request();
          const pathname = new URL(request.url()).pathname;
          if (pathname === '/api/household') return json(route, {
            household: { id: 'evidence-household', name: 'Test kitchen' },
            member: { id: 'evidence-member', displayName: 'Test cook', role: 'owner', sub: 'evidence-member' },
          });
          if (pathname === '/api/community' && request.method() === 'GET') return json(route, {
            recipes: RECIPES.map((recipe) => ({
              id: recipe._id, recipe, author: { sub: 'evidence-member', displayName: 'Test cook' }, createdAt: 1, updatedAt: 1,
            })),
            nextCursor: null,
          });
          if (pathname === '/api/workspace' && request.method() === 'GET') return json(route, {
            householdId: 'evidence-household', revision: 1, plan: [], cart: [], pantry: PANTRY,
            shoppingChecked: {}, manualItems: [], recentMutations: [], updatedAt: 1,
          });
          if (pathname === '/api/cooks' && request.method() === 'GET') return json(route, { events: [], reactions: [] });
          return json(route, { error: `Unexpected evidence request: ${request.method()} ${pathname}` }, 404);
        });

        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
        page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        await page.goto(server.url, { waitUntil: 'networkidle', timeout: 60_000 });
        try {
          await page.waitForFunction(() => document.body.dataset.panel === 'week', null, { timeout: 60_000 });
        } catch (cause) {
          const snapshot = await page.locator('body').innerText().catch(() => 'body unavailable');
          throw new Error(`Evidence app did not reach Week (${state}/${viewportName}). Browser errors: ${errors.join(' | ') || 'none'}. Body: ${snapshot.slice(0, 1_000)}`, { cause });
        }
        await page.locator('button[data-panel="pantry"]').click();
        await page.waitForFunction(() => document.body.dataset.panel === 'pantry', null, { timeout: 60_000 });
        await page.locator('[data-pantry-id="pantry-basil"]').click();
        const modal = page.locator('#pantry-item-modal');
        await modal.waitFor({ state: 'visible' });
        assert.equal(await modal.getAttribute('aria-modal'), 'true');
        assert.match(await page.locator('#pantry-item-raw').textContent(), /fresh basil/i);

        const discovery = page.locator('#pantry-recipe-discovery');
        const hasDiscovery = await discovery.count() === 1;
        if (state === 'before') {
          assert.equal(hasDiscovery, false, 'baseline unexpectedly contains issue #21 recipe discovery');
        } else {
          assert.equal(hasDiscovery, true, 'feature build is missing issue #21 recipe discovery');
          assert.equal(await discovery.getByRole('heading', { name: 'Recipes using Basil' }).count(), 1);
          assert.equal(await discovery.locator('[data-pantry-recipe-id]').count(), 3);
          await discovery.getByRole('button', { name: 'View all recipes' }).click();
          assert.equal(await discovery.locator('[data-pantry-recipe-id]').count(), 4);
          assert.equal(await discovery.getByText('Basilisk Stew').count(), 0);
          assert.equal(await discovery.getByText('Thai Sauce').count(), 0);
          await discovery.scrollIntoViewIfNeeded();
        }
        const body = page.locator('.pantry-item-body');
        if (state === 'before') await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        const outputPath = join(outputDir, `${viewportName}-${state}.png`);
        await settledScreenshot(page, outputPath);
        assert.deepEqual(errors, [], `${state}/${viewportName} browser errors:\n${errors.join('\n')}`);
        reports.push({
          state,
          viewport: viewportName,
          file: basename(outputPath),
          heading: hasDiscovery ? await page.locator('#pantry-recipe-title').textContent() : 'Edit Pantry item (baseline)',
          visibleRecipeRows: hasDiscovery ? await discovery.locator('[data-pantry-recipe-id]').count() : 0,
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await server.close();
  }
  return reports;
}

async function fileMetadata(path) {
  const bytes = readFileSync(path);
  const metadata = await sharp(bytes).metadata();
  return {
    file: basename(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    space: metadata.space,
    channels: metadata.channels,
    depth: metadata.depth,
    density: metadata.density,
    hasAlpha: metadata.hasAlpha,
    orientation: metadata.orientation || null,
    exifBytes: metadata.exif?.length || 0,
    iccBytes: metadata.icc?.length || 0,
    xmpBytes: metadata.xmp?.length || 0,
  };
}

async function pixelDiff(beforePath, afterPath) {
  const before = await sharp(beforePath).removeAlpha().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const after = await sharp(afterPath).removeAlpha().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(after.info, before.info, `Before/after pixel geometry differs: ${beforePath} ${afterPath}`);
  let changedPixels = 0;
  let minX = before.info.width; let minY = before.info.height; let maxX = -1; let maxY = -1;
  for (let offset = 0, pixel = 0; offset < before.data.length; offset += before.info.channels, pixel += 1) {
    let changed = false;
    for (let channel = 0; channel < before.info.channels; channel += 1) {
      if (before.data[offset + channel] !== after.data[offset + channel]) { changed = true; break; }
    }
    if (!changed) continue;
    changedPixels += 1;
    const x = pixel % before.info.width;
    const y = Math.floor(pixel / before.info.width);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const totalPixels = before.info.width * before.info.height;
  assert.ok(changedPixels > 0, `Before/after pair is pixel-identical: ${beforePath}`);
  return {
    changedPixels,
    totalPixels,
    changedPercent: Number(((changedPixels / totalPixels) * 100).toFixed(4)),
    boundingBox: { left: minX, top: minY, right: maxX, bottom: maxY },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const finalOutput = args['output-dir'];
  const staging = `${finalOutput}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  let browser;
  try {
    browser = await launchE2eBrowser(chromium, {
      headless: true,
      args: [
        '--hide-scrollbars', '--disable-gpu', '--disable-threaded-animation',
        '--disable-threaded-scrolling', '--force-color-profile=srgb',
      ],
    });
    const scenarios = [
      ...await captureState(browser, { docsRoot: args['baseline-docs'], outputDir: staging, state: 'before' }),
      ...await captureState(browser, { docsRoot: args['feature-docs'], outputDir: staging, state: 'after' }),
    ];
    const expected = ['desktop-after.png', 'desktop-before.png', 'mobile-after.png', 'mobile-before.png'];
    const files = expected.map((name) => join(staging, name));
    files.forEach((file) => assert.equal(existsSync(file), true, `Missing evidence file ${file}`));
    const metadata = await Promise.all(files.map(fileMetadata));
    assert.equal(new Set(metadata.map(({ sha256 }) => sha256)).size, metadata.length, 'Evidence files must all have unique hashes.');
    for (const item of metadata) {
      const expectedViewport = VIEWPORTS[item.file.includes('mobile-') ? 'mobile' : 'desktop'];
      assert.equal(item.format, 'png');
      assert.deepEqual([item.width, item.height], [expectedViewport.width * 2, expectedViewport.height * 2]);
      assert.equal(item.exifBytes + item.xmpBytes, 0, `Sensitive metadata found in ${item.file}`);
    }
    const diffs = {
      mobile: await pixelDiff(join(staging, 'mobile-before.png'), join(staging, 'mobile-after.png')),
      desktop: await pixelDiff(join(staging, 'desktop-before.png'), join(staging, 'desktop-after.png')),
    };
    const report = {
      capture: {
        baselineDocs: sourceLabel(args['baseline-docs']), featureDocs: sourceLabel(args['feature-docs']),
        browser: 'Playwright pinned Chromium', reducedMotion: true, deviceScaleFactor: 2,
        launchFlags: ['--hide-scrollbars', '--disable-gpu', '--disable-threaded-animation', '--disable-threaded-scrolling', '--force-color-profile=srgb'],
      },
      scenarios,
      metadata,
      diffs,
    };
    writeFileSync(join(staging, 'evidence-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    rmSync(finalOutput, { recursive: true, force: true });
    mkdirSync(finalOutput, { recursive: true });
    cpSync(staging, finalOutput, { recursive: true });
    console.log(JSON.stringify({ outputDir: finalOutput, files: metadata, diffs }, null, 2));
  } finally {
    await browser?.close();
    rmSync(staging, { recursive: true, force: true });
  }
}

await main();
