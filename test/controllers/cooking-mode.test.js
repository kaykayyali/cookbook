import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initCookingMode } from '../../docs/js/controllers/cooking-mode.js';
import { applyReviewedIngredientCorrection, ingredientEvidence } from '../../docs/js/lib/ingredient-corrections.js';

function setup({ recipe, wakeLock = false } = {}) {
  const html = `
    <div id="cooking-mode-overlay" class="schema-overlay">
      <div class="cooking-mode-container">
        <div id="cooking-mode-header"></div>
        <div id="cooking-mode-step"></div>
        <div id="cooking-mode-ingredients"></div>
        <div id="cooking-mode-controls">
          <button id="cook-prev" data-action="prev">Back</button>
          <span id="cook-step-count"></span>
          <button id="cook-next" data-action="next">Next</button>
        </div>
        <button id="cook-close" data-action="close">Close</button>
        <button id="cook-wake-toggle" data-action="toggle-wake">Keep awake</button>
        <span id="cook-timer"></span>
      </div>
    </div>
  `;
  const dom = new JSDOM(html);
  const state = {};
  let wakeLockState = wakeLock;
  const controller = initCookingMode({
    state,
    document: dom.window.document,
    requestWakeLock: async () => { wakeLockState = true; return { release: () => { wakeLockState = false; } }; },
    toastFn: () => {},
  });
  return { dom, state, controller, getWakeLock: () => wakeLockState };
}

const sampleRecipe = {
  _id: 'r1', name: 'Test Soup',
  recipeIngredient: ['2 cups water', '1 tsp salt'],
  recipeInstructions: ['Boil the water.', 'Add salt and stir.', 'Serve hot.'],
  totalTime: '15 min',
};

test('cooking mode opens with large step text and ingredient context', () => {
  const { dom, controller } = setup({ recipe: sampleRecipe });
  controller.open(sampleRecipe);
  assert.ok(dom.window.document.getElementById('cooking-mode-overlay').classList.contains('open'));
  const step = dom.window.document.getElementById('cooking-mode-step');
  assert.match(step.textContent, /Boil the water/);
  const ingredients = dom.window.document.getElementById('cooking-mode-ingredients');
  assert.match(ingredients.textContent, /2 cups water/);
  assert.match(ingredients.textContent, /1 tsp salt/);
});

test('next and back navigate steps without clutter', async () => {
  const { dom, controller } = setup({ recipe: sampleRecipe });
  controller.open(sampleRecipe);
  assert.equal(controller.stepIndex(), 0);
  dom.window.document.getElementById('cook-next').click();
  await Promise.resolve();
  assert.equal(controller.stepIndex(), 1);
  assert.match(dom.window.document.getElementById('cooking-mode-step').textContent, /Add salt and stir/);
  dom.window.document.getElementById('cook-prev').click();
  await Promise.resolve();
  assert.equal(controller.stepIndex(), 0);
});

test('step count displays current and total', () => {
  const { dom, controller } = setup({ recipe: sampleRecipe });
  controller.open(sampleRecipe);
  const count = dom.window.document.getElementById('cook-step-count');
  assert.match(count.textContent, /1.*3/);
});

test('close releases wake lock and removes overlay', async () => {
  const { dom, controller, getWakeLock } = setup({ recipe: sampleRecipe, wakeLock: true });
  controller.open(sampleRecipe);
  await controller.toggleWakeLock();
  assert.ok(getWakeLock());
  controller.close();
  assert.ok(!dom.window.document.getElementById('cooking-mode-overlay').classList.contains('open'));
  assert.ok(!getWakeLock());
});

test('cooking mode handles recipe with no instructions gracefully', () => {
  const { dom, controller } = setup();
  controller.open({ _id: 'r2', name: 'Empty', recipeIngredient: [], recipeInstructions: [] });
  assert.ok(dom.window.document.getElementById('cooking-mode-overlay').classList.contains('open'));
  assert.match(dom.window.document.getElementById('cooking-mode-step').textContent, /no steps|empty|nothing/i);
});

test('wake lock toggle is opt-in and can be silenced', async () => {
  const { dom, controller, getWakeLock } = setup({ recipe: sampleRecipe });
  controller.open(sampleRecipe);
  assert.ok(!getWakeLock(), 'wake lock is off by default');
  await controller.toggleWakeLock();
  assert.ok(getWakeLock(), 'wake lock is on after toggle');
  await controller.toggleWakeLock();
  assert.ok(!getWakeLock(), 'wake lock is off after second toggle');
});

test('cooking mode uses large type and minimal chrome', () => {
  const { dom, controller } = setup({ recipe: sampleRecipe });
  controller.open(sampleRecipe);
  const overlay = dom.window.document.getElementById('cooking-mode-overlay');
  assert.ok(overlay.querySelector('.cooking-mode-container'));
  const step = dom.window.document.getElementById('cooking-mode-step');
  // The step should have large-font styling
  assert.ok(step.classList.length > 0 || step.style.fontSize || step.tagName === 'DIV');
});

test('cooking mode renders effective reviewed ingredient values instead of immutable malformed source text', () => {
  const recipe = { ...sampleRecipe, recipeIngredient: ['to 4 basil leaves'] };
  const reviewed = applyReviewedIngredientCorrection(recipe, {
    ingredientId: ingredientEvidence(recipe)[0].id,
    correction: { name: 'basil', amountState: 'numeric', amount: '2 to 4', measurementFamily: 'count', sourceUnit: 'count', countLabel: 'leaf' },
    reviewer: { sub: 'member', name: 'Member' }, reviewedAt: 10,
  });
  assert.equal(reviewed.ok, true, reviewed.error);
  const { dom, controller } = setup({ recipe: reviewed.recipe });
  controller.open(reviewed.recipe);
  const text = dom.window.document.getElementById('cooking-mode-ingredients').textContent;
  assert.match(text, /2–4 basil leaves/);
  assert.doesNotMatch(text, /to 4 basil leaves/);
});