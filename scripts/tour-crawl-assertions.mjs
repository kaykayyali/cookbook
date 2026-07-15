export function assertTourStep(expected, state, expectedProgress) {
  const validPlacements = new Set(['center', 'right', 'left', 'bottom', 'top']);
  const valid = state.title === expected.title
    && state.progress === expectedProgress
    && state.panel === expected.panel
    && state.targetMatches
    && state.spotlightMatchesTarget
    && state.spotlightVisible
    && state.targetVisible
    && state.dialogVisible
    && state.targetStyleVisible
    && state.spotlightStyleVisible
    && state.dialogStyleVisible
    && state.targetUnoccluded
    && state.dialogUnoccluded
    && state.sheetHeightBounded
    && !state.targetDialogOverlap
    && validPlacements.has(state.placement);
  if (!valid) {
    throw new Error(`Tour step mismatch at ${expectedProgress}: ${JSON.stringify({ expected, state })}`);
  }
}

export function assertRuntimeClean(report) {
  if (!Array.isArray(report?.consoleMessages) || !Array.isArray(report?.networkFailures)
      || !Array.isArray(report?.httpFailures)) {
    throw new Error('Browser crawl produced a malformed runtime report');
  }
  if (report.consoleMessages.length) {
    throw new Error(`Browser crawl captured ${report.consoleMessages.length} console error(s)`);
  }
  if (report.networkFailures.length) {
    throw new Error(`Browser crawl captured ${report.networkFailures.length} network failure(s)`);
  }
  if (report.httpFailures.length) {
    throw new Error(`Browser crawl captured ${report.httpFailures.length} HTTP failure(s)`);
  }
}
