import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requiresSessionReload } from '../docs/js/lib/session-boundary.js';

test('a different authenticated subject requires a clean application reload', () => {
  assert.equal(requiresSessionReload('kay', 'gloria'), true);
  assert.equal(requiresSessionReload('kay', 'kay'), false);
  assert.equal(requiresSessionReload(null, 'kay'), false);
  assert.equal(requiresSessionReload('kay', null), true);
});

test('authenticated bootstrap checks the subject boundary before reusing a booted runtime', () => {
  const source = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(source, /requiresSessionReload\(bootedSub, nextSub\)/);
  assert.ok(source.indexOf('requiresSessionReload(bootedSub, nextSub)') < source.indexOf('if (appBooted)'));
  assert.match(source, /globalThis\.location\?\.reload/);
});
