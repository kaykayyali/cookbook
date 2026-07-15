import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { assertRuntimeClean, assertTourStep } from './tour-crawl-assertions.mjs';

const token = process.env.COOKBOOK_TOKEN;
if (!token) throw new Error('COOKBOOK_TOKEN is required');
let tokenSubject;
try {
  tokenSubject = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub;
} catch {
  throw new Error('COOKBOOK_TOKEN must expose the authenticated subject for exact tour verification');
}
if (!tokenSubject) throw new Error('COOKBOOK_TOKEN has no authenticated subject');
const expectedTourStorageKey = `cb_tour_cookbook_v1_${tokenSubject}`;
const baseUrl = process.env.COOKBOOK_URL || 'https://cookbook.damascusfront.net/';
const crawlOrigin = new URL(baseUrl).origin;
const outDir = path.resolve(process.env.CRAWL_OUT || 'artifacts/ui-crawl');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = Number(process.env.CDP_PORT || 9337);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cookbook-crawl-'));
await fs.mkdir(outDir, { recursive: true });
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--disable-cache', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitJson(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try { const res = await fetch(url); if (res.ok) return res.json(); } catch {}
    await sleep(100);
  }
  throw new Error(`CDP did not become ready: ${url}`);
}

let socket;
let closeBrowser;
try {
  const targets = await waitJson(`http://127.0.0.1:${port}/json`);
  const target = targets.find((item) => item.type === 'page');
  if (!target) throw new Error('No page target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  const consoleMessages = [];
  const networkFailures = [];
  const httpFailures = [];
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const callback = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) callback?.reject(new Error(msg.error.message)); else callback?.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push({ type: msg.params.type, text: msg.params.args.map((arg) => arg.value || arg.description || '').join(' ') });
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleMessages.push({ type: 'exception', text: msg.params.exceptionDetails?.text || 'exception' });
    if (msg.method === 'Network.loadingFailed') networkFailures.push({ url: msg.params.requestId, error: msg.params.errorText });
    if (msg.method === 'Network.responseReceived') {
      const response = msg.params.response;
      try {
        if (response.status >= 400 && new URL(response.url).origin === crawlOrigin) {
          httpFailures.push({ url: response.url, status: response.status, statusText: response.statusText });
        }
      } catch {}
    }
    for (const resolve of listeners.get(msg.method) || []) resolve(msg.params);
    listeners.delete(msg.method);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  closeBrowser = () => send('Browser.close');
  const once = (method) => new Promise((resolve) => listeners.set(method, [...(listeners.get(method) || []), resolve]));
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    return result.result.value;
  };
  const screenshot = async (name) => {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(outDir, `${name}.png`);
    await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
    return file;
  };
  const setViewport = (width, height, mobile) => send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height,
  });
  const click = async (selector) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    for (let node = el; node; node = node.parentElement) {
      const ancestorStyle = getComputedStyle(node);
      if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden'
          || ancestorStyle.visibility === 'collapse' || Number(ancestorStyle.opacity) <= 0) return false;
    }
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (style.pointerEvents === 'none'
        || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0
        || rect.top >= innerHeight || rect.left >= innerWidth) return false;
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + (rect.width / 2)));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + (rect.height / 2)));
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== el && !el.contains(hit))) return false;
    el.focus({ preventScroll: true });
    el.click();
    return true;
  })()`);
  const waitFor = async (selector, attempts = 80) => {
    for (let i = 0; i < attempts; i += 1) {
      if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${selector}`);
  };
  const surfaceMetrics = async (scope) => evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)});
    if (!root) return { missing: true };
    const visible = [...root.querySelectorAll('button, input, select, textarea, a')].filter((el) => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    const smallTargets = visible.map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 35) || el.id, width: Math.round(r.width), height: Math.round(r.height) };
    }).filter((x) => x.width < 44 || x.height < 44);
    const rect = root.getBoundingClientRect();
    return {
      title: root.querySelector('h1,h2,h3,h4')?.textContent.trim() || '',
      text: root.innerText.replace(/\s+/g, ' ').trim().slice(0, 500),
      rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) },
      smallTargets,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      bodyPanel: document.body.dataset.panel || '',
    };
  })()`);

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('cb_token', ${JSON.stringify(token)}); localStorage.setItem('cb_email', 'kaykayyali@gmail.com');`,
  });
  await setViewport(1440, 1000, false);
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${baseUrl}?ui-crawl=${Date.now()}` });
  await loaded; await waitFor('#main-content'); await sleep(3500);
  const auth = await evaluate(`({ gate: getComputedStyle(document.querySelector('#login-gate')).display, main: getComputedStyle(document.querySelector('#main-content')).display, panel: document.body.dataset.panel || '' })`);
  if (auth.gate !== 'none' || auth.main === 'none') throw new Error(`Authenticated UI did not boot: ${JSON.stringify(auth)}`);

  const report = { url: baseUrl, auth, desktop: {}, mobile: {}, overlays: {}, consoleMessages, networkFailures, httpFailures };
  const verifyTour = process.env.VERIFY_TOUR === '1';
  const expectedTourSteps = [
    { title: 'Welcome to your shared cookbook', panel: 'week', target: '#panel-week .panel-header h2' },
    { title: 'Let the cookbook choose', panel: 'week', target: '#pick-for-us-title' },
    { title: 'Plan the next seven dinners', panel: 'week', target: '#week-grid .week-day:first-child > header' },
    { title: 'Find the recipe you want', panel: 'recipes', target: '#panel-recipes .panel-header h2' },
    { title: 'Open, cook, or add a recipe', panel: 'recipes', target: '#recipe-grid .recipe-card:first-child .card-title' },
    { title: 'Keep lightweight pantry hints', panel: 'pantry', target: '#panel-pantry #pantry-input' },
    { title: 'Turn the plan into one list', panel: 'cart', target: '#panel-cart .plan-shop-tools strong' },
    { title: 'Make it yours', panel: 'settings', target: '#panel-settings .panel-header h2' },
  ];
  const readTourStep = async (expected) => evaluate(`(() => {
    const spotlight = document.querySelector('.tour-spotlight');
    const spotlightRect = spotlight?.getBoundingClientRect();
    const dialog = document.querySelector('.tour-dialog');
    const dialogRect = dialog?.getBoundingClientRect();
    const target = document.querySelector('.tour-target');
    const targetRect = target?.getBoundingClientRect();
    const unobscuredBottom = innerWidth <= 720 && dialogRect?.top > 8
      ? Math.min(innerHeight - 8, dialogRect.top - 8)
      : innerHeight - 8;
    const expectedSpotlight = targetRect ? {
      left: Math.max(8, targetRect.left - 6), top: Math.max(8, targetRect.top - 6),
      right: Math.min(innerWidth - 8, targetRect.right + 6),
      bottom: Math.min(unobscuredBottom, targetRect.bottom + 6),
    } : null;
    const spotlightMatchesTarget = Boolean(spotlightRect && expectedSpotlight
      && Math.abs(spotlightRect.left - expectedSpotlight.left) <= 1
      && Math.abs(spotlightRect.top - expectedSpotlight.top) <= 1
      && Math.abs(spotlightRect.right - expectedSpotlight.right) <= 1
      && Math.abs(spotlightRect.bottom - expectedSpotlight.bottom) <= 1);
    const targetDialogOverlap = Boolean(targetRect && dialogRect
      && targetRect.left < dialogRect.right && targetRect.right > dialogRect.left
      && targetRect.top < dialogRect.bottom && targetRect.bottom > dialogRect.top);
    const styleVisible = (element) => {
      if (!element) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
            || Number(style.opacity) <= 0) return false;
      }
      return true;
    };
    const pointStack = (rect) => rect ? document.elementsFromPoint(
      Math.max(0, Math.min(innerWidth - 1, rect.left + (rect.width / 2))),
      Math.max(0, Math.min(innerHeight - 1, rect.top + (rect.height / 2))),
    ) : [];
    const targetHit = pointStack(targetRect).find((node) => !node.closest?.('.tour-layer'));
    const dialogHit = pointStack(dialogRect)[0];
    const targetUnoccluded = Boolean(target && targetHit
      && (targetHit === target || target.contains(targetHit) || targetHit.contains(target)));
    const dialogUnoccluded = Boolean(dialog && dialogHit
      && (dialogHit === dialog || dialog.contains(dialogHit)));
    const sheetHeightBounded = Boolean(dialogRect
      && (innerWidth > 720 || dialogRect.height <= (innerHeight * 0.58) + 1));
    return {
      title: document.querySelector('.tour-title')?.textContent || '',
      progress: document.querySelector('.tour-progress')?.textContent || '',
      panel: document.body.dataset.panel || '',
      target: target?.id || target?.className || '',
      targetRect: targetRect ? { left: targetRect.left, top: targetRect.top, right: targetRect.right, bottom: targetRect.bottom,
        width: targetRect.width, height: targetRect.height } : null,
      dialogRect: dialogRect ? { left: dialogRect.left, top: dialogRect.top, right: dialogRect.right, bottom: dialogRect.bottom,
        width: dialogRect.width, height: dialogRect.height } : null,
      unobscuredBottom,
      targetMatches: Boolean(target?.matches(${JSON.stringify(expected.target)})),
      spotlightMatchesTarget,
      spotlightVisible: Boolean(spotlight && !spotlight.hidden && spotlightRect?.width > 0 && spotlightRect?.height > 0
        && spotlightRect.left >= 0 && spotlightRect.top >= 0 && spotlightRect.right <= innerWidth && spotlightRect.bottom <= innerHeight),
      targetVisible: Boolean(targetRect?.width > 0 && targetRect?.height > 0 && targetRect.left >= 0
        && targetRect.top >= 0 && targetRect.right <= innerWidth
        && targetRect.bottom <= (innerWidth <= 720 && dialogRect?.top > 0 ? dialogRect.top : innerHeight)),
      dialogVisible: Boolean(dialogRect?.width > 0 && dialogRect?.height > 0 && dialogRect.left >= 0
        && dialogRect.top >= 0 && dialogRect.right <= innerWidth && dialogRect.bottom <= innerHeight),
      targetStyleVisible: styleVisible(target),
      spotlightStyleVisible: styleVisible(spotlight),
      dialogStyleVisible: styleVisible(dialog),
      targetUnoccluded,
      dialogUnoccluded,
      sheetHeightBounded,
      targetDialogOverlap,
      placement: dialog?.dataset.placement || '',
    };
  })()`);
  const firstRunTour = await evaluate(`Boolean(document.querySelector('.tour-layer:not([hidden])'))`);
  if (verifyTour && !firstRunTour) throw new Error('VERIFY_TOUR requested but first-run tour did not open');
  if (firstRunTour) {
    const tourSteps = [];
    let focusAudit = null;
    let shortViewport = null;
    if (verifyTour) {
      focusAudit = await evaluate(`(() => {
        const dialog = document.querySelector('.tour-dialog');
        dialog.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
        const shiftTabWrapped = document.activeElement?.classList.contains('tour-next');
        dialog.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        const tabWrapped = document.activeElement?.classList.contains('tour-skip');
        const backgroundInert = [...document.body.children]
          .filter((node) => !node.classList.contains('tour-layer'))
          .every((node) => node.inert === true);
        dialog.focus();
        return { shiftTabWrapped, tabWrapped, backgroundInert };
      })()`);
      if (!focusAudit.shiftTabWrapped || !focusAudit.tabWrapped || !focusAudit.backgroundInert) {
        throw new Error(`Tour focus containment failed: ${JSON.stringify(focusAudit)}`);
      }
      await screenshot('desktop-tour-welcome');
      await setViewport(390, 844, true); await sleep(150); await screenshot('mobile-tour-welcome');
      await setViewport(390, 480, true); await sleep(150);
      shortViewport = await evaluate(`(() => {
        const dialog = document.querySelector('.tour-dialog').getBoundingClientRect();
        const nextControl = document.querySelector('.tour-next');
        nextControl.scrollIntoView({ block: 'nearest' });
        const next = nextControl.getBoundingClientRect();
        return { dialogVisible: dialog.top >= 0 && dialog.bottom <= innerHeight,
          controlsVisible: next.top >= 0 && next.bottom <= innerHeight,
          sheetHeightBounded: dialog.height <= (innerHeight * 0.58) + 1,
          overflowY: getComputedStyle(document.querySelector('.tour-dialog')).overflowY };
      })()`);
      if (!shortViewport.dialogVisible || !shortViewport.controlsVisible || !shortViewport.sheetHeightBounded
          || shortViewport.overflowY !== 'auto') {
        throw new Error(`Tour short-viewport containment failed: ${JSON.stringify(shortViewport)}`);
      }
      await setViewport(1440, 1000, false); await sleep(150);
    }
    for (const [stepIndex, expected] of expectedTourSteps.entries()) {
      const state = await readTourStep(expected);
      const expectedProgress = `${stepIndex + 1} of ${expectedTourSteps.length}`;
      if (verifyTour) assertTourStep(expected, state, expectedProgress);
      tourSteps.push(state);
      if (!await click('.tour-next')) throw new Error(`Tour Next control missing at ${expectedProgress}`);
      await sleep(220);
    }
    const completed = await evaluate(`({
      closed: document.querySelector('.tour-layer')?.hidden === true,
      remembered: localStorage.getItem(${JSON.stringify(expectedTourStorageKey)}) === 'complete'
    })`);
    if (!completed.closed || !completed.remembered) throw new Error('Tour did not finish and persist cleanly');
    const naturalRestoration = await evaluate(`(() => {
      const layer = document.querySelector('.tour-layer');
      return {
        panel: document.body.dataset.panel || '',
        focusOutsideTour: !layer.contains(document.activeElement),
        backgroundInteractive: [...document.body.children]
          .filter((node) => !node.classList.contains('tour-layer'))
          .every((node) => node.inert !== true),
      };
    })()`);
    if (naturalRestoration.panel !== 'week' || !naturalRestoration.focusOutsideTour
        || !naturalRestoration.backgroundInteractive) {
      throw new Error(`Tour natural completion restoration failed: ${JSON.stringify(naturalRestoration)}`);
    }
    report.tour = { firstRun: true, steps: tourSteps, completed, focusAudit, shortViewport, naturalRestoration };
  } else {
    report.tour = { firstRun: false, steps: [], completed: null };
  }

  if (verifyTour) {
    const reloadDone = once('Page.loadEventFired');
    await send('Page.reload');
    await reloadDone; await waitFor('#main-content'); await sleep(1500);
    const persistenceAfterReload = await evaluate(`({
      suppressed: !document.querySelector('.tour-layer:not([hidden])'),
      remembered: localStorage.getItem(${JSON.stringify(expectedTourStorageKey)}) === 'complete'
    })`);
    if (!persistenceAfterReload.suppressed || !persistenceAfterReload.remembered) {
      throw new Error(`Completed tour persistence failed after reload: ${JSON.stringify(persistenceAfterReload)}`);
    }
    report.tour.persistenceAfterReload = persistenceAfterReload;

    if (!await click('.nav-item[data-panel="settings"]')) throw new Error('Settings navigation control missing');
    await sleep(120);
    await evaluate(`document.querySelector('#settings-tour-btn')?.focus()`);
    const relaunched = await click('#settings-tour-btn'); await sleep(220);
    if (!relaunched) throw new Error('Settings could not relaunch the tour');

    await setViewport(390, 844, true); await sleep(220); await screenshot('mobile-tour-welcome');
    await setViewport(390, 480, true); await sleep(220);
    const mobileSteps = [];
    for (const [stepIndex, expected] of expectedTourSteps.entries()) {
      const state = await readTourStep(expected);
      const expectedProgress = `${stepIndex + 1} of ${expectedTourSteps.length}`;
      assertTourStep(expected, state, expectedProgress);
      mobileSteps.push(state);
      if (!await click('.tour-next')) throw new Error(`Mobile Tour Next control missing at ${expectedProgress}`);
      await sleep(220);
    }
    const mobileCompletion = await evaluate(`({
      open: Boolean(document.querySelector('.tour-layer:not([hidden])')),
      panel: document.body.dataset.panel || '',
      focusId: document.activeElement?.id || '',
      backgroundInteractive: [...document.body.children]
        .filter((node) => !node.classList.contains('tour-layer'))
        .every((node) => node.inert !== true)
    })`);
    if (mobileCompletion.open || mobileCompletion.panel !== 'settings'
        || mobileCompletion.focusId !== 'settings-tour-btn' || !mobileCompletion.backgroundInteractive) {
      throw new Error(`Mobile tour completion restoration failed: ${JSON.stringify(mobileCompletion)}`);
    }
    report.tour.mobileSteps = mobileSteps;
    report.tour.mobileCompletion = mobileCompletion;

    await setViewport(1440, 1000, false); await sleep(220);
    await evaluate(`document.querySelector('#settings-tour-btn')?.focus()`);
    if (!await click('#settings-tour-btn')) throw new Error('Settings could not relaunch the tour for Skip verification');
    await sleep(220);
    report.tour.relaunch = await evaluate(`({
      open: Boolean(document.querySelector('.tour-layer:not([hidden])')),
      title: document.querySelector('.tour-title')?.textContent || '',
      progress: document.querySelector('.tour-progress')?.textContent || ''
    })`);
    if (!report.tour.relaunch.open) throw new Error('Settings relaunch did not open the tour');
    await screenshot('desktop-tour-relaunch');
    if (!await click('.tour-skip')) throw new Error('Tour Skip control missing after Settings relaunch');
    await sleep(100);
    const skipState = await evaluate(`({
      open: Boolean(document.querySelector('.tour-layer:not([hidden])')),
      panel: document.body.dataset.panel || '',
      focusId: document.activeElement?.id || '',
      backgroundInteractive: [...document.body.children]
        .filter((node) => !node.classList.contains('tour-layer'))
        .every((node) => node.inert !== true)
    })`);
    if (skipState.open || skipState.panel !== 'settings' || skipState.focusId !== 'settings-tour-btn'
        || !skipState.backgroundInteractive) throw new Error(`Tour skip restoration failed: ${JSON.stringify(skipState)}`);
    report.tour.skipRestoration = skipState;
  }

  const panels = ['week', 'recipes', 'pantry', 'cart', 'settings'];
  for (const panel of panels) {
    await click(`.nav-item[data-panel="${panel}"]`); await sleep(300);
    report.desktop[panel] = await surfaceMetrics(`#panel-${panel}`);
    await screenshot(`desktop-${panel}`);
  }

  await click('.nav-item[data-panel="recipes"]'); await sleep(250);
  const opened = await click('.recipe-card');
  if (opened) {
    await sleep(350);
    report.overlays.detailDesktop = await surfaceMetrics('#detail-modal');
    report.overlays.detailScrollDesktop = await evaluate(`(() => { const el = document.querySelector('.detail-body'); return el ? { top: el.scrollTop, height: el.clientHeight, scrollHeight: el.scrollHeight } : null; })()`);
    await screenshot('desktop-recipe-detail');
    await evaluate(`(() => { const el = document.querySelector('.detail-body'); if (el) el.scrollTop = el.scrollHeight; })()`); await sleep(150);
    await screenshot('desktop-recipe-detail-bottom');
    await click('#detail-close-btn');
  }
  await click('#fab-new'); await sleep(100); await screenshot('desktop-fab-menu');
  await click('[data-fab-action="manual"]'); await sleep(250);
  report.overlays.drawerDesktop = await surfaceMetrics('#recipe-drawer'); await screenshot('desktop-recipe-drawer');
  await click('#drawer-close-btn');
  await click('#fab-new'); await click('[data-fab-action="image"]'); await sleep(250);
  report.overlays.imageDesktop = await surfaceMetrics('#image-capture-overlay'); await screenshot('desktop-image-capture');
  await click('#image-capture-close-btn');

  await setViewport(390, 844, true); await sleep(250);
  for (const panel of panels) {
    await click(`.nav-item[data-panel="${panel}"]`); await sleep(250);
    report.mobile[panel] = await surfaceMetrics(`#panel-${panel}`);
    await screenshot(`mobile-${panel}`);
  }
  await click('.nav-item[data-panel="recipes"]'); await sleep(250);
  if (await click('.recipe-card')) {
    await sleep(350);
    report.overlays.detailMobile = await surfaceMetrics('#detail-modal');
    report.overlays.detailScrollMobile = await evaluate(`(() => { const el = document.querySelector('.detail-body'); return el ? { top: el.scrollTop, height: el.clientHeight, scrollHeight: el.scrollHeight, ingredients: Boolean(el.querySelector('.detail-ing-list')) } : null; })()`);
    await screenshot('mobile-recipe-detail-top');
    await evaluate(`(() => { const el = document.querySelector('.detail-body'); if (el) el.scrollTop = el.scrollHeight; })()`); await sleep(150);
    await screenshot('mobile-recipe-detail-bottom');
    const cookOpened = await click('#dm-cook-mode-btn');
    if (cookOpened) { await sleep(200); report.overlays.cookingMobile = await surfaceMetrics('#cooking-mode-overlay'); await screenshot('mobile-cooking-mode'); await click('#cook-close'); }
    await click('#detail-close-btn');
  }
  await click('#fab-new'); await click('[data-fab-action="manual"]'); await sleep(200);
  report.overlays.drawerMobile = await surfaceMetrics('#recipe-drawer'); await screenshot('mobile-recipe-drawer');
  await click('#drawer-close-btn');
  await click('#fab-new'); await click('[data-fab-action="image"]'); await sleep(200);
  report.overlays.imageMobile = await surfaceMetrics('#image-capture-overlay'); await screenshot('mobile-image-capture');
  await click('#image-capture-close-btn');

  report.consoleMessages = consoleMessages.filter((item) => item.type === 'error' || item.type === 'exception');
  report.networkFailures = networkFailures;
  report.httpFailures = httpFailures;
  await fs.writeFile(path.join(outDir, 'crawl-report.json'), JSON.stringify(report, null, 2));
  assertRuntimeClean(report);
  console.log(JSON.stringify({ outDir, panels: panels.length * 2, overlays: Object.keys(report.overlays),
    errors: report.consoleMessages.length, networkFailures: report.networkFailures.length,
    httpFailures: report.httpFailures.length }, null, 2));
} finally {
  // Shut down only the harness-owned Chrome tree. On Windows, closing through
  // CDP can orphan a utility child that keeps Hermes' PTY alive, so terminate
  // the complete owned tree while its root PID still exists.
  if (process.platform === 'win32' && chrome.exitCode === null) {
    spawnSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
  } else {
    try { await Promise.race([closeBrowser?.(), sleep(1500)]); } catch {}
  }
  try {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
      socket.close();
      await Promise.race([closed, sleep(1000)]);
    }
  } catch {}
  if (chrome.exitCode === null) chrome.kill();
  await Promise.race([
    new Promise((resolve) => chrome.once('exit', resolve)),
    sleep(1000),
  ]);
  try {
    await Promise.race([fs.rm(profile, { recursive: true, force: true }), sleep(1500)]);
  } catch {}
}

// Successful standalone crawls must not inherit lingering undici/CDP handles.
// All evidence is already flushed to disk before the finally block runs.
process.exit(0);
