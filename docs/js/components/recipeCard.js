// ════════════════════════════════════════════════════════
// components/recipeCard.js — recipe grid card (design-system v1)
// ════════════════════════════════════════════════════════

import { esc, formatDuration } from '../lib/format.js';
import { Icon, IconButton } from '../lib/ui.js';
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
export function recipeCardHTML(r, pantry, { currentUserSub = null } = {}) {
  const e = eligibility(r, pantry);
  const ings = r.recipeIngredient || [];
  const { have, total } = ingredientCounts(r, pantry);
  const statusText = e === 'partial' ? STATUS_TEXT.partial(have, total) : STATUS_TEXT[e];

  const ingTags =
    ings
      .slice(0, 8)
      .map((i) => {
        const cls = haveIngredient(i, pantry) ? 'ing-tag have' : 'ing-tag missing';
        return `<span class="${cls}">${esc(i)}</span>`;
      })
      .join('') +
    (ings.length > 8 ? `<span class="ing-tag">+${ings.length - 8} more</span>` : '');

  const metaPills = [
    r.prepTime && `<span class="meta-pill">${Icon({ name: 'clock' })}Prep ${esc(formatDuration(r.prepTime))}</span>`,
    r.cookTime && `<span class="meta-pill">${Icon({ name: 'pot' })}Cook ${esc(formatDuration(r.cookTime))}</span>`,
    r.recipeYield && `<span class="meta-pill">${Icon({ name: 'serves' })}${esc(r.recipeYield)}</span>`,
  ].filter(Boolean).join('');

  const author = r._author;
  const canManage = !!(author && currentUserSub && author.sub === currentUserSub);

  return `
    <article class="card recipe-card card-fold-${e}" data-id="${esc(r._id)}">
      <div class="card-stripe"></div>
      <div class="card-body">
        <span class="badge ${e === 'complete' ? 'badge-success' : 'badge-accent'}">${esc(r.recipeCategory || 'Recipe')}</span>
        ${r.recipeCuisine ? `<span class="badge">${esc(r.recipeCuisine)}</span>` : ''}
        <div class="card-head">
          <h3 class="card-title">${esc(r.name)}</h3>
          <div class="card-toolbar">
            ${canManage ? IconButton({ label: 'Edit', icon: 'edit', size: 'sm', danger: false, data: { action: 'edit', id: r._id } }) : ''}
            ${canManage ? IconButton({ label: 'Delete', icon: 'trash', size: 'sm', danger: true, data: { action: 'delete', id: r._id } }) : ''}
          </div>
        </div>
        ${author ? `<p class="recipe-author">added by ${esc(author.name || 'someone')}</p>` : ''}
        ${metaPills ? `<div class="card-meta">${metaPills}</div>` : ''}
        <div class="card-ingredients">
          <p class="ingredients-label">Ingredients</p>
          <div class="ingredient-tags">${ingTags || '<span class="ing-tag">None listed</span>'}</div>
        </div>
      </div>
      <div class="card-footer">
        <span class="card-status"><span class="status-dot"></span>${esc(statusText)}</span>
      </div>
    </article>`;
}

/**
 * Empty-state markup for the grid.
 * @param {boolean} hasRecipes whether any recipes exist at all
 * @returns {string}
 */
export function emptyStateHTML(hasRecipes) {
  return `<div class="empty-state">
      ${Icon({ name: 'list' })}
      <strong>${hasRecipes ? 'No matches' : 'No recipes yet'}</strong>
      <p>${hasRecipes ? 'Try a different search or filter.' : 'Add your first recipe or import a JSON-LD file.'}</p>
    </div>`;
}