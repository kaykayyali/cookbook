// cart.js — concise selected recipes + one aggregated shopping list.
import { esc } from '../lib/format.js';
import { aggregateCart, canonicalName, formatCanonicalAmount } from '../lib/cart.js';

function pantryContains(name, pantry) {
  const needle = canonicalName(name);
  return (Array.isArray(pantry) ? pantry : []).some((item) => canonicalName(item) === needle);
}

export function cartGroupsHTML(cart, pantry = []) {
  const selections = (Array.isArray(cart) ? cart : []).map((selection) => `
    <div class="cart-recipe" data-recipe-id="${esc(selection.recipeId)}">
      <span class="cart-recipe-name">${esc(selection.recipeName)}</span>
      <div class="cart-serving-controls" aria-label="Servings for ${esc(selection.recipeName)}">
        <button class="icon-btn icon-btn-sm" data-action="servings-down" data-recipe-id="${esc(selection.recipeId)}" aria-label="Decrease servings">−</button>
        <span>${esc(selection.targetServings)} servings</span>
        <button class="icon-btn icon-btn-sm" data-action="servings-up" data-recipe-id="${esc(selection.recipeId)}" aria-label="Increase servings">+</button>
      </div>
      <button class="btn btn-ghost btn-sm" data-action="remove-recipe" data-recipe-id="${esc(selection.recipeId)}">Remove</button>
    </div>`).join('');

  const items = aggregateCart(cart).map((item) => {
    const inPantry = pantryContains(item.name, pantry);
    const amount = formatCanonicalAmount(item.purchaseQuantity, item.unit);
    const uncertain = item.uncertain ? ' · check amount' : '';
    const source = item.raw.length ? ` title="From: ${esc(item.raw.join('; '))}"` : '';
    return `<li class="cart-row"${source}><span class="cart-name">${esc(item.name)}</span><span class="cart-total">${esc(amount)}${uncertain}</span>${inPantry ? '<span class="cart-pantry">in pantry</span>' : ''}<button class="btn btn-ghost btn-sm cart-item-remove" data-action="remove-item" data-name="${esc(item.name)}" aria-label="Remove ${esc(item.name)} from shopping list">Remove</button></li>`;
  }).join('');

  return `<div class="cart-recipes">${selections}</div><ul class="shopping-list">${items}</ul>`;
}

export function emptyCartHTML() {
  return '<p class="cart-empty">Your cart is empty. Open a recipe and add it to your shopping list.</p>';
}
