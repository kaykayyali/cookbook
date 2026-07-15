import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../docs/css/app.css', import.meta.url), 'utf8');
const authenticatedUi = readFileSync(new URL('../docs/js/lib/authenticated-ui.js', import.meta.url), 'utf8');
const crawl = readFileSync(new URL('../scripts/authenticated-ui-crawl.mjs', import.meta.url), 'utf8');
const crawlAssertions = readFileSync(new URL('../scripts/tour-crawl-assertions.mjs', import.meta.url), 'utf8');

test('Settings keeps a permanent accessible way to relaunch the guide', () => {
  assert.match(html, /id="settings-tour-btn"/);
  assert.match(html, />\s*Take the tour again\s*</);
  assert.match(html, /data-tour-section="guide"/);
});

test('authenticated shell wires the cookbook registry into the generic tour framework', () => {
  assert.match(authenticatedUi, /initTour/);
  assert.match(authenticatedUi, /createCookbookTour/);
  assert.match(authenticatedUi, /subject:\s*state\.auth\?\.sub/);
  assert.match(authenticatedUi, /getCurrentPanel:\s*panels\._current/);
  assert.match(authenticatedUi, /settings-tour-btn[^\n]+tour\.start\('cookbook'\)/);
  assert.match(authenticatedUi, /tour\.maybeStart\('cookbook'\)/);
});

test('tour visuals are responsive, readable, and reduced-motion safe', () => {
  assert.match(css, /\.tour-layer/);
  const pwaZ = Number(css.match(/\.pwa-banner\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
  const tourZ = Number(css.match(/\.tour-layer\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
  assert.ok(tourZ > pwaZ, `tour layer z-index ${tourZ} must exceed PWA banner ${pwaZ}`);
  assert.match(css, /\.tour-target/);
  assert.match(css, /\.tour-actions[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.tour-dialog[\s\S]*max-height:\s*calc\(100dvh/);
  assert.match(css, /\.tour-dialog[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.tour-dialog\[data-placement="right"\],[\s\S]*data-placement="top"[\s\S]*transform:\s*none/);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.tour-dialog[\s\S]*max-height:\s*min\([\s\S]*58dvh/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.tour-/);
});

test('authenticated crawl fails closed and validates every expected tour step', () => {
  assert.match(crawl, /const expectedTourSteps = \[/);
  assert.match(crawl, /VERIFY_TOUR requested but first-run tour did not open/);
  assert.match(crawl, /assertTourStep\(expected, state, expectedProgress\)/);
  assert.match(crawl, /assertRuntimeClean\(report\)/);
  assert.match(crawl, /targetDialogOverlap/);
  assert.match(crawl, /targetStyleVisible/);
  assert.match(crawl, /targetUnoccluded/);
  assert.match(crawl, /sheetHeightBounded/);
  assert.match(crawl, /persistenceAfterReload/);
  assert.match(crawl, /httpFailures/);
  assert.match(crawl, /mobileSteps/);
  assert.match(crawl, /naturalRestoration/);
  assert.match(crawl, /expectedTourStorageKey/);
  assert.match(crawlAssertions, /Tour step mismatch/);
});
