import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  convertPantryEditorAmount,
  normalizePantry,
  pantryEditorState,
  pantryRecordFromEditor,
  pantryUnitsForFamily,
  updatePantryRecord,
} from '../docs/js/lib/pantry.js';
import { initPantry } from '../docs/js/controllers/pantry.js';

const oliveOil = () => normalizePantry([{
  id: 'pantry-olive-oil', raw: '2 cups Olive Oil', rawEvidence: ['olive oil', '2 cups Olive Oil'],
  name: 'olive oil', displayName: 'Olive Oil', quantity: 16, unit: 'ounce', kind: 'divisible',
  countLabel: '', category: 'pantry', confidence: 0.91, normalizationVersion: 1, updatedAt: 100,
}])[0];

test('Pantry editor derives family-appropriate values from retained raw context', () => {
  assert.deepEqual(pantryEditorState(oliveOil()), {
    name: 'Olive Oil', quantity: 2, family: 'fluid', unit: 'cup', raw: '2 cups Olive Oil',
  });
  assert.deepEqual(pantryUnitsForFamily('count').map(({ value }) => value), [
    'item', 'clove', 'slice', 'sheet', 'portion', 'can', 'jar', 'bottle', 'package', 'piece',
  ]);
  assert.deepEqual(pantryUnitsForFamily('solid').map(({ value }) => value), ['ounce', 'pound', 'gram', 'kilogram']);
  assert.deepEqual(pantryUnitsForFamily('fluid').map(({ value }) => value), [
    'teaspoon', 'tablespoon', 'fluid-ounce', 'cup', 'milliliter', 'liter',
  ]);
  assert.deepEqual(pantryUnitsForFamily('unknown'), []);
});

test('Solid and Fluid editor units share deterministic water-equivalent canonical conversion', () => {
  assert.equal(convertPantryEditorAmount(2, 'cup', 'ounce'), 16);
  assert.equal(convertPantryEditorAmount(16, 'ounce', 'cup'), 2);
  assert.equal(convertPantryEditorAmount(1, 'liter', 'gram'), 1000);
  assert.equal(convertPantryEditorAmount(1000, 'gram', 'liter'), 1);
});

test('Pantry editor save preserves identity and evidence metadata while applying a correction', () => {
  const original = oliveOil();
  const corrected = pantryRecordFromEditor({
    name: 'Avocado Oil', quantity: 16, family: 'solid', unit: 'ounce',
  }, original, { updatedAt: 200 });
  assert.equal(corrected.id, original.id);
  assert.equal(corrected.name, 'avocado oil');
  assert.equal(corrected.displayName, 'Avocado Oil');
  assert.equal(corrected.quantity, 16);
  assert.equal(corrected.unit, 'ounce');
  assert.equal(corrected.raw, '16 ounces Avocado Oil');
  assert.deepEqual(corrected.rawEvidence, original.rawEvidence, 'the reducer owns lossless evidence merging');
  assert.equal(corrected.confidence, 1, 'a human-entered amount is trusted over extraction confidence');
  assert.equal(corrected.amountSource, 'manual');
  assert.equal(corrected.normalizationVersion, original.normalizationVersion);
  assert.equal(corrected.updatedAt, 200);
});

test('Not sure clears trusted quantity without dropping correction metadata', () => {
  const original = oliveOil();
  const corrected = pantryRecordFromEditor({
    name: 'Olive Oil', quantity: '', family: 'unknown', unit: '',
  }, original, { updatedAt: 200 });
  assert.equal(corrected.amountState, 'unknown');
  assert.equal(corrected.quantity, null);
  assert.equal(corrected.unit, 'qualitative');
  assert.equal(corrected.raw, '2 cups Olive Oil', 'Not sure keeps the useful original line primary');
  assert.deepEqual(corrected.rawEvidence, ['olive oil', '2 cups Olive Oil']);
  assert.equal(corrected.confidence, original.confidence);
  assert.equal(corrected.normalizationVersion, original.normalizationVersion);
  assert.equal(corrected.updatedAt, 200);
});

test('manual Count, Solid, and Fluid corrections override low extraction confidence durably', () => {
  const unknownEggs = normalizePantry([{
    id: 'pantry-eggs', raw: 'eggs', name: 'egg', displayName: 'Eggs', quantity: null,
    unit: 'qualitative', amountState: 'unknown', confidence: 0.4,
  }])[0];
  const cases = [
    [{ name: 'Eggs', quantity: 12, family: 'count', unit: 'item' }, 12, 'count'],
    [{ name: 'Flour', quantity: 2, family: 'solid', unit: 'pound' }, 32, 'ounce'],
    [{ name: 'Olive Oil', quantity: 2, family: 'fluid', unit: 'cup' }, 16, 'ounce'],
  ];
  for (const [editor, quantity, unit] of cases) {
    const corrected = pantryRecordFromEditor(editor, unknownEggs, { updatedAt: 200 });
    const reopened = normalizePantry([corrected])[0];
    assert.equal(reopened.amountState, 'known', editor.family);
    assert.equal(reopened.quantity, quantity, editor.family);
    assert.equal(reopened.unit, unit, editor.family);
    assert.equal(reopened.confidence, 1, editor.family);
    assert.equal(reopened.amountSource, 'manual', editor.family);
  }
});

test('unsafe Pantry metadata is normalized to bounded defaults', () => {
  const [record] = normalizePantry([{
    raw: '3 eggs', name: 'egg', displayName: 'Eggs', quantity: 3, unit: 'count',
    confidence: 1, normalizationVersion: Number.MAX_SAFE_INTEGER, updatedAt: Number.MAX_VALUE,
  }]);
  assert.equal(record.normalizationVersion, 1);
  assert.equal(record.updatedAt, 0);
});

test('Pantry editor visibly rejects blank names and invalid trusted amounts', () => {
  assert.throws(() => pantryRecordFromEditor({ name: ' ', quantity: 1, family: 'count', unit: 'item' }, null), /name/i);
  assert.throws(() => pantryRecordFromEditor({ name: 'Eggs', quantity: 0, family: 'count', unit: 'item' }, null), /amount/i);
  assert.throws(() => pantryRecordFromEditor({ name: 'Eggs', quantity: 2, family: 'fluid', unit: 'bottle' }, null), /unit/i);
  for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => pantryRecordFromEditor({ name: 'Eggs', quantity, family: 'count', unit: 'item' }, null), /amount/i);
  }
});

function editorDom() {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="pantry-input"><button id="pantry-add-btn" data-feedback="select">Add item</button>
    <input id="pantry-search"><div id="pantry-filters"></div><p id="pantry-summary"></p><div id="pantry-grid"></div>
    <div id="pantry-item-overlay" hidden></div>
    <section id="pantry-item-modal" role="dialog" aria-modal="true" aria-hidden="true" inert hidden>
      <h2 id="pantry-item-title"></h2><button id="pantry-item-close" type="button">Close</button>
      <form id="pantry-item-form">
        <input id="pantry-item-name"><input id="pantry-item-quantity" type="number">
        <select id="pantry-item-family"><option value="count">Count</option><option value="solid">Solid</option><option value="fluid">Fluid</option><option value="unknown">Not sure</option></select>
        <select id="pantry-item-unit"></select><output id="pantry-item-raw"></output>
        <ul id="pantry-item-raw-evidence" hidden></ul>
        <p id="pantry-item-error"></p><p id="pantry-item-status"></p>
        <button id="pantry-item-save" type="submit" data-feedback="commit">Save</button>
        <button id="pantry-item-remove" type="button" data-feedback="select">Remove from Pantry</button>
        <div id="pantry-remove-confirm" hidden><button data-action="cancel-pantry-remove" type="button">Cancel</button><button data-action="confirm-pantry-remove" type="button">Remove</button></div>
      </form>
    </section>
    <div id="toast"></div>
  </body>`, { url: 'https://example.test' });
  return dom;
}

const click = (window, element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('Pantry editor locks body scrolling and restores the exact previous overflow value', () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  dom.window.document.body.style.overflow = 'scroll';
  const target = oliveOil();
  const controller = initPantry({
    state: { pantry: [target], recipes: [] }, document: dom.window.document, mutate: async () => true,
  });
  controller.render();

  click(dom.window, dom.window.document.querySelector(`[data-pantry-id="${target.id}"]`));
  assert.equal(dom.window.document.getElementById('pantry-item-modal').getAttribute('aria-modal'), 'true');
  assert.equal(dom.window.document.body.style.overflow, 'hidden');

  assert.equal(controller.closeEditor(), true);
  assert.equal(dom.window.document.body.style.overflow, 'scroll');
});

test('Pantry editor owns one body lock and repeated open or close cannot corrupt newer overflow', () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const style = dom.window.document.body.style;
  style.setProperty('overflow', 'scroll', 'important');
  const target = oliveOil();
  const controller = initPantry({
    state: { pantry: [target], recipes: [] }, document: dom.window.document, mutate: async () => true,
  });
  controller.render();

  assert.equal(controller.openEditor(target.id), true);
  assert.equal(style.getPropertyValue('overflow'), 'hidden');
  assert.equal(controller.openEditor(target.id), false, 'an already-open editor does not reacquire the body lock');
  assert.equal(controller.closeEditor(), true);
  assert.equal(style.getPropertyValue('overflow'), 'scroll');
  assert.equal(style.getPropertyPriority('overflow'), 'important', 'release restores the exact previous priority');

  style.setProperty('overflow', 'clip');
  assert.equal(controller.closeEditor(), false, 'closing an inactive editor is a no-op');
  assert.equal(style.getPropertyValue('overflow'), 'clip', 'a repeated close cannot overwrite newer body state');
  assert.equal(style.getPropertyPriority('overflow'), '');
});

test('Pantry editor preserves an external overflow owner that takes over during its lock', () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const style = dom.window.document.body.style;
  style.setProperty('overflow', 'scroll', 'important');
  const target = oliveOil();
  const controller = initPantry({
    state: { pantry: [target], recipes: [] }, document: dom.window.document, mutate: async () => true,
  });
  controller.render();

  assert.equal(controller.openEditor(target.id), true);
  assert.equal(style.getPropertyValue('overflow'), 'hidden');
  style.setProperty('overflow', 'clip', 'important');

  assert.equal(controller.closeEditor(), true);
  assert.equal(style.getPropertyValue('overflow'), 'clip', 'close preserves the newer external overflow value');
  assert.equal(style.getPropertyPriority('overflow'), 'important', 'close preserves the newer external priority');
  assert.equal(controller.closeEditor(), false, 'repeated close remains a no-op after external takeover');
  assert.equal(style.getPropertyValue('overflow'), 'clip');
  assert.equal(style.getPropertyPriority('overflow'), 'important');

  assert.equal(controller.openEditor(target.id), true, 'ownership is cleared so a later editor can acquire a new lock');
  assert.equal(style.getPropertyValue('overflow'), 'hidden');
  assert.equal(controller.closeEditor(), true);
  assert.equal(style.getPropertyValue('overflow'), 'clip');
  assert.equal(style.getPropertyPriority('overflow'), 'important');
});

test('entire Pantry row opens the edit modal and save updates exactly one stable record', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const target = oliveOil();
  const sibling = normalizePantry([{
    id: 'pantry-oil-bottles', raw: '2 bottles olive oil', name: 'olive oil', displayName: 'Olive Oil',
    quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', confidence: 0.88, updatedAt: 101,
  }])[0];
  const state = { pantry: [target, sibling], recipes: [] };
  const mutations = [];
  const controller = initPantry({
    state, document: dom.window.document,
    mutate: async (op, payload) => { mutations.push({ op, payload }); return true; },
  });
  controller.render();
  const row = dom.window.document.querySelector(`[data-pantry-id="${target.id}"]`);
  assert.equal(row.tagName, 'BUTTON', 'the whole row is keyboard-selectable');
  click(dom.window, row);
  assert.equal(dom.window.document.getElementById('pantry-item-modal').hidden, false);
  assert.equal(dom.window.document.getElementById('pantry-item-name').value, 'Olive Oil');
  assert.equal(dom.window.document.getElementById('pantry-item-family').value, 'fluid');
  assert.equal(dom.window.document.getElementById('pantry-item-unit').value, 'cup');

  dom.window.document.getElementById('pantry-item-name').value = 'Avocado Oil';
  dom.window.document.getElementById('pantry-item-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();

  assert.equal(state.pantry.length, 2);
  assert.equal(state.pantry.find((item) => item.id === target.id).name, 'avocado oil');
  assert.equal(state.pantry.find((item) => item.id === target.id).displayName, 'Avocado Oil');
  assert.equal(state.pantry.find((item) => item.id === sibling.id).name, 'olive oil');
  assert.equal(mutations[0].op, 'pantry.update');
  assert.equal(mutations[0].payload.id, target.id);
  assert.equal(dom.window.document.getElementById('pantry-item-modal').hidden, true);
});

test('add-new opens the same modal and invalid input stays open with an inline error', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const state = { pantry: [], recipes: [] };
  const controller = initPantry({ state, document: dom.window.document, mutate: async () => true });
  const addButton = dom.window.document.getElementById('pantry-add-btn');
  click(dom.window, addButton);
  assert.equal(dom.window.document.getElementById('pantry-item-title').textContent, 'Add Pantry item');
  dom.window.document.getElementById('pantry-item-name').value = '';
  dom.window.document.getElementById('pantry-item-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(dom.window.document.getElementById('pantry-item-modal').hidden, false);
  assert.match(dom.window.document.getElementById('pantry-item-error').textContent, /name/i);
  assert.equal(state.pantry.length, 0);
  assert.equal(controller.editorRecordId(), null);
});

test('remove requires confirmation, targets the exact ID, and offers undo', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const target = oliveOil();
  const sibling = normalizePantry(['2 bottles olive oil'])[0];
  const state = { pantry: [target, sibling], recipes: [] };
  const mutations = [];
  const controller = initPantry({
    state, document: dom.window.document,
    mutate: async (op, payload) => { mutations.push({ op, payload }); return true; },
  });
  controller.render();
  click(dom.window, dom.window.document.querySelector(`[data-pantry-id="${target.id}"]`));
  click(dom.window, dom.window.document.getElementById('pantry-item-remove'));
  assert.equal(state.pantry.length, 2, 'first click only reveals confirmation');
  assert.equal(dom.window.document.getElementById('pantry-remove-confirm').hidden, false);
  click(dom.window, dom.window.document.querySelector('[data-action="confirm-pantry-remove"]'));
  await tick();
  assert.deepEqual(state.pantry.map(({ id }) => id), [sibling.id]);
  assert.equal(mutations[0].op, 'pantry.remove');
  assert.equal(mutations[0].payload.id, target.id);
  assert.match(mutations[0].payload.expectedFingerprint, /^pantry-v1:/);
  const undo = dom.window.document.querySelector('#toast [data-toast-action]');
  assert.ok(undo, 'removal toast includes an Undo action');
  click(dom.window, undo);
  await tick();
  assert.equal(state.pantry.some((item) => item.id === target.id), true);
  assert.equal(mutations[1].op, 'pantry.restore');
  assert.equal(mutations[1].payload.expectedAbsent, true);
  assert.equal(mutations[1].payload.item.id, target.id);
});

test('Undo refuses a remotely recreated same ID instead of sending stale add or duplicating it', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const target = oliveOil();
  const state = { pantry: [target], recipes: [] };
  const mutations = [];
  const controller = initPantry({
    state, document: dom.window.document,
    mutate: async (op, payload) => { mutations.push({ op, payload }); return true; },
  });
  controller.render();
  click(dom.window, dom.window.document.querySelector(`[data-pantry-id="${target.id}"]`));
  click(dom.window, dom.window.document.getElementById('pantry-item-remove'));
  click(dom.window, dom.window.document.querySelector('[data-action="confirm-pantry-remove"]'));
  await tick();
  const remote = normalizePantry([{ ...target, raw: '3 cups Olive Oil', quantity: 24, updatedAt: 300 }])[0];
  state.pantry = [remote];
  controller.render();
  click(dom.window, dom.window.document.querySelector('#toast [data-toast-action]'));
  await tick();
  assert.equal(mutations.length, 1, 'Undo sends no compensation after authority reused the stable ID');
  assert.deepEqual(state.pantry.map(({ id, quantity }) => ({ id, quantity })), [{ id: target.id, quantity: 24 }]);
  assert.match(dom.window.document.getElementById('toast').textContent, /changed.*cannot.*restore|cannot.*restore.*changed/i);
});

test('Escape is consumed while save is pending so later handlers cannot hide feedback', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const state = { pantry: [oliveOil()], recipes: [] };
  const controller = initPantry({ state, document: dom.window.document, mutate: () => pending });
  controller.render();
  click(dom.window, dom.window.document.querySelector('[data-pantry-id="pantry-olive-oil"]'));
  dom.window.document.getElementById('pantry-item-name').value = 'Draft Oil';
  dom.window.document.getElementById('pantry-item-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  let escapedToGlobal = false;
  dom.window.document.addEventListener('keydown', () => { escapedToGlobal = true; });
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(escapedToGlobal, false);
  assert.equal(dom.window.document.getElementById('pantry-item-modal').hidden, false);
  assert.equal(dom.window.document.getElementById('pantry-item-name').value, 'Draft Oil');
  release(false);
  await tick();
  assert.match(dom.window.document.getElementById('pantry-item-error').textContent, /could not be saved/i);
});

test('save failure rolls back optimistic state but keeps modal edits and visible status', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const target = oliveOil();
  const state = { pantry: [target], recipes: [] };
  const controller = initPantry({ state, document: dom.window.document, mutate: async () => false });
  controller.render();
  click(dom.window, dom.window.document.querySelector(`[data-pantry-id="${target.id}"]`));
  dom.window.document.getElementById('pantry-item-name').value = 'Avocado Oil';
  dom.window.document.getElementById('pantry-item-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();

  assert.equal(state.pantry[0].name, 'olive oil', 'failed optimistic edit is rolled back');
  assert.equal(dom.window.document.getElementById('pantry-item-modal').hidden, false);
  assert.equal(dom.window.document.getElementById('pantry-item-name').value, 'Avocado Oil', 'draft remains intact');
  assert.match(dom.window.document.getElementById('pantry-item-error').textContent, /could not be saved/i);
});

test('Not sure edit refuses to combine oil bottles with ounce authority and keeps both stable IDs', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const state = { pantry: normalizePantry([
    {
      id: 'oil-bottles', raw: '2 bottles Oil', name: 'oil', displayName: 'Oil',
      quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle', confidence: 1,
    },
    {
      id: 'oil-ounce', raw: '1 ounce Oil', name: 'oil', displayName: 'Oil',
      quantity: 1, unit: 'ounce', kind: 'divisible', countLabel: '', confidence: 1,
    },
  ]), recipes: [] };
  const before = structuredClone(state.pantry);
  const mutations = [];
  const controller = initPantry({
    state, document: dom.window.document,
    mutate: async (op, payload) => { mutations.push({ op, payload }); return true; },
  });
  controller.render();
  click(dom.window, dom.window.document.querySelector('[data-pantry-id="oil-bottles"]'));
  const family = dom.window.document.getElementById('pantry-item-family');
  family.value = 'unknown';
  family.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.getElementById('pantry-item-form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();

  assert.deepEqual(state.pantry, before);
  assert.deepEqual(state.pantry.map(({ id }) => id).sort(), ['oil-bottles', 'oil-ounce']);
  assert.equal(mutations.length, 0, 'identity-losing update never reaches sync');
  assert.equal(dom.window.document.getElementById('pantry-item-modal').hidden, false);
  assert.match(dom.window.document.getElementById('pantry-item-error').textContent,
    /cannot save.*combine.*another.*item|keep both.*separate/i);
});

test('remote update or deletion blocks stale modal save without losing the draft', async () => {
  for (const remoteChange of ['update', 'delete']) {
    const dom = editorDom();
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.localStorage = dom.window.localStorage;
    const target = oliveOil();
    const state = { pantry: [target], recipes: [] };
    const mutations = [];
    const controller = initPantry({
      state, document: dom.window.document,
      mutate: async (op, payload) => { mutations.push({ op, payload }); return true; },
    });
    controller.render();
    click(dom.window, dom.window.document.querySelector(`[data-pantry-id="${target.id}"]`));
    dom.window.document.getElementById('pantry-item-name').value = 'My local draft';
    state.pantry = remoteChange === 'delete' ? [] : updatePantryRecord(state.pantry, target.id, {
      ...target, raw: '3 cups Olive Oil', quantity: 24,
    }, { updatedAt: target.updatedAt });
    controller.render();
    assert.match(dom.window.document.getElementById('pantry-item-error').textContent,
      remoteChange === 'delete' ? /removed by another/i : /changed in the shared Pantry/i);
    dom.window.document.getElementById('pantry-item-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.equal(mutations.length, 0, remoteChange);
    assert.equal(dom.window.document.getElementById('pantry-item-name').value, 'My local draft', remoteChange);
    assert.equal(dom.window.document.getElementById('pantry-item-modal').hidden, false, remoteChange);
  }
});

test('Pantry modal routes family, save, remove, blocked, and Undo semantics through injected feedback', async () => {
  const dom = editorDom();
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  const target = oliveOil();
  const state = { pantry: [target], recipes: [] };
  const events = [];
  const interaction = { trusted: true, modality: 'touch', touchOrigin: true, deferred: false };
  const feedback = {
    contextFromEvent: () => interaction,
    emit: (type, options = {}) => events.push({ type, options }),
  };
  const controller = initPantry({
    state,
    document: dom.window.document,
    mutate: async () => true,
    feedback,
  });
  controller.render();

  const row = dom.window.document.querySelector(`[data-pantry-id="${target.id}"]`);
  assert.equal(row.dataset.feedback, 'select', 'opening a Pantry record is a semantic selection');
  click(dom.window, row);
  assert.equal(events.at(-1).type, 'select');
  events.length = 0;
  const family = dom.window.document.getElementById('pantry-item-family');
  family.value = 'unknown';
  family.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  family.value = 'fluid';
  family.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.getElementById('pantry-item-quantity').value = '2';
  assert.deepEqual(events.map(({ type }) => type), ['toggle-off', 'toggle-on']);

  const save = dom.window.document.getElementById('pantry-item-save');
  assert.equal(save.dataset.feedback, 'commit', 'Save exposes the immediate commit semantic declaratively');
  dom.window.document.getElementById('pantry-item-form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(events.at(-1).type, 'success');
  assert.deepEqual(events.at(-1).options.interaction, { ...interaction, deferred: true });

  controller.openEditor(target.id);
  click(dom.window, dom.window.document.getElementById('pantry-item-remove'));
  const confirm = dom.window.document.querySelector('[data-action="confirm-pantry-remove"]');
  assert.equal(confirm.dataset.feedback, undefined, 'confirmed removal is emitted once by the controller');
  click(dom.window, confirm);
  assert.equal(events.at(-1).type, 'destructive', 'destructive feedback begins only after confirmation');
  await tick();
  assert.equal(events.at(-1).type, 'success');

  const undo = dom.window.document.querySelector('#toast [data-toast-action]');
  click(dom.window, undo);
  assert.equal(events.at(-1).type, 'commit', 'Undo emits one immediate compensating commit');
  await tick();
  assert.equal(events.at(-1).type, 'success');
  assert.deepEqual(events.at(-1).options.interaction, { ...interaction, deferred: true });

  controller.openEditor(target.id);
  state.pantry = [];
  dom.window.document.getElementById('pantry-item-form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(events.at(-1).type, 'blocked', 'stale shared-state conflicts emit one blocked outcome');
  assert.match(dom.window.document.getElementById('pantry-item-error').textContent, /removed by another/i);
});
