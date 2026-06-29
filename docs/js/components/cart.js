// ════════════════════════════════════════════════════════
// cart.js — shopping cart markup (returns HTML strings)
// ════════════════════════════════════════════════════════

import { esc } from '../lib/format.js';
import { groupCart, sumIfHomogeneous } from '../lib/cart.js';

/**
 * Render the cart as grouped rows. Each contribution is a tappable span
 * (data-action="bought") carrying recipe-id, line, and name so a delegated
 * handler can mark it bought. An optional total is shown when the group's
 * quantities are homogeneous and integer-summable.
 * @param {object[]} cart
 * @returns {string}
 */
export function cartGroupsHTML(cart) {
  const groups = groupCart(cart);
  const rows = [];
  for (const [name, items] of groups) {
    const { total, unit } = sumIfHomogeneous(items);
    const totalHTML = total != null
      ? `<span class="cart-total">${esc(total)}${unit ? ' ' + esc(unit) : ''} total</span> `
      : '';
    const contribs = items
      .map((it) => {
        const qty = it.qtyText ? `${esc(it.qtyText)}: ` : '';
        return `<span class="cart-contrib" data-action="bought" data-recipe-id="${esc(it.recipeId)}" data-line="${esc(it.line)}" data-name="${esc(it.name)}" title="Tap to mark bought (adds to pantry)">${qty}${esc(it.recipeName)}</span>`;
      })
      .join(', ');
    rows.push(
      `<div class="cart-row"><span class="cart-name">${esc(name)}</span> ${totalHTML}(${contribs})</div>`
    );
  }
  return rows.join('');
}

/** Empty-state message for the cart section. */
export function emptyCartHTML() {
  return '<p class="cart-empty">Your cart is empty. Open a recipe and tap “Add … items to cart.”</p>';
}
