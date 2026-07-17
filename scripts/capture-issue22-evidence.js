import { spawnSync } from 'node:child_process';
import process from 'node:process';

const result = spawnSync(process.execPath, [
  '--test',
  '--test-concurrency=1',
  'test/e2e-ingredient-corrections.test.js',
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    COOKBOOK_EVIDENCE_MODE: '1',
    COOKBOOK_CAPTURE_EVIDENCE: '1',
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
