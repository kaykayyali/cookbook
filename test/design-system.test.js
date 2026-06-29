import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, '..', 'docs');

// Tokens that tokens.css MUST define. Mirrors spec §5.
const REQUIRED_TOKEN_NAMES = [
  // color (light + dark) — §5.1, §5.2
  '--color-bg', '--color-bg-elevated', '--color-bg-sunken',
  '--color-fg', '--color-fg-muted', '--color-fg-subtle',
  '--color-border', '--color-border-strong',
  '--color-accent', '--color-accent-fg', '--color-accent-soft',
  '--color-success', '--color-warning', '--color-danger',
  '--color-focus-ring',
  // typography — §5.3
  '--font-display', '--font-body', '--font-mono',
  '--text-xs', '--text-sm', '--text-md', '--text-lg',
  '--text-xl', '--text-2xl', '--text-3xl',
  '--leading-tight', '--leading-snug', '--leading-normal', '--leading-relaxed',
  '--tracking-tight', '--tracking-normal', '--tracking-wide',
  // spacing — §5.4
  '--space-0', '--space-1', '--space-2', '--space-3', '--space-4',
  '--space-6', '--space-8', '--space-10', '--space-12',
  '--space-16', '--space-20', '--space-24',
  // radii — §5.5
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill',
  // shadow — §5.6
  '--shadow-sm', '--shadow-md', '--shadow-lg',
  // motion — §5.7
  '--ease-out', '--ease-in-out',
  '--dur-fast', '--dur-base', '--dur-slow',
  // layout — §5.8
  '--container-narrow', '--container-base', '--container-wide',
  '--bp-sm', '--bp-md',
  // z-index — §5.9
  '--z-base', '--z-dropdown', '--z-sticky', '--z-overlay', '--z-modal', '--z-toast',
];

test('docs/css/ contains tokens.css, base.css, layout.css, components.css (and no styles.css)', () => {
  const files = readdirSync(join(DOCS, 'css')).sort();
  assert.deepEqual(files, ['base.css', 'components.css', 'layout.css', 'tokens.css']);
});

test('tokens.css defines every required custom property', () => {
  const src = readFileSync(join(DOCS, 'css', 'tokens.css'), 'utf8');
  const missing = REQUIRED_TOKEN_NAMES.filter((name) => !src.includes(`${name}:`));
  assert.deepEqual(missing, [], `Missing token(s): ${missing.join(', ')}`);
});

test('tokens.css defines a [data-theme="dark"] override', () => {
  const src = readFileSync(join(DOCS, 'css', 'tokens.css'), 'utf8');
  assert.match(src, /:root\[data-theme="dark"\]/, 'dark theme selector missing');
});

test('tokens.css defines an automatic dark mode via prefers-color-scheme', () => {
  const src = readFileSync(join(DOCS, 'css', 'tokens.css'), 'utf8');
  assert.match(src, /@media\s+\(prefers-color-scheme:\s*dark\)/, 'prefers-color-scheme media query missing');
});
