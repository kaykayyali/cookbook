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
  assert.equal(corrected.confidence, original.confidence);
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
  assert.equal(corrected.confidence, original.confidence);
  assert.equal(corrected.normalizationVersion, original.normalizationVersion);
  assert.equal(corrected.updatedAt, 200);
});

test('Pantry editor visibly rejects blank names and invalid trusted amounts', () => {
  assert.throws(() => pantryRecordFromEditor({ name: ' ', quantity: 1, family: 'count', unit: 'item' }, null), /name/i);
  assert.throws(() => pantryRecordFromEditor({ name: 'Eggs', quantity: 0, family: 'count', unit: 'item' }, null), /amount/i);
  assert.throws(() => pantryRecordFromEditor({ name: 'Eggs', quantity: 2, family: 'fluid', unit: 'bottle' }, null), /unit/i);
});

function editorDom() {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="pantry-input"><button id="pantry-add-btn">Add item</button>
    <input id="pantry-search"><div id="pantry-filters"></div><p id="pantry-summary"></p><div id="pantry-grid"></div>
    <div id="pantry-item-overlay" hidden></div>
    <section id="pantry-item-modal" role="dialog" aria-modal="true" hidden>
      <h2 id="pantry-item-title"></h2><button id="pantry-item-close" type="button">Close</button>
      <form id="pantry-item-form">
        <input id="pantry-item-name"><input id="pantry-item-quantity" type="number">
        <select id="pantry-item-family"><option value="count">Count</option><option value="solid">Solid</option><option value="fluid">Fluid</option><option value="unknown">Not sure</option></select>
        <select id="pantry-item-unit"></select><output id="pantry-item-raw"></output>
        <p id="pantry-item-error"></p><p id="pantry-item-status"></p>
        <button id="pantry-item-save" type="submit">Save</button>
        <button id="pantry-item-remove" type="button">Remove from Pantry</button>
        <div id="pantry-remove-confirm" hidden><button data-action="cancel-pantry-remove" type="button">Cancel</button><button data-action="confirm-pantry-remove" type="button">Remove</button></div>
      </form>
    </section>
    <div id="toast"></div>
  </body>`, { url: 'https://example.test' });
  return dom;
}

const click = (window, element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  assert.deepEqual(mutations[0], { op: 'pantry.remove', payload: { id: target.id } });
  const undo = dom.window.document.querySelector('#toast [data-toast-action]');
  assert.ok(undo, 'removal toast includes an Undo action');
  click(dom.window, undo);
  await tick();
  assert.equal(state.pantry.some((item) => item.id === target.id), true);
  assert.equal(mutations[1].op, 'pantry.add');
  assert.equal(mutations[1].payload.item.id, target.id);
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
