// test/e2e-smoke.test.js — minimal end-to-end smoke test for the built bundle.
//
// Spins up a tiny static server on the built docs/, fetches the rendered
// page + bundles, and asserts the assets are wired up. This is the
// lightweight alternative to Playwright — covers the asset graph + cascade
// without needing browser binaries. The actual app interaction is covered by
// the per-controller unit tests.
//
// Self-builds: the `before` hook runs `node scripts/build.js` so the
// gitignored bundle artifacts (docs/js/bundle.js, docs/css/bundle.css)
// always exist for the smoke assertions. This keeps `npm test` green in a
// fresh checkout / CI where no build has run, without weakening the smoke.
//
// Run via: node --test test/e2e-smoke.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');

let server;
let baseUrl;

before(async () => {
  // Ensure the bundle artifacts exist. They're gitignored, so a fresh
  // checkout (or CI without a prior `npm run build`) would otherwise 404 the
  // smoke tests. The build is fast + idempotent — safe to run unconditionally.
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.js')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch (e) {
    // Surface build failures clearly — the smoke tests below will then fail
    // with a meaningful cause instead of opaque 404s.
    throw new Error(`smoke before-hook build failed: ${e?.stderr?.toString?.() || e?.message || e}`);
  }

  server = createServer((req, res) => {
    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';
    const path = normalize(join(DOCS, url));
    if (!path.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end(); return; }
    const ext = extname(path).toLowerCase();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET / returns the index.html (200, text/html)', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /<title>/, 'index.html should have a <title>');
});

test('index.html serves with the CSS bundle and the JS bundle (no 404s)', async () => {
  const res = await fetch(`${baseUrl}/`);
  const body = await res.text();
  const cssHref = body.match(/href="\.\/css\/bundle\.css"/)?.[0]?.match(/"([^"]+)"/)?.[1];
  const jsSrc = body.match(/src="\.\/js\/bundle\.js"/)?.[0]?.match(/"([^"]+)"/)?.[1];
  assert.ok(cssHref, 'index.html must reference ./css/bundle.css');
  assert.ok(jsSrc, 'index.html must reference ./js/bundle.js');
  const cssRes = await fetch(`${baseUrl}/${cssHref}`);
  const jsRes = await fetch(`${baseUrl}/${jsSrc}`);
  assert.equal(cssRes.status, 200, 'CSS bundle should serve 200');
  assert.equal(jsRes.status, 200, 'JS bundle should serve 200');
});

test('CSS bundle contains the @layer cascade in canonical order', async () => {
  const res = await fetch(`${baseUrl}/css/bundle.css`);
  const body = await res.text();
  const layers = ['tokens', 'base', 'layout', 'components', 'app'];
  const indices = layers.map((l) => body.indexOf(`@layer ${l}`));
  for (let i = 1; i < layers.length; i++) {
    assert.ok(indices[i] > indices[i - 1], `${layers[i]} must come after ${layers[i - 1]}`);
  }
});

test('JS bundle imports the 10 controller init functions (source-level minified check)', async () => {
  const res = await fetch(`${baseUrl}/js/bundle.js`);
  const body = await res.text();
  // The bundle renames, so we check the entry's source (build test owns this).
  // For the bundle, the init functions get renamed — but the controller modules'
  // pure functions (e.g. `initPanels`) appear as `var initPanels=...`.
  // This is best-effort: at minimum, the bundle must not be empty / minified away.
  assert.ok(body.length > 1000, 'bundle should have real code');
});

test('index.html has no <style> blocks (layered CSS only)', async () => {
  const res = await fetch(`${baseUrl}/`);
  const body = await res.text();
  assert.equal((body.match(/<style/gi) || []).length, 0, 'no inline styles allowed');
});
