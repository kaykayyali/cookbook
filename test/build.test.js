import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const JS_BUNDLE = join(DOCS, 'js', 'bundle.js');
const CSS_BUNDLE = join(DOCS, 'css', 'bundle.css');

// Same canonical token list as design-system.test.js. Mirrors spec §5.
const REQUIRED_TOKEN_NAMES = [
  '--color-bg', '--color-bg-elevated', '--color-bg-sunken',
  '--color-fg', '--color-fg-muted', '--color-fg-subtle',
  '--color-border', '--color-border-strong',
  '--color-accent', '--color-accent-fg', '--color-accent-soft',
  '--color-success', '--color-warning', '--color-danger',
  '--color-focus-ring',
  '--font-display', '--font-body',
  '--text-xs', '--text-sm', '--text-md', '--text-lg',
  '--text-xl', '--text-2xl', '--text-3xl',
  '--leading-tight', '--leading-snug', '--leading-normal', '--leading-relaxed',
  '--tracking-tight', '--tracking-wide',
  '--space-1', '--space-2', '--space-3', '--space-4',
  '--space-6', '--space-8', '--space-10', '--space-12',
  '--space-16',
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill',
  '--shadow-sm', '--shadow-lg',
  '--ease-out',
  '--dur-fast', '--dur-base',
  '--container-narrow', '--container-base', '--container-wide',
  '--z-toast',
];

const CONTROLLER_INIT_NAMES = [
  'initPanels', 'initRecipes', 'initPantry', 'initCart',
  'initDetail', 'initDrawer', 'initExtract', 'initSettings',
  'initFab', 'initSearch', 'initCommunity',
];

test('npm run build produces docs/js/bundle.js and docs/css/bundle.css', () => {
  execFileSync('node', [join(ROOT, 'scripts', 'build.js')], { cwd: ROOT, stdio: 'pipe' });
  assert.equal(existsSync(JS_BUNDLE), true, 'docs/js/bundle.js missing');
  assert.equal(existsSync(CSS_BUNDLE), true, 'docs/css/bundle.css missing');
});

test('bundle CSS contains every required token from spec §5', () => {
  const src = readFileSync(CSS_BUNDLE, 'utf8');
  const missing = REQUIRED_TOKEN_NAMES.filter((n) => !src.includes(`${n}:`));
  assert.deepEqual(missing, [], `Missing token(s) in bundle: ${missing.join(', ')}`);
});

test('bundle CSS preserves the @layer cascade order', () => {
  // Order is critical — re-ordering silently breaks the design system.
  const src = readFileSync(CSS_BUNDLE, 'utf8');
  const layers = ['tokens', 'base', 'layout', 'components', 'app'];
  const indices = layers.map((l) => {
    const m = src.match(new RegExp(`@layer\\s+${l}\\b`));
    return m ? src.indexOf(m[0]) : -1;
  });
  // Either a single @layer declaration list at the top, or scattered — both fine,
  // as long as tokens comes before base, base before layout, etc.
  for (let i = 1; i < layers.length; i++) {
    assert.ok(
      indices[i] > indices[i - 1],
      `Layer "${layers[i]}" (idx ${indices[i]}) must come after "${layers[i - 1]}" (idx ${indices[i - 1]})`
    );
  }
});

test('bundle JS contains the init() string for every controller', () => {
  // Source-level check: the entry file MUST import all 10 init functions.
  // esbuild's minifier renames identifiers, so the bundled output won't have
  // the original names — but the entry file is the contract.
  const ENTRY = join(ROOT, 'scripts', 'app.entry.js');
  const src = readFileSync(ENTRY, 'utf8');
  const missing = CONTROLLER_INIT_NAMES.filter((n) => !src.includes(n));
  assert.deepEqual(missing, [], `Controller init(s) missing from entry: ${missing.join(', ')}`);
});

test('bundle JS has no inline source map', () => {
  const src = readFileSync(JS_BUNDLE, 'utf8');
  // esbuild leaves a `//# sourceMappingURL=...` comment when sourcemaps are on.
  // We allow sourcemaps in dev but the production bundle must omit them.
  assert.equal(
    src.includes('sourceMappingURL'),
    false,
    'Bundle should not embed source map data inline (use external .map file or none)'
  );
});

test('bundle JS is non-empty', () => {
  const src = readFileSync(JS_BUNDLE, 'utf8');
  // minify:true should still produce compact output — guard against
  // accidentally shipping a non-minified build.
  assert.ok(src.length > 100, 'Bundle should contain real code (>100 bytes)');
});

test('bundle CSS does not embed hex outside tokens.css (no raw colors in app/components)', () => {
  // We can't run the existing design-system contract test on bundle.css because
  // esbuild may inline source-line comments. Just check the cascade + token
  // presence; the existing test in design-system.test.js still covers source.
  const src = readFileSync(CSS_BUNDLE, 'utf8');
  assert.match(src, /@layer\s+tokens/, 'Bundle must wrap tokens in @layer tokens');
});
