import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initDetail } from '../docs/js/controllers/detail.js';

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="opener">Open recipe</button>
    <div id="detail-overlay"></div>
    <div id="detail-modal" role="dialog" aria-label="Recipe detail">
      <button id="detail-close-btn">Close</button>
      <div class="detail-body"></div>
      <div id="dm-eyebrow"></div><div id="dm-title"></div><div id="dm-meta"></div><div id="dm-author-badge"></div>
      <div id="dm-ingredients"></div><div id="dm-pantry-note"></div><div id="dm-steps"></div>
      <div id="dm-nutrition"><div id="dm-nutrition-grid"></div></div><div id="dm-history"></div>
      <button id="dm-mark-cooked-btn">Mark cooked</button><button id="dm-cook-mode-btn">Cook mode</button>
      <button id="dm-add-all-btn">Add</button><button id="dm-edit-btn">Edit</button><button id="dm-schema-btn">Schema</button>
    </div>
  </body>`, { url: 'https://cookbook.test/', pretendToBeVisual: true });
  const recipe = { _id: 'r1', name: 'Soup', recipeIngredient: ['1 onion'], recipeInstructions: [] };
  const detail = initDetail({ state: { recipes: [recipe], pantry: [], cart: [], normalizations: {} }, document: dom.window.document });
  return { dom, detail };
}

function reconciliationFixture(options = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="pantry-result">Basil Starter</button>
    <div id="detail-overlay"></div>
    <div id="detail-modal" role="dialog" aria-label="Recipe detail">
      <button id="detail-close-btn">Close</button>
      <div class="detail-body"></div>
      <div id="dm-eyebrow"></div><div id="dm-title"></div><div id="dm-meta"></div><div id="dm-author-badge"></div>
      <div id="dm-ingredients"></div><div id="dm-pantry-note"></div><div id="dm-steps"></div>
      <div id="dm-nutrition"><div id="dm-nutrition-grid"></div></div><div id="dm-history"></div>
      <button id="dm-mark-cooked-btn">Mark cooked</button><button id="dm-cook-mode-btn">Cook mode</button>
      <button id="dm-add-all-btn">Add</button><button id="dm-edit-btn">Edit</button><button id="dm-schema-btn">Schema</button>
    </div>
    <div id="ingredient-correction-overlay" hidden></div>
    <section id="ingredient-correction-modal" hidden>
      <button id="ingredient-correction-close">Close correction</button>
      <form id="ingredient-correction-form">
        <output id="ingredient-correction-raw"></output><div id="ingredient-correction-provenance"></div>
        <p id="ingredient-correction-review-status"></p>
        <input id="ingredient-correction-name"><select id="ingredient-correction-state"><option value="unknown">Unknown</option><option value="numeric">Numeric</option></select>
        <label id="ingredient-correction-amount-group"><input id="ingredient-correction-amount"></label>
        <label id="ingredient-correction-family-group"><select id="ingredient-correction-family"><option value="count">Count</option></select></label>
        <label id="ingredient-correction-unit-group"><select id="ingredient-correction-unit"></select></label>
        <label id="ingredient-correction-count-label-group"><select id="ingredient-correction-count-label"></select></label>
        <p id="ingredient-correction-error"></p><p id="ingredient-correction-pending"></p>
        <button id="ingredient-correction-cancel" type="button">Cancel</button><button id="ingredient-correction-save" type="submit">Save</button>
      </form>
    </section>
  </body>`, { url: 'https://cookbook.test/', pretendToBeVisual: true });
  const recipe = {
    _id: 'r1', name: 'Basil Starter', recipeCategory: 'Starter', recipeCuisine: 'Italian',
    recipeYield: '2 servings', prepTime: 'PT5M', cookTime: 'PT10M', totalTime: 'PT15M', cookingMethod: 'Stovetop',
    recipeIngredient: ['1 cup basil'], recipeInstructions: ['Chop basil.'],
    nutrition: { calories: '100 kcal', proteinContent: '2 g' },
    _author: { sub: 'kay', name: 'Kay' },
    _provenance: { sourceUrl: 'https://old.example.test/recipe', extractorMethod: 'json-ld', extractorVersion: 'v1' },
  };
  const state = { recipes: [recipe], pantry: [], cart: [], normalizations: {}, auth: { sub: 'kay' } };
  const detail = initDetail({ state, document: dom.window.document, ...options });
  return { dom, detail, state, recipe };
}

test('recipe detail is modal, focuses inside, traps Tab, closes on Escape, and restores its opener', () => {
  const { dom, detail } = fixture();
  const { document, KeyboardEvent } = dom.window;
  const opener = document.getElementById('opener');
  const modal = document.getElementById('detail-modal');
  const close = document.getElementById('detail-close-btn');
  const last = document.getElementById('dm-schema-btn');
  assert.equal(modal.getAttribute('aria-modal'), null, 'closed detail is not exposed as modal');
  assert.equal(modal.hidden, true, 'initial detail is removed from rendering and the accessibility tree');
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
  assert.equal(modal.hasAttribute('inert'), true, 'initial detail descendants are outside the tab order');
  opener.focus();
  detail.open('r1');
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.equal(modal.hidden, false, 'open removes hidden before moving focus');
  assert.equal(modal.hasAttribute('aria-hidden'), false);
  assert.equal(modal.hasAttribute('inert'), false);
  assert.equal(document.activeElement, close, 'focus enters at the close control');

  close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, last, 'Shift+Tab wraps to the final control');
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, close, 'Tab wraps to the first control');
  close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(modal.classList.contains('open'), false);
  assert.equal(modal.getAttribute('aria-modal'), null, 'closed detail releases modal semantics');
  assert.equal(modal.hidden, true, 'close removes the detail from rendering immediately');
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
  assert.equal(modal.hasAttribute('inert'), true, 'close controls are unreachable immediately');
  assert.equal(close.closest('[hidden]'), modal);
  assert.equal(document.activeElement, opener, 'closing restores the exact opener');
});

test('authoritative reconciliation refreshes every presented recipe field while preserving scroll, stable focus, and handlers', async () => {
  let cooked = 0;
  const { dom, detail, state, recipe } = reconciliationFixture({ onMarkCooked: async () => { cooked += 1; return true; } });
  const { document } = dom.window;
  detail.open('r1');
  const scroller = document.querySelector('.detail-body');
  scroller.scrollTop = 173;
  document.querySelector('[data-action="correct-ingredient"]').focus();

  state.recipes = [{
    ...recipe,
    name: 'Parsley Starter', recipeCategory: 'Side Dish', recipeCuisine: 'French',
    recipeYield: '6 servings', prepTime: 'PT20M', cookTime: 'PT25M', totalTime: 'PT45M', cookingMethod: 'Roasting',
    recipeInstructions: ['Wash herbs.', 'Roast until crisp.'],
    nutrition: { calories: '240 kcal', proteinContent: '8 g', carbohydrateContent: '12 g' },
    _author: { sub: 'other', name: 'Ada' },
  }];
  assert.equal(detail.reconcileRecipes({ authoritative: true }), true);
  assert.equal(document.getElementById('dm-title').textContent, 'Parsley Starter');
  assert.equal(document.getElementById('dm-eyebrow').textContent, 'Side Dish · French');
  assert.match(document.getElementById('dm-meta').textContent, /Prep20mCook25mTotal45mServes6MethodRoasting/);
  assert.match(document.getElementById('dm-steps').textContent, /Wash herbs[\s\S]*Roast until crisp/);
  assert.match(document.getElementById('dm-nutrition-grid').textContent, /240 kcal[\s\S]*8 g[\s\S]*12 g/);
  assert.equal(document.getElementById('dm-author-badge').querySelector('[aria-label]')?.getAttribute('aria-label'), 'Added by Ada');
  assert.equal(document.getElementById('dm-edit-btn').style.display, 'none');
  assert.equal(scroller.scrollTop, 173, 'authority refresh never jumps the open detail scroller');
  assert.equal(document.activeElement, document.querySelector('[data-action="correct-ingredient"]'), 'stable ingredient action regains focus after replacement');

  state.recipes = [{
    ...state.recipes[0], name: 'Second Parsley Starter', recipeIngredient: ['2 cups parsley'],
    recipeInstructions: ['Serve parsley.'], nutrition: null,
  }];
  assert.equal(detail.reconcileRecipes({ authoritative: true }), true);
  assert.equal(document.getElementById('dm-title').textContent, 'Second Parsley Starter');
  assert.match(document.getElementById('dm-ingredients').textContent, /2 cups parsley/);
  assert.match(document.getElementById('dm-steps').textContent, /Serve parsley/);
  assert.equal(document.getElementById('dm-nutrition').style.display, 'none');
  document.getElementById('dm-mark-cooked-btn').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cooked, 1, 'multiple refreshes do not duplicate delegated or fixed handlers');
});

test('reconciliation preserves a valid nested correction draft, refreshes provenance, and uses sane focus when evidence changes', () => {
  const { dom, detail, state, recipe } = reconciliationFixture();
  const { document } = dom.window;
  detail.open('r1');
  const action = document.querySelector('[data-action="correct-ingredient"]');
  assert.equal(detail.openCorrection(action.dataset.ingredientId, action), true);
  const draft = document.getElementById('ingredient-correction-name');
  draft.value = 'My unsaved herb name';
  draft.focus();

  state.recipes = [{
    ...recipe, name: 'Authority Name',
    _provenance: { sourceUrl: 'https://new.example.test/recipe', extractorMethod: 'microdata', extractorVersion: 'v2' },
  }];
  detail.reconcileRecipes({ authoritative: true });
  assert.equal(document.getElementById('ingredient-correction-modal').hidden, false, 'unrelated authority changes keep the nested editor open');
  assert.equal(draft.value, 'My unsaved herb name', 'unsaved correction draft is not reset');
  assert.equal(document.activeElement, draft);
  assert.equal(document.querySelector('#ingredient-correction-provenance a').href, 'https://new.example.test/recipe');
  assert.match(document.getElementById('ingredient-correction-provenance').textContent, /microdata · v2/);
  assert.equal(document.getElementById('detail-modal').getAttribute('aria-modal'), null, 'detail stays suspended under the correction editor');

  detail.closeCorrection();
  const refreshedAction = document.querySelector('[data-action="correct-ingredient"]');
  assert.equal(document.activeElement, refreshedAction, 'closing a preserved editor restores focus to the refreshed stable action');
  assert.equal(detail.openCorrection(refreshedAction.dataset.ingredientId, refreshedAction), true);

  state.recipes = [{ ...state.recipes[0], recipeIngredient: ['2 cups parsley'] }];
  detail.reconcileRecipes({ authoritative: true });
  assert.equal(document.getElementById('ingredient-correction-modal').hidden, true, 'changed evidence safely closes the stale correction editor');
  assert.equal(document.getElementById('detail-modal').getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement, document.getElementById('detail-close-btn'), 'invalidated nested focus falls back inside the resumed detail');
});

test('deleting the current recipe closes nested detail safely and hands focus back to its parent modal owner', () => {
  let resumed = 0;
  const { dom, detail, state } = reconciliationFixture({
    onClose: () => {
      resumed += 1;
      dom.window.document.getElementById('pantry-result').focus();
      return true;
    },
  });
  const { document } = dom.window;
  document.getElementById('pantry-result').focus();
  detail.open('r1');
  const action = document.querySelector('[data-action="correct-ingredient"]');
  detail.openCorrection(action.dataset.ingredientId, action);
  state.recipes = [];
  assert.equal(detail.reconcileRecipes({ authoritative: true }), true);
  assert.equal(document.getElementById('ingredient-correction-modal').hidden, true);
  assert.equal(document.getElementById('detail-modal').hidden, true);
  assert.equal(state.detailId, null);
  assert.equal(resumed, 1);
  assert.equal(document.activeElement, document.getElementById('pantry-result'));
  assert.equal(document.body.style.overflow, '');
});
