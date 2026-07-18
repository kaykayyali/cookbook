// test/app-bootstrap.test.js — app.js must import + call all 10 controller inits.
//
// Guards against forgetting to register a new controller: if you add a
// 11th controller, the bootstrap test will fail until you wire it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(__dirname, '..', 'docs', 'js', 'app.js');
const appSource = readFileSync(APP_JS, 'utf8');
const uiSource = readFileSync(resolve(__dirname, '..', 'docs', 'js', 'lib', 'authenticated-ui.js'), 'utf8');
const source = `${appSource}\n${uiSource}`;

const CONTROLLER_INITS = [
  'initPanels',
  'initRecipes',
  'initPantry',
  'initCart',
  'initDetail',
  'initDrawer',
  'initExtract',
  'initSettings',
  'initFab',
  'initSearch',
  'initWeek',
];

test('authenticated bootstrap imports every controller init function', () => {
  for (const name of CONTROLLER_INITS) {
    assert.match(
      source,
      new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`),
      `authenticated bootstrap must import { ${name} } from a controllers/* module`
    );
  }
});

test('authenticated bootstrap calls every controller init function', () => {
  for (const name of CONTROLLER_INITS) {
    assert.match(
      source,
      new RegExp(`\\b${name}\\s*\\(\\s*\\{`),
      `authenticated bootstrap must call ${name}({ ... })`
    );
  }
});

test('app.js stays under 130 lines (auth-gate + login screen allowance)', () => {
  const lines = appSource.split('\n').length;
  assert.ok(lines <= 130, `app.js should be ≤ 130 lines (currently ${lines})`);
});

test('recipe refresh restores runtime authority when cache persistence rejects', () => {
  assert.match(appSource, /setAuthority\([^;]+\)\.catch\(\(\) => false\)/);
  assert.match(appSource, /publishRecipeAuthority\(state, recipeRuntime\.current\(\)\)/);
});
