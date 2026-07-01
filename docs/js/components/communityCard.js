// ════════════════════════════════════════════════════════
// components/communityCard.js — community feed card (design-system v1)
// ════════════════════════════════════════════════════════
import { esc } from '../lib/format.js';
import { Icon } from '../lib/ui.js';

/**
 * Render a community recipe item as a card. `item.recipe` is canonical JSON-LD.
 * @param {object} item { id, recipe, author: { sub, name, picture }, createdAt, updatedAt }
 * @returns {string}
 */
export function communityCardHTML(item) {
  const r = (item && item.recipe) || {};
  const name = r.name || 'Untitled';
  const ings = Array.isArray(r.recipeIngredient) ? r.recipeIngredient : [];
  const author = (item && item.author) || {};
  const avatar = author.picture
    ? `<img class="author-avatar" src="${esc(author.picture)}" alt="" width="22" height="22" referrerpolicy="no-referrer" crossorigin="anonymous">`
    : `<span class="author-avatar author-initial">${esc((author.name || '?').slice(0, 1).toUpperCase())}</span>`;
  const ingTags = ings.slice(0, 6).map((i) => `<span class="ing-tag">${esc(i)}</span>`).join('')
    + (ings.length > 6 ? `<span class="ing-tag">+${ings.length - 6} more</span>` : '');
  return `<article class="recipe-card community-card" data-id="${esc(item.id)}">
      <div class="card-body">
        <span class="badge">Recipe</span>
        <h3 class="card-title">${esc(name)}</h3>
        <div class="card-ingredients">
          <p class="ingredients-label">Ingredients</p>
          <div class="ingredient-tags">${ingTags || '<span class="ing-tag">None listed</span>'}</div>
        </div>
      </div>
      <div class="card-footer">
        <span class="author-badge">${avatar}<span class="author-name">added by ${esc(author.name || 'someone')}</span></span>
      </div>
    </article>`;
}

export function communityEmptyHTML() {
  return `<div class="empty-state">${Icon({ name: 'list' })}<strong>No shared recipes yet</strong><p>Share one from your library to start the Community.</p></div>`;
}