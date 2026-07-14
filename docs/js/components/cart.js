// cart.js — compact recipe controls + one persistent checkable shopping list.
import { esc } from '../lib/format.js';
import { aggregateCart, canonicalName, formatCanonicalAmount } from '../lib/cart.js';

function pantryContains(name, pantry) {
  const needle = canonicalName(name);
  return (Array.isArray(pantry) ? pantry : []).some((item) => canonicalName(item) === needle);
}

function recipeRow(selection) {
  const id = esc(selection.recipeId);
  const name = esc(selection.recipeName);
  return `<div class="cart-recipe" data-recipe-id="${id}">
    <span class="cart-recipe-name">${name}</span>
    <div class="cart-serving-controls" aria-label="Servings for ${name}">
      <button class="icon-btn icon-btn-sm" data-action="servings-down" data-recipe-id="${id}" aria-label="Decrease servings for ${name}">−</button>
      <span>${esc(selection.targetServings)} serving${Number(selection.targetServings) === 1 ? '' : 's'}</span>
      <button class="icon-btn icon-btn-sm" data-action="servings-up" data-recipe-id="${id}" aria-label="Increase servings for ${name}">+</button>
    </div>
    <details class="cart-recipe-menu"><summary aria-label="More options for ${name}">⋯</summary><button class="btn btn-ghost btn-sm" data-action="remove-recipe" data-recipe-id="${id}" aria-label="Remove ${name} recipe from shopping list">Remove recipe</button></details>
  </div>`;
}

function itemRow(item, pantry, completed) {
  const name = item.displayName || item.name;
  const safeName = esc(name);
  const canonical = esc(item.name);
  const inPantry = pantryContains(item.name, pantry);
  const amount = formatCanonicalAmount(item.purchaseQuantity, item.unit, {
    requiredQuantity: item.quantity,
    countLabel: item.countLabel,
    category: item.category,
  });
  const source = item.raw.length ? ` title="From: ${esc(item.raw.join('; '))}"` : '';
  const action = completed ? 'not completed' : 'completed';
  return `<li class="cart-row${completed ? ' is-completed' : ''}"${source}>
    <button class="cart-check" data-action="toggle-item" data-name="${canonical}" aria-label="Mark ${safeName} as ${action}" aria-pressed="${completed}">${completed ? '✓' : ''}</button>
    <span class="cart-name">${safeName}${item.uncertain ? '<small>check amount</small>' : ''}${inPantry ? '<small class="cart-pantry">in pantry</small>' : ''}</span>
    <span class="cart-total">${esc(amount)}</span>
    <details class="cart-item-menu"><summary aria-label="More options for ${safeName}">⋯</summary><button class="btn btn-ghost btn-sm" data-action="remove-item" data-name="${canonical}" aria-label="Remove ${safeName} from shopping list">Remove item</button></details>
  </li>`;
}

export function cartGroupsHTML(cart, pantry = [], shoppingChecked = {}) {
  const selections = (Array.isArray(cart) ? cart : []).map(recipeRow).join('');
  const active = [];
  const completed = [];
  for (const item of aggregateCart(cart)) {
    const isCompleted = shoppingChecked?.[item.name] === true;
    (isCompleted ? completed : active).push(itemRow(item, pantry, isCompleted));
  }
  const completedHTML = completed.length
    ? `<details class="cart-completed"><summary>Completed (${completed.length})</summary><ul class="shopping-list shopping-list-completed">${completed.join('')}</ul></details>`
    : '';
  return `<div class="cart-shell"><div class="cart-recipes">${selections}</div><ul class="shopping-list">${active.join('')}</ul>${completedHTML}</div>`;
}

export function emptyCartHTML() {
  return '<p class="cart-empty">Your cart is empty. Open a recipe and add it to your shopping list.</p>';
}
