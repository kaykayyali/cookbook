import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const index = await readFile(new URL('docs/index.html', root), 'utf8');
const authenticatedUi = await readFile(new URL('docs/js/lib/authenticated-ui.js', root), 'utf8');
const appCss = await readFile(new URL('docs/css/app.css', root), 'utf8');

test('Pantry shell exposes search, category filters, result summary, and grouped item region', () => {
  assert.match(index, /id="pantry-search"/);
  assert.match(index, /id="pantry-filters"/);
  assert.match(index, /id="pantry-summary"/);
  assert.match(index, /id="pantry-grid"[^>]*aria-label="Pantry items"/s);
});

test('Summer recommendation is mounted and started from authenticated UI', () => {
  assert.match(index, /id="summer-theme-recommendation"/);
  assert.match(authenticatedUi, /createThemeRecommendation/);
  assert.match(authenticatedUi, /summerTheme\.maybeShow\(\)/);
});

test('mobile Pantry controls contain horizontal filter scrolling without widening the page', () => {
  assert.match(appCss, /\.pantry-tools\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(appCss, /\.pantry-filters\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  const mobile = appCss.slice(appCss.indexOf('@media (max-width: 760px)'));
  assert.match(mobile, /\.pantry-filters\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/s);
  assert.match(mobile, /\.pantry-filter\s*\{[^}]*flex:\s*0 0 auto/s);
});
