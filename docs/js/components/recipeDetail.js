// ════════════════════════════════════════════════════════
// components/recipeDetail.js — recipe detail sheet markup
// ════════════════════════════════════════════════════════

import { esc, formatDuration } from '../lib/format.js';
import { ICON } from '../lib/icons.js';
import { haveIngredient, ingredientCounts } from '../lib/pantry.js';

/**
 * Ingredient checklist markup for the detail sheet. Each row carries a
 * data-ing attribute so a delegated handler can toggle pantry membership.
 * @param {string[]} ings
 * @param {string[]} pantry
 * @returns {string}
 */
export function ingredientListHTML(ings, pantry) {
  return ings
    .map((i) => {
      const has = haveIngredient(i, pantry);
      return `<li class="detail-ing-item ${has ? '' : 'missing-item'}" data-ing="${esc(i)}" title="${
        has ? 'Tap to remove from pantry' : 'Tap to add to pantry'
      }">
      <span class="detail-ing-check ${has ? 'have' : 'missing'}">${has ? ICON.check : ''}</span>
      <span class="detail-ing-text">${esc(i)}</span></li>`;
    })
    .join('');
}

/**
 * Pantry summary note shown beneath the ingredient list.
 * @param {string[]} ings
 * @param {string[]} pantry
 * @returns {string} empty string when there are no ingredients
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
 * Meta pills (prep/cook/total/serves/method) for the detail header.
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
  return meta
    .map(
      ([k, v]) =>
        `<div class="detail-meta-item"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`
    )
    .join('');
}

/**
 * Numbered steps markup.
 * @param {string[]} steps
 * @returns {string}
 */
export function stepsHTML(steps) {
  const filtered = (steps || []).filter(Boolean);
  return filtered.length
    ? filtered
        .map(
          (s, i) =>
            `<div class="detail-step"><span class="step-num">${i + 1}</span><p class="step-text">${esc(s)}</p></div>`
        )
        .join('')
    : '<p style="color:var(--ink-light);font-size:.85rem">No instructions added yet.</p>';
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
  return cells
    .map(
      ([k, v]) =>
        `<div class="nutrition-cell"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`
    )
    .join('');
}
