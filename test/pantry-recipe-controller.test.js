import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { initPantry } from '../docs/js/controllers/pantry.js';
import { applyReviewedIngredientCorrection, ingredientEvidence } from '../docs/js/lib/ingredient-corrections.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
const feedback = { emit() {}, contextFromEvent() { return null; } };

function pantry(name = 'basil') {
  return {
    id: 'pantry-selected', raw: name, rawEvidence: [name], name, displayName: name[0].toUpperCase() + name.slice(1),
    quantity: null, unit: 'qualitative', kind: 'qualitative', countLabel: '', category: 'produce',
    amountState: 'qualitative', confidence: 1, normalizationVersion: 1, updatedAt: 1,
  };
}

function setup(recipe, options = {}) {
  const dom = new JSDOM(PAGE, { url: 'https://cookbook.example.test/' });
  const state = { pantry: [pantry()], recipes: [recipe], shoppingChecked: { basil: true }, manualItems: ['basil'] };
  const controller = initPantry({ state, document: dom.window.document, feedback, ...options });
  controller.render();
  assert.equal(controller.openEditor('pantry-selected'), true);
  return { dom, state, controller };
}

function correctedRecipe(base) {
  const applied = applyReviewedIngredientCorrection(base, {
    ingredientId: ingredientEvidence(base)[0].id,
    correction: {
      name: 'basil', amountState: 'numeric', amount: '2', measurementFamily: 'count',
      sourceUnit: 'count', countLabel: 'leaf',
    },
    reviewer: { sub: 'kay', name: 'Kay' },
    reviewedAt: 2,
  });
  assert.equal(applied.ok, true, applied.error);
  return applied.recipe;
}

test('open Pantry discovery reacts in place to reviewed recipe authority and Pantry rename corrections', () => {
  const base = { _id: 'mystery', name: 'Mystery Pesto', recipeIngredient: ['2 mystery leaves', 'olive oil'] };
  const { dom, state, controller } = setup(base);
  const document = dom.window.document;
  const discovery = document.getElementById('pantry-recipe-discovery');
  assert.match(discovery.textContent, /No recipes use this item yet/i);
  assert.equal(document.getElementById('pantry-item-save').disabled, false, 'empty discovery cannot block saving');

  state.recipes = [correctedRecipe(base)];
  controller.render();
  assert.match(discovery.textContent, /Mystery Pesto[\s\S]*2 mystery leaves/i, 'authority refresh updates the open editor without stale content');
  assert.deepEqual(state.shoppingChecked, { basil: true });
  assert.deepEqual(state.manualItems, ['basil']);

  state.pantry = [{ ...state.pantry[0], name: 'parsley', displayName: 'Parsley', raw: 'parsley', updatedAt: 2 }];
  controller.render();
  assert.match(document.getElementById('pantry-recipe-title').textContent, /Recipes using Parsley/);
  assert.match(discovery.textContent, /No recipes use this item yet/i, 'renamed authority immediately changes canonical lookup');
});

test('two independent Pantry controller runtimes converge on the same reviewed recipe authority', () => {
  const base = { _id: 'shared', name: 'Shared Pesto', recipeIngredient: ['2 mystery leaves'] };
  const first = setup(base);
  const second = setup(structuredClone(base));
  assert.match(first.dom.window.document.getElementById('pantry-recipe-discovery').textContent, /No recipes/);
  assert.match(second.dom.window.document.getElementById('pantry-recipe-discovery').textContent, /No recipes/);

  const authority = correctedRecipe(base);
  for (const runtime of [first, second]) {
    runtime.state.recipes = [structuredClone(authority)];
    runtime.controller.render();
  }
  for (const runtime of [first, second]) {
    assert.match(runtime.dom.window.document.getElementById('pantry-recipe-discovery').textContent, /Shared Pesto[\s\S]*2 mystery leaves/i);
  }
});

test('Pantry editor rerenders reuse recipe index and authority refresh preserves the draft', () => {
  const base = { _id: 'shared', name: 'Shared Pesto', recipeIngredient: ['basil'] };
  let builds = 0;
  const { dom, state, controller } = setup(base, { onDiscoveryIndexBuild: () => { builds += 1; } });
  const name = dom.window.document.getElementById('pantry-item-name');
  name.value = 'My unsaved basil draft';
  for (let index = 0; index < 20; index += 1) controller.render();
  state.pantry = [{ ...state.pantry[0], quantity: 2 }];
  controller.render();
  assert.equal(builds, 1, 'form and Pantry-only rerenders reuse the recipe index');
  state.recipes = [{ ...base, name: 'Remote Shared Pesto' }];
  controller.render();
  assert.equal(builds, 2, 'recipe authority replacement rebuilds exactly once');
  assert.equal(name.value, 'My unsaved basil draft');
  assert.match(dom.window.document.getElementById('pantry-recipe-discovery').textContent, /Remote Shared Pesto/);
});

test('async discovery refresh restores focus to the previously focused recipe row', async () => {
  const base = { _id: 'shared', name: 'A Shared Pesto', recipeIngredient: ['basil'] };
  const { dom, state, controller } = setup(base);
  const document = dom.window.document;
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-pantry-recipe-id="shared"]').focus();
  state.recipes = [base, ...Array.from({ length: 249 }, (_, index) => ({
    _id: `recipe-${index}`, name: `Recipe ${index}`, recipeIngredient: ['basil'],
  }))];
  state.recipeAuthorityVersion = 1;
  controller.render();
  assert.equal(document.activeElement, document.body, 'pending placeholder temporarily removes the row');
  for (let index = 0; index < 100 && document.activeElement?.dataset?.pantryRecipeId !== 'shared'; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(document.activeElement?.dataset?.pantryRecipeId, 'shared');
});

test('async discovery refresh does not override newer editor focus', async () => {
  const base = { _id: 'shared', name: 'A Shared Pesto', recipeIngredient: ['basil'] };
  const { dom, state, controller } = setup(base);
  const document = dom.window.document;
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('[data-pantry-recipe-id="shared"]').focus();
  state.recipes = [base, ...Array.from({ length: 249 }, (_, index) => ({
    _id: `recipe-${index}`, name: `Recipe ${index}`, recipeIngredient: ['basil'],
  }))];
  state.recipeAuthorityVersion = 1;
  controller.render();
  assert.equal(document.activeElement, document.body, 'pending replacement owns the focus loss');
  const name = document.getElementById('pantry-item-name');
  name.focus();
  for (let index = 0; index < 100 && !document.querySelector('[data-pantry-recipe-id="shared"]'); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(document.querySelector('[data-pantry-recipe-id="shared"]'), 'async discovery completed');
  assert.equal(document.activeElement, name, 'newer editor focus keeps ownership after completion');
});

test('resuming after recipe detail exposes remote Pantry conflicts before save', () => {
  const base = { _id: 'shared', name: 'Shared Pesto', recipeIngredient: ['basil'] };
  const runtime = setup(base);
  assert.equal(runtime.controller.suspendEditor('shared'), true);
  runtime.state.pantry = [{ ...runtime.state.pantry[0], displayName: 'Remote Basil', updatedAt: 2 }];
  assert.equal(runtime.controller.resumeEditor(), true);
  assert.match(runtime.dom.window.document.getElementById('pantry-item-error').textContent, /changed in the shared Pantry/i);
});

test('stale discovered recipe resumes the Pantry editor with actionable feedback', () => {
  const base = { _id: 'stale', name: 'Stale Pesto', recipeIngredient: ['basil'] };
  const runtime = setup(base, { onOpenRecipe: () => false });
  const row = runtime.dom.window.document.querySelector('[data-pantry-recipe-id="stale"]');
  row.click();
  const modal = runtime.dom.window.document.getElementById('pantry-item-modal');
  assert.equal(modal.hidden, false);
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.match(runtime.dom.window.document.getElementById('pantry-item-error').textContent, /no longer available/i);
});

test('throwing recipe navigation fails safe and restores the Pantry editor', () => {
  const base = { _id: 'broken', name: 'Broken Pesto', recipeIngredient: ['basil'] };
  const runtime = setup(base, { onOpenRecipe: () => { throw new Error('navigation failed'); } });
  const row = runtime.dom.window.document.querySelector('[data-pantry-recipe-id="broken"]');
  assert.doesNotThrow(() => row.click());
  const modal = runtime.dom.window.document.getElementById('pantry-item-modal');
  assert.equal(modal.hidden, false);
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.match(runtime.dom.window.document.getElementById('pantry-item-error').textContent, /no longer available/i);
});
