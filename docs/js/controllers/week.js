import { esc } from '../lib/format.js';
import { interactionFeedback as defaultFeedback } from '../lib/interaction-feedback.js';
const DAY = 86_400_000;
const LABELS = { recipe: 'Recipe', leftovers: 'Leftovers', 'dining-out': 'Dining out', open: 'Open' };
const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const SLOT_ORDER = { breakfast: 0, lunch: 1, dinner: 2 };
const uid = () => globalThis.crypto?.randomUUID?.() || `meal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mealSlot = (value) => Object.hasOwn(SLOT_LABELS, value) ? value : 'dinner';

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
      entries: (Array.isArray(plan) ? plan : [])
        .filter((entry) => entry.date === date)
        .map((entry) => ({ ...entry, slot: mealSlot(entry.slot) }))
        .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]),
    };
  });
}

function entryHTML(entry, recipes) {
  const recipe = recipes.find((item) => String(item._id || item.id) === entry.recipeId);
  const title = entry.type === 'recipe' ? (recipe?.name || 'Recipe unavailable') : LABELS[entry.type];
  const skipped = entry.status === 'skipped';
  const cooked = entry.status === 'cooked';
  return `<article class="week-meal${skipped ? ' is-skipped' : ''}${cooked ? ' is-cooked' : ''}" data-entry-id="${esc(entry.id)}">
    <button class="icon-btn week-meal-remove" data-action="remove" data-feedback="destructive" aria-label="Remove ${esc(title)} from ${esc(SLOT_LABELS[mealSlot(entry.slot)])}">×</button>
    <div class="week-meal-copy"><span class="week-meal-slot">${SLOT_LABELS[mealSlot(entry.slot)]}</span><strong class="week-meal-title" title="${esc(title)}">${esc(title)}</strong>${entry.note ? `<small>${esc(entry.note)}</small>` : ''}</div>
    <div class="week-meal-controls">
      <button class="icon-btn icon-btn-sm" data-action="servings-down" data-feedback="select" aria-label="Decrease servings">−</button><span>${esc(entry.targetServings || 2)}</span><button class="icon-btn icon-btn-sm" data-action="servings-up" data-feedback="select" aria-label="Increase servings">+</button>
      <button class="btn btn-ghost btn-sm" data-action="move-next" data-feedback="commit">Tomorrow</button>
      <button class="btn btn-ghost btn-sm" data-action="skip" data-feedback="${skipped ? 'toggle-off' : 'toggle-on'}">${skipped ? 'Unskip' : 'Skip'}</button>
      ${entry.type === 'recipe' ? cooked ? '<span class="week-cooked">Cooked</span>' : '<button class="btn btn-secondary btn-sm" data-action="mark-cooked" data-feedback="commit">Mark cooked</button>' : ''}
    </div>
  </article>`;
}

function addHTML(day, recipes) {
  const options = recipes.map((recipe) => `<option value="${esc(String(recipe._id || recipe.id))}">${esc(recipe.name)}</option>`).join('');
  return `<div class="week-add" data-date="${day.date}">
    <select class="input" data-field="meal-type" aria-label="Meal type"><option value="recipe">Recipe</option><option value="leftovers">Leftovers</option><option value="dining-out">Dining out</option><option value="open">Open</option></select>
    <select class="input week-recipe-select" data-field="recipe-id" aria-label="Recipe">${options}</select>
    <div class="week-add-split">
      <input type="hidden" data-field="meal-slot" value="dinner">
      <button class="btn btn-primary btn-sm week-add-primary" data-action="add-meal" data-feedback="commit">Add dinner</button>
      <button class="btn btn-primary btn-sm week-add-menu-toggle" data-action="toggle-meal-slot" data-feedback="toggle-on" aria-label="Choose breakfast, lunch, or dinner" aria-haspopup="menu" aria-expanded="false">⌄</button>
      <div class="week-add-menu" data-meal-slot-menu role="menu" hidden>
        ${Object.entries(SLOT_LABELS).map(([slot, label]) => `<button type="button" role="menuitem" data-action="select-meal-slot" data-feedback="select" data-slot="${slot}">${label}</button>`).join('')}
      </div>
    </div>
  </div>`;
}

export function initWeek({ state, mutate, onMarkCooked = async () => false, document = globalThis.document, today = localDate, feedback = defaultFeedback }) {
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

  async function handleAction(target, sourceEvent = null) {
    const action = target.dataset.action;
    const interaction = feedback.contextFromEvent?.(sourceEvent, target) || null;
    const outcome = interaction ? { ...interaction, deferred: true } : null;
    if (action === 'toggle-meal-slot') {
      const split = target.closest('.week-add-split');
      const menu = split.querySelector('[data-meal-slot-menu]');
      menu.hidden = !menu.hidden;
      target.setAttribute('aria-expanded', String(!menu.hidden));
      setTimeout(() => { target.dataset.feedback = menu.hidden ? 'toggle-on' : 'toggle-off'; }, 0);
      return;
    }
    if (action === 'select-meal-slot') {
      const split = target.closest('.week-add-split');
      const slot = mealSlot(target.dataset.slot);
      split.querySelector('[data-field="meal-slot"]').value = slot;
      split.querySelector('[data-action="add-meal"]').textContent = `Add ${slot}`;
      split.querySelector('[data-meal-slot-menu]').hidden = true;
      const toggle = split.querySelector('[data-action="toggle-meal-slot"]');
      toggle.setAttribute('aria-expanded', 'false');
      setTimeout(() => { toggle.dataset.feedback = 'toggle-on'; }, 0);
      return;
    }
    if (action === 'add-meal') {
      const row = target.closest('.week-add');
      const type = row.querySelector('[data-field="meal-type"]').value;
      const recipeId = row.querySelector('[data-field="recipe-id"]').value;
      const saved = await mutate('plan.upsert', {
        id: uid(), date: row.dataset.date, slot: mealSlot(row.querySelector('[data-field="meal-slot"]').value), type,
        recipeId: type === 'recipe' ? recipeId : null,
        targetServings: 2,
        plannedBySub: state.auth?.sub || '', cookSub: null, note: '', status: 'active',
      });
      feedback.emit(saved === false ? 'blocked' : 'success', { target, interaction: outcome });
      return;
    }
    const entry = findEntry(target);
    if (!entry) return;
    if (action === 'mark-cooked') {
      const completed = await onMarkCooked(entry);
      if (completed) { entry.status = 'cooked'; render(); }
      feedback.emit(completed ? 'success' : 'blocked', { target, interaction: outcome });
      return;
    }
    if (action === 'remove') {
      const removed = await mutate('plan.remove', { id: entry.id });
      feedback.emit(removed === false ? 'blocked' : 'success', { target, interaction: outcome });
      return removed;
    }
    const next = { ...entry };
    if (action === 'move-next') next.date = shiftDate(entry.date, 1);
    if (action === 'skip') next.status = entry.status === 'skipped' ? 'active' : 'skipped';
    if (action === 'servings-up') next.targetServings = Number(entry.targetServings || 2) + 1;
    if (action === 'servings-down') next.targetServings = Math.max(1, Number(entry.targetServings || 2) - 1);
    const saved = await mutate('plan.upsert', next);
    feedback.emit(saved === false ? 'blocked' : 'success', { target, interaction: outcome });
    return saved;
  }

  root?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target) void handleAction(target, event);
  });
  return { render, days: () => days };
}
