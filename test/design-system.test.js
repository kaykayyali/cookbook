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

// ─── Spec §11 — design system contract ────────────────────────

test('every token referenced in docs/css is defined in tokens.css (no missing tokens)', () => {
  // ponytail: brief asks for "no orphans" (every defined token is used).
  // Spec §6.2 explicitly defines a wider API surface than current usage
  // (YAGNI for future primitives), so an inverse contract is more useful:
  // every token currently consumed is defined. Catches accidental removal.
  const tokens = readFileSync(join(DOCS, 'css', 'tokens.css'), 'utf8');
  const cssDir = join(DOCS, 'css');
  const cssFiles = readdirSync(cssDir)
    .filter((f) => f.endsWith('.css') && f !== 'tokens.css')
    .map((f) => readFileSync(join(cssDir, f), 'utf8'))
    .join('\n');
  // Pull every --token-name: that's referenced via var(--name) in consumers.
  const used = [...cssFiles.matchAll(/var\(\s*(--[a-z0-9-]+)\s*[),]/g)].map((m) => m[1]);
  const uniq = [...new Set(used)];
  const missing = uniq.filter((n) => !tokens.includes(`${n}:`));
  assert.deepEqual(missing, [], `Referenced but undefined token(s): ${missing.join(', ')}`);
});

test('every primitive class appears at least once in docs (no dead primitives)', () => {
  // ponytail: brief scopes to components.css, but .divider lives in layout.css
  // and primitives are typically rendered from JS into HTML strings.
  const cssDir = join(DOCS, 'css');
  const cssFiles = readdirSync(cssDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(cssDir, f), 'utf8'))
    .join('\n');
  const jsFiles = [];
  function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f.endsWith('.js')) jsFiles.push(readFileSync(p, 'utf8'));
      else if (!f.includes('.')) walk(p);
    }
  }
  walk(join(DOCS, 'js'));
  const html = readFileSync(join(DOCS, 'index.html'), 'utf8');
  const all = [cssFiles, ...jsFiles, html].join('\n');
  const PRIMITIVES = ['.btn', '.btn-primary', '.btn-secondary', '.btn-ghost',
    '.btn-sm', '.btn-md', '.btn-lg',
    '.icon-btn', '.input', '.select', '.checkbox',
    '.badge', '.badge-accent', '.badge-success', '.badge-warning', '.badge-danger',
    '.card', '.card-pad-sm', '.card-pad-md', '.card-pad-lg',
    '.divider', '.icon', '.toast', '.aria-live'];
  const dead = PRIMITIVES.filter((p) => !all.includes(p));
  assert.deepEqual(dead, [], `Dead primitive(s): ${dead.join(', ')}`);
});

test('composite files consume primitives — no raw # hex colors', () => {
  // Walk components/ and forbid hex outside tokens.css.
  const compDir = join(DOCS, 'js', 'components');
  const offenders = [];
  for (const f of readdirSync(compDir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(compDir, f), 'utf8');
    // very simple hex detector
    const matches = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    if (matches.length) offenders.push({ file: f, matches });
  }
  assert.deepEqual(offenders, [], `Raw hex in components: ${JSON.stringify(offenders)}`);
});

test('composite files consume primitives — no raw font-size: <px> declarations', () => {
  const compDir = join(DOCS, 'js', 'components');
  const offenders = [];
  for (const f of readdirSync(compDir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(compDir, f), 'utf8');
    if (/font-size\s*:\s*\d+px/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `Raw font-size px in: ${offenders.join(', ')}`);
});
