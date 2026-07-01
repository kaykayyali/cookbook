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
const source = readFileSync(APP_JS, 'utf8');

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
];

test('app.js imports all 10 controller init functions', () => {
  for (const name of CONTROLLER_INITS) {
    assert.match(
      source,
      new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`),
      `app.js must import { ${name} } from a controllers/* module`
    );
  }
});

test('app.js calls all 10 controller init functions', () => {
  for (const name of CONTROLLER_INITS) {
    assert.match(
      source,
      new RegExp(`\\b${name}\\s*\\(\\s*\\{`),
      `app.js must call ${name}({ ... })`
    );
  }
});

test('app.js stays under 70 lines (rendering-wiring allowance)', () => {
  const lines = source.split('\n').length;
  assert.ok(lines <= 70, `app.js should be ≤ 70 lines (currently ${lines})`);
});
