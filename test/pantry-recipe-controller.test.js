import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { initPantry } from '../docs/js/controllers/pantry.js';
import { normalizeIngredient } from '../docs/js/lib/cart.js';
import { applyReviewedIngredientCorrection, ingredientEvidence } from '../docs/js/lib/ingredient-corrections.js';
import { recipeDiscoveryAuthority } from '../docs/js/lib/recipe-discovery-projection.js';
import { publishRecipeAuthority } from '../docs/js/lib/recipe-authority.js';

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

function structuredCorpus(firstIngredient, firstName = 'Structured recipe') {
  const structured = (id, name, ingredient) => {
    const raw = `1 cup ${ingredient}`;
    return {
      _id: id,
      name,
      recipeIngredient: [raw],
      ingredientNormalizations: [normalizeIngredient(raw)],
    };
  };
  return [
    structured('structured', firstName, firstIngredient),
    ...Array.from({ length: 200 }, (_, index) => (
      structured(`filler-${index}`, `Filler ${index}`, `filler ingredient ${index}`)
    )),
  ];
}

async function waitForContent(node, expected, message = String(expected)) {
  for (let index = 0; index < 200 && !expected.test(node.textContent); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.match(node.textContent, expected, message);
}

async function setupStructuredAuthority({ ingredient = 'basil', pantryName = 'parsley' } = {}) {
  const dom = new JSDOM(PAGE, { url: 'https://cookbook.example.test/' });
  const state = {
    pantry: [pantry(pantryName)], recipes: [], shoppingChecked: {}, manualItems: [], recipeAuthorityVersion: 0,
  };
  publishRecipeAuthority(state, structuredCorpus(ingredient));
  await recipeDiscoveryAuthority(state.recipes).promise;
  const controller = initPantry({ state, document: dom.window.document, feedback });
  controller.render();
  assert.equal(controller.openEditor('pantry-selected'), true);
  return { dom, state, controller };
}

test('one normal render refreshes an open Pantry after changed structured authority certifies', async () => {
  const { dom, state, controller } = await setupStructuredAuthority();
  const document = dom.window.document;
  const discovery = document.getElementById('pantry-recipe-discovery');
  await waitForContent(discovery, /No recipes use this item yet/i);
  const name = document.getElementById('pantry-item-name');
  name.value = 'Unsaved parsley draft';
  name.focus();
  const version = state.recipeAuthorityVersion;

  publishRecipeAuthority(state, structuredCorpus('parsley', 'Parsley Supper'));
  const candidate = recipeDiscoveryAuthority(state.recipes);
  controller.render();

  assert.match(discovery.textContent, /Finding recipes/i);
  await candidate.certificationPromise;
  await waitForContent(discovery, /Parsley Supper[\s\S]*1 cup parsley/i,
    'certification completion automatically rerenders the still-open Pantry');
  assert.equal(state.recipeAuthorityVersion, version + 1, 'changed certification advances generation once');
  assert.equal(name.value, 'Unsaved parsley draft');
  assert.equal(document.activeElement, name, 'async refresh cannot steal newer editor focus');
});

test('equivalent structured certification automatically restores recipe focus without changing generation or draft', async () => {
  const { dom, state, controller } = await setupStructuredAuthority({ ingredient: 'parsley' });
  const document = dom.window.document;
  const discovery = document.getElementById('pantry-recipe-discovery');
  await waitForContent(discovery, /Structured recipe[\s\S]*1 cup parsley/i);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = document.querySelector('[data-pantry-recipe-id="structured"]');
  const name = document.getElementById('pantry-item-name');
  name.value = 'Equivalent certification draft';
  row.focus();
  const version = state.recipeAuthorityVersion;
  const equivalent = structuredCorpus('parsley');
  equivalent[0]._updatedAt = 99;

  publishRecipeAuthority(state, equivalent);
  const candidate = recipeDiscoveryAuthority(state.recipes);
  const certification = candidate.certificationPromise;
  controller.render();

  assert.match(discovery.textContent, /Finding recipes/i);
  assert.equal(document.activeElement, document.body, 'pending replacement temporarily owns recipe-row focus loss');
  await certification;
  await waitForContent(discovery, /Structured recipe[\s\S]*1 cup parsley/i);
  assert.equal(state.recipeAuthorityVersion, version, 'equivalent certification advances generation zero times');
  assert.equal(name.value, 'Equivalent certification draft');
  assert.equal(document.activeElement?.dataset?.pantryRecipeId, 'structured');
});

test('superseded structured certification cannot refresh Pantry over the newest publication', async () => {
  const { dom, state, controller } = await setupStructuredAuthority({ pantryName: 'cilantro' });
  const discovery = dom.window.document.getElementById('pantry-recipe-discovery');
  await waitForContent(discovery, /No recipes use this item yet/i);
  const version = state.recipeAuthorityVersion;

  publishRecipeAuthority(state, structuredCorpus('parsley', 'Stale Parsley Supper'));
  const staleCandidate = recipeDiscoveryAuthority(state.recipes);
  const staleCertification = staleCandidate.certificationPromise;
  controller.render();
  publishRecipeAuthority(state, structuredCorpus('cilantro', 'Current Cilantro Supper'));
  const currentCandidate = recipeDiscoveryAuthority(state.recipes);
  const currentCertification = currentCandidate.certificationPromise;
  controller.render();

  await Promise.all([staleCertification, currentCertification]);
  await waitForContent(discovery, /Current Cilantro Supper[\s\S]*1 cup cilantro/i);
  assert.doesNotMatch(discovery.textContent, /Stale Parsley Supper/i);
  assert.equal(state.recipeAuthorityVersion, version + 1,
    'only the newest changed structured certification advances generation');
  assert.equal(currentCandidate.index.byIngredient.has('cilantro'), true);
  assert.equal(currentCandidate.index.byIngredient.has('parsley'), false);
});

test('closing Pantry during structured certification rejects its late automatic refresh', async () => {
  const { dom, state, controller } = await setupStructuredAuthority();
  const document = dom.window.document;
  const discovery = document.getElementById('pantry-recipe-discovery');
  await waitForContent(discovery, /No recipes use this item yet/i);

  publishRecipeAuthority(state, structuredCorpus('parsley', 'Late Parsley Supper'));
  const certification = recipeDiscoveryAuthority(state.recipes).certificationPromise;
  controller.render();
  assert.match(discovery.textContent, /Finding recipes/i);
  assert.equal(controller.closeEditor(), true);

  await certification;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const modal = document.getElementById('pantry-item-modal');
  assert.equal(modal.hidden, true);
  assert.equal(modal.hasAttribute('aria-modal'), false);
  assert.equal(discovery.hidden, true, 'late completion cannot reopen or rerender the closed discovery UI');
});

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
