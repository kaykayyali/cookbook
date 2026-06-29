// ════════════════════════════════════════════════════════
// components/recipeDetail.js — recipe detail sheet (design-system v1)
// ════════════════════════════════════════════════════════

import { esc, formatDuration } from '../lib/format.js';
import { Icon } from '../lib/ui.js';
import { haveIngredient, ingredientCounts } from '../lib/pantry.js';

/**
 * Ingredient checklist markup for the detail sheet.
 * @param {string[]} ings
 * @param {string[]} pantry
 * @returns {string}
 */
export function ingredientListHTML(ings, pantry) {
  return `<ul class="detail-ing-list">${ings.map((i) => {
    const has = haveIngredient(i, pantry);
    const cls = has ? 'detail-ing-item' : 'detail-ing-item missing-item';
    const checkCls = has ? 'detail-ing-check have' : 'detail-ing-check';
    const title = has ? 'Tap to remove from pantry' : 'Tap to add to pantry';
    return `<li class="${cls}" data-ing="${esc(i)}" title="${esc(title)}">
      <span class="${checkCls}">${has ? Icon({ name: 'check' }) : ''}</span>
      <span class="detail-ing-text">${esc(i)}</span></li>`;
  }).join('')}</ul>`;
}

/**
 * Pantry summary note shown beneath the ingredient list.
 * @param {string[]} ings
 * @param {string[]} pantry
 * @returns {string}
 */
export function pantryNoteHTML(ings, pantry) {
  if (!ings.length) return '';
  const { have, total } = ingredientCounts({ recipeIngredient: ings }, pantry);
  const missing = total - have;
  return missing === 0
    ? '<strong>You have everything.</strong> Ready to cook.'
    : `<strong>${missing} ingredient${missing !== 1 ? 's' : ''} needed</strong> — ${have} of ${total} in your pantry.`;
}

/**
 * Meta pills for the detail header.
 * @param {object} r
 * @returns {string}
 */
export function metaRowHTML(r) {
  const meta = [
    r.prepTime && ['Prep', formatDuration(r.prepTime)],
    r.cookTime && ['Cook', formatDuration(r.cookTime)],
    r.totalTime && ['Total', formatDuration(r.totalTime)],
    r.recipeYield && ['Serves', r.recipeYield],
    r.cookingMethod && ['Method', r.cookingMethod],
  ].filter(Boolean);
  if (!meta.length) return '';
  return `<div class="detail-meta">${meta.map(
    ([k, v]) => `<div class="detail-meta-item"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`
  ).join('')}</div>`;
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
  return `<div class="detail-nutrition">${cells.map(
    ([k, v]) => `<div class="nutrition-cell"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`
  ).join('')}</div>`;
}
