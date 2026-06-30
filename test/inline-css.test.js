// test/inline-css.test.js — index.html must not have any <style> blocks.
//
// Inline <style> tags defeat the cascade-locked @layer architecture in
// docs/css/. All styling belongs in the layered CSS files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, '..', 'docs', 'index.html');
const src = readFileSync(INDEX, 'utf8');

test('index.html has zero <style> blocks', () => {
  const matches = src.match(/<style[\s>]/gi) || [];
  assert.equal(matches.length, 0, `Found ${matches.length} inline <style> tag(s); move into docs/css/app.css`);
});

test('index.html loads a single local CSS bundle', () => {
  // Allow external CDN (e.g. Google Fonts) — count only local /css/ links.
  const links = (src.match(/<link\s+[^>]*rel="stylesheet"[^>]*href="\.?\/?css\/[^"]*"[^>]*>/gi) || []);
  assert.equal(links.length, 1, `Expected exactly 1 local stylesheet (./css/bundle.css), found ${links.length}`);
  assert.match(links[0], /href="\.?\/?css\/bundle\.css"/, 'local stylesheet must be bundle.css');
});

test('index.html loads the JS bundle as a module', () => {
  const scripts = (src.match(/<script\s+[^>]*type="module"[^>]*src="[^"]*bundle\.js"[^>]*>/gi) || []);
  assert.equal(scripts.length, 1, `Expected exactly 1 <script type="module" src="...bundle.js">, found ${scripts.length}`);
});
