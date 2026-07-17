import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchE2eBrowser } from './helpers/playwright-browser.js';

const savedEnvironment = {
  COOKBOOK_E2E_BROWSER_CHANNEL: process.env.COOKBOOK_E2E_BROWSER_CHANNEL,
  COOKBOOK_E2E_BROWSER_PATH: process.env.COOKBOOK_E2E_BROWSER_PATH,
  COOKBOOK_EVIDENCE_MODE: process.env.COOKBOOK_EVIDENCE_MODE,
};

function restoreEnvironment() {
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
}

test.afterEach(restoreEnvironment);

test('ordinary E2E launches a discovered system browser without falling back to Playwright cache', async () => {
  delete process.env.COOKBOOK_EVIDENCE_MODE;
  delete process.env.COOKBOOK_E2E_BROWSER_PATH;
  delete process.env.COOKBOOK_E2E_BROWSER_CHANNEL;
  const launches = [];
  const expected = {};
  const chromium = { launch: async (options) => { launches.push(options); return expected; } };
  assert.equal(await launchE2eBrowser(chromium, { headless: true }), expected);
  assert.deepEqual(launches, [{ channel: 'chrome', headless: true }]);
});

test('ordinary E2E browser failure is actionable and never attempts an uninstalled cached Chromium', async () => {
  delete process.env.COOKBOOK_EVIDENCE_MODE;
  const launches = [];
  const chromium = { launch: async (options) => { launches.push(options); throw new Error('missing'); } };
  await assert.rejects(() => launchE2eBrowser(chromium, { headless: true }), /system Chrome.*COOKBOOK_E2E_BROWSER_PATH.*COOKBOOK_EVIDENCE_MODE/s);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].channel, 'chrome');
});

test('explicit evidence mode uses the project-pinned Playwright browser', async () => {
  process.env.COOKBOOK_EVIDENCE_MODE = '1';
  delete process.env.COOKBOOK_E2E_BROWSER_PATH;
  const launches = [];
  const chromium = { launch: async (options) => { launches.push(options); return {}; } };
  await launchE2eBrowser(chromium, { headless: true, args: ['--force-color-profile=srgb'] });
  assert.deepEqual(launches, [{ headless: true, args: ['--force-color-profile=srgb'] }]);
});
