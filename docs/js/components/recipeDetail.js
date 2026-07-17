// ════════════════════════════════════════════════════════
// components/recipeDetail.js — recipe detail sheet (design-system v1)
// ════════════════════════════════════════════════════════

import { esc, formatDuration, formatRecipeYield } from '../lib/format.js';
import { Icon } from '../lib/ui.js';
import { haveIngredient } from '../lib/pantry.js';
import { formatEffectiveIngredient } from '../lib/ingredient-corrections.js';

/**
 * Ingredient checklist markup for the detail sheet.
 * Reviewed normalized values are displayed while the immutable source line stays
 * available to the correction dialog.
 * @param {object[]} ingredients
 * @param {Array} pantry
 * @returns {string}
 */
export function ingredientListHTML(ingredients, pantry) {
  return `<ul class="detail-ing-list">${ingredients.map((ingredient) => {
    const has = haveIngredient(ingredient, pantry);
    const cls = has ? 'detail-ing-item' : 'detail-ing-item missing-item';
    const checkCls = has ? 'detail-ing-check have' : 'detail-ing-check';
    const title = has ? 'Remove from Pantry' : 'Add to Pantry';
    const display = formatEffectiveIngredient(ingredient);
    const reviewed = ingredient.reviewStatus === 'reviewed'
      ? '<span class="ingredient-review-status">Reviewed</span>' : '';
    return `<li class="${cls}" data-ing="${esc(ingredient.name)}" data-ingredient-id="${esc(ingredient.id)}">
      <button type="button" class="detail-ing-toggle" data-action="toggle-ingredient-pantry" data-feedback="${has ? 'toggle-off' : 'toggle-on'}" aria-label="${esc(`${title}: ${display}`)}">
        <span class="${checkCls}">${has ? Icon({ name: 'check' }) : ''}</span>
        <span class="detail-ing-text">${esc(display)}</span>
      </button>
      ${reviewed}
      <button type="button" class="ingredient-correction-action" data-action="correct-ingredient" data-feedback="select" data-ingredient-id="${esc(ingredient.id)}" aria-label="${esc(`Correct ${ingredient.raw}`)}">Correct</button>
    </li>`;
  }).join('')}</ul>`;
}

/**
 * Pantry summary note shown beneath the ingredient list.
 * @param {object[]} ingredients
 * @param {Array} pantry
 * @returns {string}
 */
export function pantryNoteHTML(ingredients, pantry) {
  if (!ingredients.length) return '';
  const have = ingredients.filter((ingredient) => haveIngredient(ingredient, pantry)).length;
  const total = ingredients.length;
  const missing = total - have;
  return missing === 0
    ? '<strong>You have everything.</strong> Ready to cook.'
    : `<strong>${missing} ingredient${missing !== 1 ? 's' : ''} needed</strong> — ${have} of ${total} in your pantry. <button class="btn btn-ghost btn-sm" data-action="add-missing" data-feedback="commit">Add to cart</button>`;
}

/**
 * Meta pills for the detail header.
 * @param {object} r
 * @returns {string}
 */
export function metaRowHTML(r) {
  const recipeYield = formatRecipeYield(r.recipeYield);
  const meta = [
    r.prepTime && ['Prep', formatDuration(r.prepTime)],
    r.cookTime && ['Cook', formatDuration(r.cookTime)],
    r.totalTime && ['Total', formatDuration(r.totalTime)],
    recipeYield && [recipeYield.label, recipeYield.value],
    r.cookingMethod && ['Method', r.cookingMethod],
  ].filter(Boolean);
  if (!meta.length) return '';
  // Items land directly inside the existing .detail-meta-row container
  // (#dm-meta in index.html) so the row expands to header width.
  return meta.map(
    ([k, v]) => `<div class="detail-meta-item"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`
  ).join('');
}

/**
 * Numbered steps markup.
 * @param {string[]} steps
 * @returns {string}
 */
export function stepsHTML(steps) {
  const filtered = (steps || []).filter(Boolean);
  if (!filtered.length) {
    return '<p class="ingredients-label">No instructions added yet.</p>';
  }
  return filtered.map((s, i) => {
    const num = i + 1;
    return `<div class="detail-step"><span class="step-num">${num}</span><p class="step-text">${esc(s)}</p></div>`;
  }).join('');
}

/**
 * Nutrition cells; returns null when there is no nutrition data.
 * @param {object} nutrition
 * @returns {string|null}
 */
export function nutritionHTML(nutrition) {
  const n = nutrition || {};
  const cells = [
    ['Calories', n.calories],
    ['Protein', n.proteinContent],
    ['Fat', n.fatContent],
    ['Carbs', n.carbohydrateContent],
  ].filter((c) => c[1]);
  if (!cells.length) return null;
  return `<dl class="nutrition-strip" aria-label="Nutrition per serving">${cells.map(
    ([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`
  ).join('')}</dl>`;
}
