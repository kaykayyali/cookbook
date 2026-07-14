import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
const authenticatedUi = readFileSync(new URL('../docs/js/lib/authenticated-ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../docs/css/components.css', import.meta.url), 'utf8');

test('Week is the default authenticated destination with Tonight-first shell', () => {
  assert.match(html, /class="nav-item active"[\s\S]*data-panel="week"[\s\S]*>Week</);
  assert.match(html, /class="panel active"[\s\S]*id="panel-week"/);
  assert.match(html, /id="week-grid"/);
  assert.match(authenticatedUi, /import \{ initWeek \}/);
  assert.match(authenticatedUi, /panels\.register\('week', week\.render\)/);
  assert.match(authenticatedUi, /panels\.showPanel\('week'\)/);
  assert.match(app, /wireAuthenticatedUi/);
});

test('Recipes, Pantry, and Shopping remain one-tap Week siblings', () => {
  for (const panel of ['recipes', 'pantry', 'cart']) {
    assert.match(html, new RegExp(`data-panel="${panel}"`));
  }
});

test('Week CSS is a mobile-first vertical flow with long-name containment', () => {
  assert.match(css, /\.week-grid\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.week-meal-title\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.week-meal-controls\s*\{[^}]*flex-wrap:\s*wrap/s);
});
