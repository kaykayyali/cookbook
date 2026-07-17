export async function launchE2eBrowser(chromium, options = {}) {
  if (!chromium?.launch) throw new TypeError('A Playwright chromium launcher is required.');
  const executablePath = String(process.env.COOKBOOK_E2E_BROWSER_PATH || '').trim();
  const evidenceMode = process.env.COOKBOOK_EVIDENCE_MODE === '1';
  const launchOptions = { ...options };
  if (executablePath) launchOptions.executablePath = executablePath;
  else if (!evidenceMode) launchOptions.channel = String(process.env.COOKBOOK_E2E_BROWSER_CHANNEL || 'chrome').trim() || 'chrome';

  try {
    return await chromium.launch(launchOptions);
  } catch (cause) {
    if (evidenceMode && !executablePath) throw cause;
    const channel = launchOptions.channel || 'configured system browser';
    throw new Error(
      `Unable to launch system ${channel === 'chrome' ? 'Chrome' : channel}. Install that browser, set `
      + 'COOKBOOK_E2E_BROWSER_PATH to its executable, or use COOKBOOK_EVIDENCE_MODE=1 only for the explicit '
      + 'pinned Playwright evidence capture (after installing the pinned browser).',
      { cause },
    );
  }
}
