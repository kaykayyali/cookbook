import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceWorker } from '../scripts/build-service-worker.js';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');

test('installable shell declares manifest, Apple metadata, theme, and standalone safe areas', () => {
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(html, /viewport-fit=cover/);
  const manifest = JSON.parse(readFileSync(new URL('../docs/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) assert.equal(existsSync(new URL(`../docs/${icon.src.replace(/^\.\//, '')}`, import.meta.url)), true);
});

test('versioned service worker precaches one coherent shell and never caches APIs', () => {
  const sw = readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8');
  const builder = readFileSync(new URL('../scripts/build-service-worker.js', import.meta.url), 'utf8');
  assert.match(sw, /cookbook-shell-[a-f0-9]{16}/);
  assert.match(builder, /createHash\('sha256'\)/);
  for (const path of ['./', './index.html', './css/bundle.css', './js/bundle.js', './manifest.webmanifest']) assert.match(sw, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /SKIP_WAITING/);
  assert.doesNotMatch(sw, /skipWaiting\(\).*install/s, 'install must not silently activate a mixed shell');
});

test('concurrent service-worker builds never expose an empty or partial destination to readers', { timeout: 20_000 }, async () => {
  const destination = new URL('../docs/sw.js', import.meta.url);
  await buildServiceWorker();
  const expected = await readFile(destination, 'utf8');
  let building = true;
  const observations = [];
  const reader = (async () => {
    while (building) {
      observations.push(await readFile(destination, 'utf8'));
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
  try {
    await Promise.all(Array.from({ length: 16 }, async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) await buildServiceWorker();
    }));
  } finally {
    building = false;
    await reader;
  }
  assert.ok(observations.length > 0, 'stress reader must observe the destination during builds');
  assert.equal(new Set(observations).size, 1, 'readers must see only complete canonical service workers');
  assert.equal(observations[0], expected);
});

test('client exposes explicit update and one-time Safari Home Screen guidance', () => {
  const pwa = readFileSync(new URL('../docs/js/lib/pwa.js', import.meta.url), 'utf8');
  assert.match(app, /initPwa/);
  assert.match(pwa, /registration\.waiting/);
  assert.match(pwa, /controllerchange/);
  assert.match(pwa, /Add to Home Screen/);
  assert.match(pwa, /localStorage/);
  assert.match(html, /id="pwa-update"/);
  assert.match(html, /id="pwa-install-guide"/);
});
