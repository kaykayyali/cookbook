import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildWeekDays, initWeek } from '../docs/js/controllers/week.js';
import { applyWorkspaceMutation, emptyWorkspace } from '../functions/_lib/workspace.js';

const recipes = [
  { id: 'r1', name: 'Roasted cauliflower with an intentionally very long family recipe name', recipeYield: '4 servings' },
  { id: 'r2', name: 'Tacos', recipeYield: '2 servings' },
];

function setup(plan = []) {
  const dom = new JSDOM('<section id="week-grid"></section>');
  const mutations = [];
  const cooked = [];
  const state = { plan, recipes, auth: { sub: 'cook-1' } };
  const week = initWeek({
    state,
    document: dom.window.document,
    today: () => '2026-07-14',
    mutate: async (op, payload) => { mutations.push({ op, payload }); return true; },
    onMarkCooked: async (entry) => { cooked.push(entry); return true; },
  });
  week.render();
  return { dom, state, week, mutations, cooked };
}

test('week days are Tonight-first and remain local-date stable for seven days', () => {
  const days = buildWeekDays([], '2026-07-14');
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((day) => day.date), [
    '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17',
    '2026-07-18', '2026-07-19', '2026-07-20',
  ]);
  assert.equal(days[0].label, 'Tonight');
});

test('each day orders breakfast, lunch, then dinner while legacy entries default to dinner', () => {
  const [day] = buildWeekDays([
    { id: 'dinner-legacy', date: '2026-07-14', type: 'recipe', recipeId: 'r1' },
    { id: 'lunch', date: '2026-07-14', slot: 'lunch', type: 'recipe', recipeId: 'r1' },
    { id: 'breakfast', date: '2026-07-14', slot: 'breakfast', type: 'recipe', recipeId: 'r2' },
    { id: 'dinner', date: '2026-07-14', slot: 'dinner', type: 'recipe', recipeId: 'r2' },
  ], '2026-07-14');
  assert.deepEqual(day.entries.map((entry) => entry.id), ['breakfast', 'lunch', 'dinner-legacy', 'dinner']);
});

test('week renders empty days and all non-recipe meal types without dense calendar columns', () => {
  const { dom } = setup([
    { id: 'e1', date: '2026-07-14', type: 'leftovers', targetServings: 2, note: '', status: 'active' },
    { id: 'e2', date: '2026-07-15', type: 'dining-out', targetServings: 2, note: 'Date night', status: 'active' },
    { id: 'e3', date: '2026-07-16', type: 'open', targetServings: 2, note: '', status: 'active' },
  ]);
  const root = dom.window.document.getElementById('week-grid');
  assert.equal(root.querySelectorAll('.week-day').length, 7);
  assert.match(root.textContent, /Leftovers/);
  assert.match(root.textContent, /Dining out/);
  assert.match(root.textContent, /Open/);
  assert.ok(root.querySelector('[data-action="add-meal"]'));
});

test('recipe entry labels its meal period, removes Repeat, and moves a large remove action to the top right', async () => {
  const { dom, mutations } = setup([{
    id: 'e1', date: '2026-07-14', slot: 'lunch', type: 'recipe', recipeId: 'r1', targetServings: 4,
    plannedBySub: 'k', cookSub: null, note: '', status: 'active',
  }]);
  const root = dom.window.document.getElementById('week-grid');
  const title = root.querySelector('.week-meal-title');
  assert.equal(title.textContent, recipes[0].name);
  assert.equal(title.getAttribute('title'), recipes[0].name);
  assert.match(root.querySelector('.week-meal-slot').textContent, /Lunch/i);
  assert.equal(root.querySelector('[data-action="repeat"]'), null);
  assert.ok(root.querySelector('.week-meal-remove[data-action="remove"]'));
  for (const action of ['move-next', 'skip', 'servings-up']) {
    root.querySelector(`[data-action="${action}"]`).click();
    await Promise.resolve();
  }
  assert.deepEqual(mutations.map((item) => item.op), [
    'plan.upsert', 'plan.upsert', 'plan.upsert',
  ]);
  assert.equal(mutations[0].payload.date, '2026-07-15');
  assert.equal(mutations[1].payload.status, 'skipped');
  assert.equal(mutations[2].payload.targetServings, 5);
});

test('Add dinner is a dinner-default split button that can select breakfast and starts at two servings', async () => {
  const { dom, mutations } = setup();
  const first = dom.window.document.querySelector('.week-day');
  const primary = first.querySelector('[data-action="add-meal"]');
  assert.equal(primary.textContent.trim(), 'Add dinner');
  assert.equal(first.querySelector('[data-field="meal-slot"]').value, 'dinner');
  first.querySelector('[data-action="toggle-meal-slot"]').click();
  const menu = first.querySelector('[data-meal-slot-menu]');
  assert.equal(menu.hidden, false);
  first.querySelector('[data-action="select-meal-slot"][data-slot="breakfast"]').click();
  assert.equal(primary.textContent.trim(), 'Add breakfast');
  assert.equal(first.querySelector('[data-field="meal-slot"]').value, 'breakfast');
  first.querySelector('[data-field="recipe-id"]').value = 'r1';
  primary.click();
  await Promise.resolve();
  assert.equal(mutations[0].payload.slot, 'breakfast');
  assert.equal(mutations[0].payload.targetServings, 2);
});

test('adding recipe, leftovers, dining out, and open entries emits complete absolute entries', async () => {
  const { dom, mutations } = setup();
  const first = dom.window.document.querySelector('.week-day');
  for (const type of ['recipe', 'leftovers', 'dining-out', 'open']) {
    const select = first.querySelector('[data-field="meal-type"]');
    select.value = type;
    if (type === 'recipe') first.querySelector('[data-field="recipe-id"]').value = 'r2';
    first.querySelector('[data-action="add-meal"]').click();
    await Promise.resolve();
  }
  assert.deepEqual(mutations.map((item) => item.payload.type), ['recipe', 'leftovers', 'dining-out', 'open']);
  assert.ok(mutations.every((item) => item.op === 'plan.upsert'));
  assert.ok(mutations.every((item) => item.payload.date === '2026-07-14'));
  assert.ok(mutations.every((item) => item.payload.slot === 'dinner'));
  assert.ok(mutations.every((item) => item.payload.targetServings === 2));
});

test('planned recipe exposes one idempotent Mark cooked action and cooked meals cannot repeat it', async () => {
  const entry = { id: 'e1', date: '2026-07-14', type: 'recipe', recipeId: 'r1', targetServings: 4, status: 'active' };
  const { dom, cooked } = setup([entry]);
  dom.window.document.querySelector('[data-action="mark-cooked"]').click();
  await Promise.resolve();
  assert.equal(cooked.length, 1);
  assert.equal(cooked[0].id, 'e1');
  entry.status = 'cooked';
  const rerendered = setup([entry]);
  assert.equal(rerendered.dom.window.document.querySelector('[data-action="mark-cooked"]'), null);
  assert.match(rerendered.dom.window.document.querySelector('.week-meal').textContent, /Cooked/);
});

test('controller-generated planner payload is accepted by the authoritative reducer', async () => {
  const { dom, mutations } = setup();
  const first = dom.window.document.querySelector('.week-day');
  first.querySelector('[data-field="meal-type"]').value = 'recipe';
  first.querySelector('[data-field="recipe-id"]').value = 'r2';
  first.querySelector('[data-action="add-meal"]').click();
  await Promise.resolve();
  const request = { ...mutations[0], mutationId: 'planner-integration-1' };
  const result = applyWorkspaceMutation(emptyWorkspace('our-home'), request, { now: 1 });
  assert.equal(result.workspace.plan[0].status, 'active');
  assert.equal(result.workspace.plan[0].targetServings, 2);
  assert.equal(result.workspace.plan[0].slot, 'dinner');
  assert.equal(result.workspace.plan[0].plannedBySub, 'cook-1');
  assert.throws(() => applyWorkspaceMutation(emptyWorkspace('our-home'), {
    ...request, mutationId: 'planner-invalid-slot', payload: { ...request.payload, slot: 'brunch' },
  }, { now: 2 }), /invalid_plan_entry/);
});
