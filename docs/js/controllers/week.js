import { esc } from '../lib/format.js';
import { parseServings } from '../lib/cart.js';

const DAY = 86_400_000;
const LABELS = { recipe: 'Recipe', leftovers: 'Leftovers', 'dining-out': 'Dining out', open: 'Open' };
const uid = () => globalThis.crypto?.randomUUID?.() || `meal-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setTime(value.getTime() + days * DAY);
  return value.toISOString().slice(0, 10);
}

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function buildWeekDays(plan, today = localDate()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(today, index);
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' })
      .format(new Date(`${date}T12:00:00Z`));
    return {
      date,
      label: index === 0 ? 'Tonight' : weekday,
      entries: (Array.isArray(plan) ? plan : []).filter((entry) => entry.date === date),
    };
  });
}

function entryHTML(entry, recipes) {
  const recipe = recipes.find((item) => String(item._id || item.id) === entry.recipeId);
  const title = entry.type === 'recipe' ? (recipe?.name || 'Recipe unavailable') : LABELS[entry.type];
  const skipped = entry.status === 'skipped';
  const cooked = entry.status === 'cooked';
  return `<article class="week-meal${skipped ? ' is-skipped' : ''}${cooked ? ' is-cooked' : ''}" data-entry-id="${esc(entry.id)}">
    <div class="week-meal-copy"><strong class="week-meal-title" title="${esc(title)}">${esc(title)}</strong>${entry.note ? `<small>${esc(entry.note)}</small>` : ''}</div>
    <div class="week-meal-controls">
      <button class="icon-btn icon-btn-sm" data-action="servings-down" aria-label="Decrease servings">−</button><span>${esc(entry.targetServings || 2)}</span><button class="icon-btn icon-btn-sm" data-action="servings-up" aria-label="Increase servings">+</button>
      <button class="btn btn-ghost btn-sm" data-action="move-next">Tomorrow</button>
      <button class="btn btn-ghost btn-sm" data-action="skip">${skipped ? 'Unskip' : 'Skip'}</button>
      <button class="btn btn-ghost btn-sm" data-action="repeat">Repeat</button>
      ${entry.type === 'recipe' ? cooked ? '<span class="week-cooked">Cooked</span>' : '<button class="btn btn-secondary btn-sm" data-action="mark-cooked">Mark cooked</button>' : ''}
      <button class="icon-btn icon-btn-sm" data-action="remove" aria-label="Remove meal">×</button>
    </div>
  </article>`;
}

function addHTML(day, recipes) {
  const options = recipes.map((recipe) => `<option value="${esc(String(recipe._id || recipe.id))}">${esc(recipe.name)}</option>`).join('');
  return `<div class="week-add" data-date="${day.date}">
    <select class="input" data-field="meal-type" aria-label="Meal type"><option value="recipe">Recipe</option><option value="leftovers">Leftovers</option><option value="dining-out">Dining out</option><option value="open">Open</option></select>
    <select class="input week-recipe-select" data-field="recipe-id" aria-label="Recipe">${options}</select>
    <button class="btn btn-primary btn-sm" data-action="add-meal">Add dinner</button>
  </div>`;
}

export function initWeek({ state, mutate, onMarkCooked = async () => false, document = globalThis.document, today = localDate }) {
  const root = document.getElementById('week-grid');
  let days = [];

  function render() {
    if (!root) return;
    days = buildWeekDays(state.plan, today());
    root.innerHTML = days.map((day, index) => `<section class="week-day${index === 0 ? ' is-tonight' : ''}" data-date="${day.date}">
      <header><div><span>${day.label}</span><time datetime="${day.date}">${day.date.slice(5)}</time></div></header>
      <div class="week-meals">${day.entries.map((entry) => entryHTML(entry, state.recipes)).join('')}</div>
      ${addHTML(day, state.recipes)}
    </section>`).join('');
  }

  function findEntry(target) {
    const id = target.closest('[data-entry-id]')?.dataset.entryId;
    return state.plan.find((entry) => entry.id === id);
  }

  async function handleAction(target) {
    const action = target.dataset.action;
    if (action === 'add-meal') {
      const row = target.closest('.week-add');
      const type = row.querySelector('[data-field="meal-type"]').value;
      const recipeId = row.querySelector('[data-field="recipe-id"]').value;
      const recipe = state.recipes.find((item) => String(item._id || item.id) === recipeId);
      await mutate('plan.upsert', {
        id: uid(), date: row.dataset.date, type,
        recipeId: type === 'recipe' ? recipeId : null,
        targetServings: type === 'recipe' ? parseServings(recipe?.recipeYield) : 2,
        plannedBySub: state.auth?.sub || '', cookSub: null, note: '', status: 'active',
      });
      return;
    }
    const entry = findEntry(target);
    if (!entry) return;
    if (action === 'mark-cooked') {
      if (await onMarkCooked(entry)) { entry.status = 'cooked'; render(); }
      return;
    }
    if (action === 'remove') return mutate('plan.remove', { id: entry.id });
    const next = { ...entry };
    if (action === 'move-next') next.date = shiftDate(entry.date, 1);
    if (action === 'repeat') { next.id = uid(); next.date = shiftDate(entry.date, 7); }
    if (action === 'skip') next.status = entry.status === 'skipped' ? 'active' : 'skipped';
    if (action === 'servings-up') next.targetServings = Number(entry.targetServings || 2) + 1;
    if (action === 'servings-down') next.targetServings = Math.max(1, Number(entry.targetServings || 2) - 1);
    return mutate('plan.upsert', next);
  }

  root?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target) void handleAction(target);
  });
  return { render, days: () => days };
}
