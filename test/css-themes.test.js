// test/css-themes.test.js — every new theme block declares the full token set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const NEW_THEMES = ['sepia', 'forest', 'ocean', 'summer'];

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

test('all 6 theme blocks define the same token set', () => {
  const src = readTokens();
  const ALL_THEMES = ['light', 'dark', 'sepia', 'forest', 'ocean', 'summer'];
  // Capture the token count from the first theme as the canonical count.
  const counts = {};
  for (const name of ALL_THEMES) {
    const re = new RegExp(`:root\\[data-theme=(?:"${name}"|${name})\\]\\s*\\{([^}]*)\\}`);
    const block = src.match(re);
    assert.ok(block, `block for ${name} not found`);
    const defined = REQUIRED_TOKENS.filter((tok) => block[1].includes(`${tok}:`));
    counts[name] = defined.length;
  }
  const unique = [...new Set(Object.values(counts))];
  assert.equal(unique.length, 1,
    `all 6 themes should define the same number of tokens; got ${JSON.stringify(counts)}`);
});

test('Summer subtle text meets WCAG AA contrast on both Summer backgrounds', () => {
  const src = readFileSync(join(ROOT, 'docs/css/tokens.css'), 'utf8');
  const body = src.match(/:root\[data-theme="summer"\]\s*\{([^}]*)\}/)?.[1] || '';
  const token = (name) => body.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  assert.ok(contrast(token('--color-fg-subtle'), token('--color-bg')) >= 4.5);
  assert.ok(contrast(token('--color-fg-subtle'), token('--color-bg-elevated')) >= 4.5);
});
