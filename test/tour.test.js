import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initTour } from '../docs/js/controllers/tour.js';
import { createCookbookTour } from '../docs/js/lib/cookbook-tour.js';

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="before">Before</button>
    <section id="week"><header></header><div class="suggestions"></div><div class="planner"></div></section>
    <section id="recipes"><header></header><div class="grid"></div></section>
    <section id="pantry"><div class="add"></div></section>
    <section id="cart"><div class="tools"></div></section>
    <section id="settings"><header></header></section>
  </body>`, { url: 'https://cookbook.test/' });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.scrollBy = () => {};
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.requestAnimationFrame = (callback) => callback();
  const selectors = {
    welcome: '#week header', suggestions: '#week .suggestions', planner: '#week .planner',
    recipes: '#recipes header', recipeGrid: '#recipes .grid', pantry: '#pantry .add',
    shopping: '#cart .tools', settings: '#settings header',
  };
  return { dom, selectors };
}

function setup({ completed = false, currentPanel = 'week' } = {}) {
  const { dom, selectors } = fixture();
  const storage = dom.window.localStorage;
  const tour = createCookbookTour({ selectors });
  const key = 'cb_tour_cookbook_v1_member-1';
  if (completed) storage.setItem(key, 'complete');
  const navigated = [];
  let activePanel = currentPanel;
  const controller = initTour({
    tours: [tour], document: dom.window.document, window: dom.window,
    storage, subject: 'member-1',
    navigate: (panel) => { activePanel = panel; navigated.push(panel); },
    getCurrentPanel: () => activePanel,
    isPresentationReady: () => true,
  });
  return { dom, storage, controller, navigated, key, tour };
}

test('cookbook tour teaches the complete shared-household flow', () => {
  const { tour } = setup();
  assert.equal(tour.steps.length, 8);
  assert.deepEqual([...new Set(tour.steps.map((step) => step.panel))], ['week', 'recipes', 'pantry', 'cart', 'settings']);
  assert.equal(new Set(tour.steps.map((step) => step.id)).size, tour.steps.length);
  assert.match(tour.steps.map((step) => step.body).join(' '), /shared|both of you/i);
  assert.match(tour.steps.map((step) => step.body).join(' '), /Update from plan/);
});

test('first-run tour navigates panels and exposes accessible progress controls', () => {
  const { dom, controller, navigated } = setup();
  dom.window.document.getElementById('before').focus();

  assert.equal(controller.maybeStart('cookbook'), true);
  const dialog = dom.window.document.querySelector('.tour-dialog');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dom.window.document.getElementById('before').inert, true);
  assert.equal(dom.window.document.querySelector('.tour-copy').getAttribute('aria-live'), 'polite');
  assert.match(dialog.textContent, /1 of 8/);
  assert.deepEqual(navigated, ['week']);

  dialog.scrollTop = 100;
  controller.next();
  assert.match(dialog.textContent, /2 of 8/);
  assert.equal(dialog.scrollTop, 0);
  assert.deepEqual(navigated, ['week', 'week']);
  assert.equal(dom.window.document.querySelector('.tour-back').disabled, false);
  assert.equal(dom.window.document.querySelector('.tour-next').textContent.trim(), 'Next');
});

test('Shift+Tab from the focused dialog wraps to the last enabled control', () => {
  const { dom, controller } = setup();
  controller.start('cookbook');
  const dialog = dom.window.document.querySelector('.tour-dialog');
  assert.equal(dom.window.document.activeElement, dialog);
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(dom.window.document.activeElement, dom.window.document.querySelector('.tour-next'));
});

test('finishing remembers completion per member and restores prior focus', () => {
  const { dom, controller, storage, key } = setup();
  const before = dom.window.document.getElementById('before');
  before.focus();
  controller.start('cookbook');
  for (let index = 1; index < 8; index += 1) controller.next();
  assert.equal(dom.window.document.querySelector('.tour-next').textContent.trim(), 'Done');
  controller.next();

  assert.equal(storage.getItem(key), 'complete');
  assert.equal(controller.isOpen(), false);
  assert.equal(dom.window.document.activeElement, before);
});

test('completed tour stays quiet on boot but can be relaunched explicitly', () => {
  const { controller } = setup({ completed: true });
  assert.equal(controller.maybeStart('cookbook'), false);
  assert.equal(controller.isOpen(), false);
  assert.equal(controller.start('cookbook'), true);
  assert.equal(controller.isOpen(), true);
});

test('closing after cross-panel navigation returns to the launch panel before restoring focus', () => {
  const { dom, controller, navigated } = setup({ currentPanel: 'settings' });
  const launch = dom.window.document.getElementById('before');
  launch.focus();
  controller.start('cookbook');
  controller.next();
  controller.close();
  assert.equal(navigated.at(-1), 'settings');
  assert.equal(dom.window.document.activeElement, launch);
  assert.equal(launch.inert, false);
});

test('mobile target scrolling reserves the area occupied by the bottom sheet', () => {
  const { dom, controller } = setup();
  Object.defineProperty(dom.window, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 480, configurable: true });
  let scrollRequest = null;
  dom.window.document.querySelector('#week header').scrollIntoView = (options) => { scrollRequest = options; };
  controller.start('cookbook');
  assert.deepEqual(scrollRequest, { behavior: 'auto', block: 'start' });
});

test('dynamic panel rerenders re-resolve the active target and spotlight', async () => {
  const { dom, controller } = setup();
  const oldTarget = dom.window.document.querySelector('#week header');
  oldTarget.getBoundingClientRect = () => ({ left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 });
  controller.start('cookbook');
  const replacement = dom.window.document.createElement('header');
  replacement.getBoundingClientRect = () => ({ left: 120, top: 130, right: 260, bottom: 200, width: 140, height: 70 });
  oldTarget.replaceWith(replacement);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(replacement.classList.contains('tour-target'), true);
  assert.equal(oldTarget.classList.contains('tour-target'), false);
  assert.equal(dom.window.document.querySelector('.tour-spotlight').style.left, '114px');
});

test('spotlight cutout follows the active target instead of dimming its contents', () => {
  const { dom, controller } = setup();
  const target = dom.window.document.querySelector('#week header');
  target.getBoundingClientRect = () => ({ left: 20, top: 30, right: 220, bottom: 110, width: 200, height: 80 });
  controller.start('cookbook');
  const spotlight = dom.window.document.querySelector('.tour-spotlight');
  assert.equal(spotlight.hidden, false);
  assert.equal(spotlight.style.left, '14px');
  assert.equal(spotlight.style.top, '24px');
  assert.equal(spotlight.style.width, '212px');
  assert.equal(spotlight.style.height, '92px');
});

test('spotlight geometry is clamped to the visible viewport', () => {
  const { dom, controller } = setup();
  Object.defineProperty(dom.window, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 400, configurable: true });
  const target = dom.window.document.querySelector('#week header');
  target.getBoundingClientRect = () => ({ left: -50, top: -20, right: 450, bottom: 600, width: 500, height: 620 });
  controller.start('cookbook');
  const spotlight = dom.window.document.querySelector('.tour-spotlight');
  assert.equal(spotlight.style.left, '8px');
  assert.equal(spotlight.style.top, '8px');
  assert.equal(spotlight.style.width, '374px');
  assert.equal(spotlight.style.height, '384px');
});

test('desktop placement uses the rendered dialog height when clamping', () => {
  const { dom, controller } = setup();
  Object.defineProperty(dom.window, 'innerWidth', { value: 800, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 400, configurable: true });
  const target = dom.window.document.querySelector('#week header');
  target.getBoundingClientRect = () => ({ left: 450, top: 300, right: 650, bottom: 350, width: 200, height: 50 });
  const dialog = dom.window.document.querySelector('.tour-dialog');
  dialog.getBoundingClientRect = () => ({ width: 300, height: 250 });
  controller.start('cookbook');
  assert.equal(dialog.style.left, '132px');
  assert.equal(dialog.style.top, '134px');
});

for (const placement of [
  { name: 'right', viewport: [1000, 800], target: { left: 100, top: 100, right: 300, bottom: 150, width: 200, height: 50 }, expected: ['right', '318px', '100px'] },
  { name: 'bottom', viewport: [800, 800], target: { left: 200, top: 50, right: 600, bottom: 100, width: 400, height: 50 }, expected: ['bottom', '200px', '118px'] },
  { name: 'top', viewport: [800, 700], target: { left: 200, top: 500, right: 600, bottom: 550, width: 400, height: 50 }, expected: ['top', '200px', '282px'] },
]) {
  test(`desktop placement supports the ${placement.name} branch`, () => {
    const { dom, controller } = setup();
    Object.defineProperty(dom.window, 'innerWidth', { value: placement.viewport[0], configurable: true });
    Object.defineProperty(dom.window, 'innerHeight', { value: placement.viewport[1], configurable: true });
    dom.window.document.querySelector('#week header').getBoundingClientRect = () => placement.target;
    const dialog = dom.window.document.querySelector('.tour-dialog');
    dialog.getBoundingClientRect = () => ({ width: 300, height: 200 });
    controller.start('cookbook');
    assert.deepEqual([dialog.dataset.placement, dialog.style.left, dialog.style.top], placement.expected);
  });
}

test('missing targets fall back to a centered dialog instead of aborting the guide', () => {
  const { dom, selectors } = fixture();
  const tour = createCookbookTour({ selectors: { ...selectors, welcome: '#missing-target' } });
  const controller = initTour({
    tours: [tour], document: dom.window.document, window: dom.window,
    storage: dom.window.localStorage, subject: 'member-1',
    isPresentationReady: () => true,
  });
  assert.equal(controller.start('cookbook'), true);
  assert.equal(dom.window.document.querySelector('.tour-spotlight').hidden, true);
  assert.match(dom.window.document.querySelector('.tour-dialog').textContent, /Welcome to your shared cookbook/);
});

test('reduced-motion preference disables smooth spotlight scrolling', () => {
  const { dom, controller } = setup();
  let options;
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.document.querySelector('#week header').scrollIntoView = (value) => { options = value; };
  controller.start('cookbook');
  assert.equal(options.behavior, 'auto');
});

test('Escape dismisses the tour without trapping the user in onboarding', () => {
  const { dom, controller, storage, key } = setup();
  controller.start('cookbook');
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(controller.isOpen(), false);
  assert.equal(storage.getItem(key), 'complete');
});

test('tour startup fails open and restores interaction when a step throws', () => {
  const { dom, selectors } = fixture();
  const controller = initTour({
    tours: [createCookbookTour({ selectors })],
    document: dom.window.document,
    window: dom.window,
    storage: dom.window.localStorage,
    subject: 'member-1',
    navigate: () => { throw new Error('panel failed to render'); },
    isPresentationReady: () => true,
  });

  let started;
  assert.doesNotThrow(() => { started = controller.start('cookbook'); });
  assert.equal(started, false);
  assert.equal(controller.isOpen(), false);
  assert.equal(dom.window.document.body.classList.contains('tour-open'), false);
  assert.equal(dom.window.document.querySelector('.tour-layer').hidden, true);
  assert.equal([...dom.window.document.body.children].some((node) => node.inert), false);
});

test('tour does not make the app inert when its presentation styles are unavailable', () => {
  const { dom, selectors } = fixture();
  const controller = initTour({
    tours: [createCookbookTour({ selectors })],
    document: dom.window.document,
    window: dom.window,
    storage: dom.window.localStorage,
    subject: 'member-1',
  });

  assert.equal(controller.start('cookbook'), false);
  assert.equal(controller.isOpen(), false);
  assert.equal(dom.window.document.querySelector('.tour-layer').hidden, true);
  assert.equal([...dom.window.document.body.children].some((node) => node.inert), false);
});

test('tour fails open when its presentation readiness check throws', () => {
  const { dom, selectors } = fixture();
  const controller = initTour({
    tours: [createCookbookTour({ selectors })],
    document: dom.window.document,
    window: dom.window,
    storage: dom.window.localStorage,
    subject: 'member-1',
    isPresentationReady: () => { throw new Error('style lookup failed'); },
  });

  let started;
  assert.doesNotThrow(() => { started = controller.start('cookbook'); });
  assert.equal(started, false);
  assert.equal(controller.isOpen(), false);
  assert.equal(dom.window.document.querySelector('.tour-layer').hidden, true);
  assert.equal([...dom.window.document.body.children].some((node) => node.inert), false);
});

test('tour releases inert state when navigation throws after startup', () => {
  const { dom, selectors } = fixture();
  let calls = 0;
  let activePanel = 'recipes';
  const controller = initTour({
    tours: [createCookbookTour({ selectors })],
    document: dom.window.document,
    window: dom.window,
    storage: dom.window.localStorage,
    subject: 'member-1',
    navigate: (panel) => {
      calls += 1;
      activePanel = panel;
      if (calls === 2) throw new Error('panel failed to render');
    },
    getCurrentPanel: () => activePanel,
    isPresentationReady: () => true,
  });

  dom.window.document.getElementById('before').focus();
  assert.equal(controller.start('cookbook'), true);
  assert.equal([...dom.window.document.body.children].some((node) => node.inert), true);
  assert.doesNotThrow(() => controller.next());
  assert.equal(controller.isOpen(), false);
  assert.equal(dom.window.document.querySelector('.tour-layer').hidden, true);
  assert.equal([...dom.window.document.body.children].some((node) => node.inert), false);
  assert.equal(activePanel, 'recipes');
  assert.equal(dom.window.document.activeElement.id, 'before');
});
