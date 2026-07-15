import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('Pages production bindings remain dashboard-authoritative', () => {
  assert.doesNotMatch(config, /^pages_build_output_dir\s*=/m);
  assert.match(config, /^\[ai\]\s*\r?\nbinding\s*=\s*"AI"/m);
  assert.match(config, /^\[\[d1_databases\]\]/m);
});
