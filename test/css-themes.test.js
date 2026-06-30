// test/css-themes.test.js — every new theme block declares the full token set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const NEW_THEMES = ['sepia', 'forest', 'ocean'];

const REQUIRED_TOKENS = [
  '--color-bg', '--color-bg-elevated', '--color-bg-sunken',
  '--color-fg', '--color-fg-muted', '--color-fg-subtle',
  '--color-border', '--color-border-strong',
  '--color-accent', '--color-accent-fg', '--color-accent-soft',
  '--color-success', '--color-warning', '--color-danger',
  '--color-focus-ring',
  '--shadow-sm', '--shadow-lg',
];

function readTokens() {
  // Prefer the build artifact; fall back to source.
  for (const rel of ['docs/css/bundle.css', 'docs/css/tokens.css']) {
    const p = join(ROOT, rel);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error('No tokens file found');
}

for (const name of NEW_THEMES) {
  test(`tokens.css defines :root[data-theme="${name}"] block`, () => {
    const src = readTokens();
    // Accept quoted or unquoted form — esbuild's CSS normalizer strips
    // quotes from attribute selectors when the value is a valid identifier.
    const re = new RegExp(`:root\\[data-theme=(?:"${name}"|${name})\\]`);
    assert.match(src, re, `Missing selector :root[data-theme="${name}"]`);
  });

  test(`:root[data-theme="${name}"] declares every required token`, () => {
    const src = readTokens();
    // Capture the block: from the selector to the next "}" at the same depth.
    // Same quoted-or-unquoted tolerance as above.
    const re = new RegExp(`:root\\[data-theme=(?:"${name}"|${name})\\]\\s*\\{([^}]*)\\}`);
    const block = src.match(re);
    assert.ok(block, `Block for ${name} not found`);
    const body = block[1];
    const missing = REQUIRED_TOKENS.filter((tok) => !body.includes(`${tok}:`));
    assert.deepEqual(missing, [], `${name} block missing token(s): ${missing.join(', ')}`);
  });
}
