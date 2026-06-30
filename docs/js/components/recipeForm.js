// ════════════════════════════════════════════════════════
// components/recipeForm.js — create/edit drawer form (design-system v1)
// ════════════════════════════════════════════════════════

import { esc } from '../lib/format.js';
import { Icon } from '../lib/ui.js';
import { uuid } from '../lib/schema.js';
import { $ } from '../lib/dom.js';

export const FIELD_MAP = {
  'f-name': 'name',
  'f-category': 'recipeCategory',
  'f-cuisine': 'recipeCuisine',
  'f-yield': 'recipeYield',
  'f-method': 'cookingMethod',
  'f-diet': 'suitableForDiet',
  'f-url': 'url',
  'f-prep': 'prepTime',
  'f-cook': 'cookTime',
  'f-total': 'totalTime',
};

export const NUTRI_MAP = {
  'f-serving': 'servingSize',
  'f-calories': 'calories',
  'f-protein': 'proteinContent',
  'f-fat': 'fatContent',
  'f-carbs': 'carbohydrateContent',
};

/** Working buffers for the repeatable ingredient/step rows. */
export const formBuffers = {
  ingredients: [],
  steps: [],
};

export function ingEditorHTML(ingredients) {
  return ingredients.map((ing, i) => {
    const remove = `<button type="button" class="icon-btn" data-action="remove-ing" data-index="${i}" aria-label="Remove ingredient">${Icon({ name: 'x' })}</button>`;
    return `<div class="ing-row">
       <input class="input" type="text" value="${esc(ing)}" data-index="${i}" placeholder="e.g. 2 tablespoons olive oil" id="ing-${i}">
       <label class="aria-live" for="ing-${i}">Ingredient ${i + 1}</label>
       ${remove}
     </div>`;
  }).join('');
}

export function stepsEditorHTML(steps) {
  return steps.map((step, i) => {
    const num = i + 1;
    const remove = `<button type="button" class="icon-btn" data-action="remove-step" data-index="${i}" aria-label="Remove step">${Icon({ name: 'x' })}</button>`;
    return `<div class="step-row">
       <span class="step-badge">${num}</span>
       <label class="aria-live" for="step-${i}">Step ${num}</label>
       <textarea class="input" id="step-${i}" data-index="${i}" rows="2" placeholder="Describe this step…">${esc(step)}</textarea>
       ${remove}
     </div>`;
  }).join('');
}

export function rebuildIngEditor() {
  $('ing-editor').innerHTML = ingEditorHTML(formBuffers.ingredients);
}

export function rebuildStepsList() {
  $('steps-list').innerHTML = stepsEditorHTML(formBuffers.steps);
}

/**
 * Read the form fields into an internal recipe object.
 * @param {object} state app state (for editingId + previous dateCreated)
 * @returns {object}
 */
export function collectForm(state) {
  const get = (id) => ($(id)?.value || '').trim();
  const nutrition = {};
  Object.entries(NUTRI_MAP).forEach(([elId, key]) => { nutrition[key] = get(elId); });
  const prev = state.editingId ? state.recipes.find((r) => r._id === state.editingId) : null;
  return {
    _id: $('f-id').value || uuid(),
    name: get('f-name'),
    recipeCategory: $('f-category').value,
    cookingMethod: $('f-method').value,
    suitableForDiet: $('f-diet').value,
    recipeCuisine: get('f-cuisine'),
    recipeYield: get('f-yield'),
    url: get('f-url'),
    prepTime: get('f-prep'),
    cookTime: get('f-cook'),
    totalTime: get('f-total'),
    recipeIngredient: formBuffers.ingredients.map((s) => s.trim()).filter(Boolean),
    recipeInstructions: formBuffers.steps.map((s) => s.trim()).filter(Boolean),
    nutrition,
    dateCreated: prev?.dateCreated || new Date().toISOString(),
    dateModified: state.editingId ? new Date().toISOString() : '',
  };
}

/**
 * Validate a collected recipe. Returns an error string or null when valid.
 * @param {object} r
 * @returns {string|null}
 */
export function validateRecipe(r) {
  if (!r.name) return 'Recipe name is required';
  if (!r.recipeIngredient.length) return 'Add at least one ingredient';
  if (!r.recipeInstructions.length) return 'Add at least one instruction step';
  return null;
}