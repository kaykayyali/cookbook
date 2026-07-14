import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const token = process.env.COOKBOOK_TOKEN;
if (!token) throw new Error('COOKBOOK_TOKEN is required');
const baseUrl = process.env.COOKBOOK_URL || 'https://cookbook.damascusfront.net/';
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
  const click = async (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
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

  const report = { url: baseUrl, auth, desktop: {}, mobile: {}, overlays: {}, consoleMessages, networkFailures };
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
  await fs.writeFile(path.join(outDir, 'crawl-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outDir, panels: panels.length * 2, overlays: Object.keys(report.overlays), errors: report.consoleMessages.length, networkFailures: report.networkFailures.length }, null, 2));
} finally {
  // Shut down Chrome's complete process tree. Killing only the launcher can
  // leave a CDP child and WebSocket alive on Windows after the report exists.
  try { await Promise.race([closeBrowser?.(), sleep(1500)]); } catch {}
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
  await fs.rm(profile, { recursive: true, force: true });
}
