// ════════════════════════════════════════════════════════
// components/recipeCard.js — recipe grid card
// ════════════════════════════════════════════════════════

import { esc, formatDuration } from '../lib/format.js';
import { ICON } from '../lib/icons.js';
import { eligibility, haveIngredient, ingredientCounts } from '../lib/pantry.js';

const STATUS_TEXT = {
  complete: 'All ingredients on hand',
  partial: (have, total) => `${have} of ${total} ingredients`,
  none: 'Ingredients needed',
};

/**
 * Render a single recipe card to an HTML string.
 * @param {object} r internal recipe
 * @param {string[]} pantry
 * @returns {string}
 */
export function recipeCardHTML(r, pantry) {
  const e = eligibility(r, pantry);
  const ings = r.recipeIngredient || [];
  const { have, total } = ingredientCounts(r, pantry);
  const statusText =
    e === 'partial' ? STATUS_TEXT.partial(have, total) : STATUS_TEXT[e];

  const ingTags =
    ings
      .slice(0, 8)
      .map(
        (i) =>
          `<span class="ing-tag ${haveIngredient(i, pantry) ? 'have' : 'missing'}">${esc(i)}</span>`
      )
      .join('') +
    (ings.length > 8 ? `<span class="ing-tag">+${ings.length - 8} more</span>` : '');

  const meta = [
    r.prepTime && `<span class="meta-pill">${ICON.clock}Prep ${formatDuration(r.prepTime)}</span>`,
    r.cookTime && `<span class="meta-pill">${ICON.pot}Cook ${formatDuration(r.cookTime)}</span>`,
    r.recipeYield && `<span class="meta-pill">${ICON.serves}${esc(r.recipeYield)}</span>`,
  ]
    .filter(Boolean)
    .join('');

  return `
    <div class="recipe-card card-fold-${e}" data-id="${r._id}">
      <div class="card-stripe"></div>
      <div class="card-body">
        <p class="card-category">${esc(r.recipeCategory || 'Recipe')}${
    r.recipeCuisine ? ' · ' + esc(r.recipeCuisine) : ''
  }</p>
        <h3 class="card-title">${esc(r.name)}</h3>
        ${meta ? `<div class="card-meta">${meta}</div>` : ''}
        <div class="card-ingredients">
          <p class="ingredients-label">Ingredients</p>
          <div class="ingredient-tags">${ingTags || '<span class="ing-tag">None listed</span>'}</div>
        </div>
      </div>
      <div class="card-footer">
        <span class="card-status"><span class="status-dot"></span>${statusText}</span>
        <div class="card-actions">
          <button class="btn-icon" data-action="edit"   data-id="${r._id}" title="Edit">${ICON.edit}</button>
          <button class="btn-icon" data-action="schema" data-id="${r._id}" title="JSON-LD">${ICON.code}</button>
          <button class="btn-icon danger" data-action="delete" data-id="${r._id}" title="Delete">${ICON.trash}</button>
        </div>
      </div>
    </div>`;
}

/**
 * Empty-state markup for the grid.
 * @param {boolean} hasRecipes whether any recipes exist at all
 * @returns {string}
 */
export function emptyStateHTML(hasRecipes) {
  return `<div class="empty-state">
      <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>
      <strong>${hasRecipes ? 'No matches' : 'No recipes yet'}</strong>
      <p>${hasRecipes ? 'Try a different search or filter.' : 'Add your first recipe or import a JSON-LD file.'}</p>
    </div>`;
}
