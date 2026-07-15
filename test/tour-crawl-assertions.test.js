import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTourStep, assertRuntimeClean } from '../scripts/tour-crawl-assertions.mjs';

const expected = { title: 'Step', panel: 'week', target: '#target' };
const validState = {
  title: 'Step', progress: '1 of 1', panel: 'week', targetMatches: true,
  spotlightMatchesTarget: true, spotlightVisible: true, targetVisible: true,
  dialogVisible: true, targetDialogOverlap: false, placement: 'right',
  targetStyleVisible: true, spotlightStyleVisible: true, dialogStyleVisible: true,
  targetUnoccluded: true, dialogUnoccluded: true, sheetHeightBounded: true,
};

test('tour crawl assertions fail closed for wrong targets, overlap, clipping, and stale spotlight geometry', () => {
  assert.doesNotThrow(() => assertTourStep(expected, validState, '1 of 1'));
  for (const mutation of [
    { targetMatches: false },
    { spotlightMatchesTarget: false },
    { dialogVisible: false },
    { targetDialogOverlap: true },
    { placement: '' },
    { targetStyleVisible: false },
    { spotlightStyleVisible: false },
    { dialogStyleVisible: false },
    { targetUnoccluded: false },
    { dialogUnoccluded: false },
    { sheetHeightBounded: false },
  ]) {
    assert.throws(() => assertTourStep(expected, { ...validState, ...mutation }, '1 of 1'), /Tour step mismatch/);
  }
});

test('tour crawl assertions reject malformed reports and runtime failures', () => {
  const clean = { consoleMessages: [], networkFailures: [], httpFailures: [] };
  assert.doesNotThrow(() => assertRuntimeClean(clean));
  for (const malformed of [
    {},
    { networkFailures: [], httpFailures: [] },
    { consoleMessages: [], httpFailures: [] },
    { consoleMessages: [], networkFailures: [] },
  ]) assert.throws(() => assertRuntimeClean(malformed), /malformed runtime report/);
  assert.throws(() => assertRuntimeClean({ ...clean, consoleMessages: [{ type: 'error' }] }), /console error/);
  assert.throws(() => assertRuntimeClean({ ...clean, networkFailures: [{ error: 'failed' }] }), /network failure/);
  assert.throws(() => assertRuntimeClean({ ...clean, httpFailures: [{ status: 500 }] }), /HTTP failure/);
});
