import fs from 'node:fs/promises';

const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223';
const url = process.env.VERIFY_URL || 'http://127.0.0.1:4173';
const out = process.env.VERIFY_SCREENSHOT || 'artifacts/cookbook-shopping-390.png';
const targets = await (await fetch(`${endpoint}/json`)).json();
const target = targets.find((item) => item.type === 'page');
if (!target) throw new Error('No Chrome page target');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
const events = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result);
    return;
  }
  for (const resolve of events.get(message.method) || []) resolve(message.params);
  events.delete(message.method);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
function once(method) {
  return new Promise((resolve) => events.set(method, [...(events.get(method) || []), resolve]));
}
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  screenWidth: 390, screenHeight: 844,
});
const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url });
await loaded;
await new Promise((resolve) => setTimeout(resolve, 300));
const expression = `(() => {
  document.querySelector('#login-gate')?.setAttribute('style', 'display:none');
  const main = document.querySelector('#main-content'); if (main) main.style.display = 'block';
  document.querySelectorAll('.panel').forEach((node) => node.classList.remove('active'));
  document.querySelector('#panel-cart')?.classList.add('active');
  document.body.dataset.panel = 'cart';
  const selectors = ['#panel-cart', '.shopping-tools', '.shopping-manual-add', '.plan-shop-tools', '#shopping-filter', '#shopping-manual-input', '#plan-shop-generate'];
  const rects = Object.fromEntries(selectors.map((selector) => {
    const node = document.querySelector(selector); const rect = node?.getBoundingClientRect();
    return [selector, rect ? { left: rect.left, right: rect.right, width: rect.width, height: rect.height } : null];
  }));
  const controls = [...document.querySelectorAll('#panel-cart button, #panel-cart input')]
    .filter((node) => getComputedStyle(node).display !== 'none')
    .map((node) => ({ id: node.id, height: node.getBoundingClientRect().height }));
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    mobileMedia: matchMedia('(max-width: 36rem)').matches,
    rects, controls,
    visiblePanel: document.querySelector('.panel.active')?.id,
  };
})()`;
const evaluated = await send('Runtime.evaluate', { expression, returnByValue: true });
const metrics = evaluated.result.value;
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
await fs.mkdir(out.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
await fs.writeFile(out, Buffer.from(screenshot.data, 'base64'));
socket.close();
const overflow = Object.entries(metrics.rects).filter(([, rect]) => !rect || rect.left < -0.5 || rect.right > 390.5);
if (metrics.innerWidth !== 390 || metrics.scrollWidth !== 390 || !metrics.mobileMedia || metrics.visiblePanel !== 'panel-cart' || overflow.length) {
  console.error(JSON.stringify({ metrics, overflow }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ metrics, screenshot: out }, null, 2));
