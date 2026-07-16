import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCart } from '../docs/js/lib/cart.js';
import { applyWorkspaceMutation, emptyWorkspace } from '../functions/_lib/workspace.js';

const egg = {
  raw: '2 eggs',
  name: 'egg',
  amount: 2,
  unit: 'count',
  kind: 'indivisible',
  countLabel: '',
  displayName: 'eggs',
  category: 'dairy-eggs',
  confidence: 1,
};

const mutation = (mutationId, op, payload) => ({ mutationId, op, payload });

function recipe(id = 'r1') {
  return {
    _id: id,
    name: 'Eggs at home',
    recipeYield: '2 servings',
    recipeIngredient: ['2 eggs'],
    updatedAt: 100,
  };
}

test('workspace migration provides authoritative revisioned household defaults', () => {
  const migration = readFileSync(
    new URL('../docs/superpowers/migrations/0006_household_workspace.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /household_workspace/);
  assert.match(migration, /recent_mutations_json\s+TEXT\s+NOT NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS household_workspace_mutations/);
  assert.match(migration, /PRIMARY KEY \(household_id, mutation_id\)/);
  assert.match(migration, /INSERT INTO household_workspace/);
  assert.deepEqual(emptyWorkspace('our-home'), {
    householdId: 'our-home',
    revision: 0,
    plan: [],
    cart: [],
    pantry: [],
    shoppingChecked: {},
    manualItems: [],
    recentMutations: [],
    updatedAt: 0,
  });
});

test('absolute plan operations support add, move, skip, repeat, and serving changes', () => {
  let workspace = emptyWorkspace('our-home');
  const base = {
    id: 'meal-1', date: '2026-07-14', slot: 'dinner', type: 'recipe', recipeId: 'r1',
    targetServings: 2, plannedBySub: 'cook-1', cookSub: null, note: '', status: 'active',
  };
  workspace = applyWorkspaceMutation(workspace, mutation('m1', 'plan.upsert', base)).workspace;
  workspace = applyWorkspaceMutation(workspace, mutation('m2', 'plan.upsert', {
    ...base, date: '2026-07-15', targetServings: 4, status: 'skipped',
  })).workspace;
  workspace = applyWorkspaceMutation(workspace, mutation('m3', 'plan.upsert', {
    ...base, id: 'meal-2', date: '2026-07-16', type: 'leftovers', recipeId: null,
  })).workspace;
  assert.deepEqual(workspace.plan.map(({ id, date, type, targetServings, status }) => (
    { id, date, type, targetServings, status }
  )), [
    { id: 'meal-1', date: '2026-07-15', type: 'recipe', targetServings: 4, status: 'skipped' },
    { id: 'meal-2', date: '2026-07-16', type: 'leftovers', targetServings: 2, status: 'active' },
  ]);
});

test('duplicate mutation IDs are successful no-ops without another revision', () => {
  const first = applyWorkspaceMutation(
    emptyWorkspace('our-home'),
    mutation('same-id', 'pantry.add', { name: 'flour' }),
  );
  const duplicate = applyWorkspaceMutation(first.workspace, mutation('same-id', 'pantry.add', { name: 'flour' }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.workspace.revision, 1);
  assert.deepEqual(duplicate.workspace.pantry.map(({ name, quantity, unit }) => ({ name, quantity, unit })), [
    { name: 'flour', quantity: null, unit: 'qualitative' },
  ]);
});

test('authoritative pantry mutations accumulate compatible purchased quantities', () => {
  let workspace = { ...emptyWorkspace('our-home'), pantry: ['eggs'] };
  workspace = applyWorkspaceMutation(workspace, mutation('buy-1', 'pantry.add', { item: {
    name: 'egg', displayName: 'Eggs', quantity: 9, unit: 'count', kind: 'indivisible',
    countLabel: '', category: 'dairy-eggs',
  } })).workspace;
  workspace = applyWorkspaceMutation(workspace, mutation('buy-2', 'pantry.add', { item: {
    name: 'eggs', displayName: 'Eggs', quantity: 3, unit: 'count', kind: 'indivisible',
    countLabel: '', category: 'dairy-eggs',
  } })).workspace;
  assert.deepEqual(workspace.pantry, [{
    name: 'egg', displayName: 'Eggs', quantity: 12, unit: 'count', kind: 'indivisible',
    countLabel: '', category: 'dairy-eggs',
  }]);
});

test('authoritative Shopping transfer source is idempotent across distinct mutations', () => {
  const payload = { sourceKey: 'egg', item: {
    name: 'egg', displayName: 'Egg', quantity: 3, unit: 'count', kind: 'indivisible',
    countLabel: '', category: 'dairy-eggs',
  } };
  let workspace = { ...emptyWorkspace('our-home'), cart: [{ recipeId: 'r1', ingredients: [egg] }] };
  workspace = applyWorkspaceMutation(workspace, mutation('buy-once', 'pantry.add', payload)).workspace;
  workspace = applyWorkspaceMutation(workspace, mutation('buy-again', 'pantry.add', payload)).workspace;
  assert.equal(workspace.pantry[0].quantity, 3);
  assert.equal(workspace.shoppingChecked['pantry-transfer:egg'], true);
  workspace = applyWorkspaceMutation(workspace, mutation('remove-egg', 'shopping.removeIngredient', { name: 'egg' })).workspace;
  assert.equal(workspace.shoppingChecked['pantry-transfer:egg'], undefined, 'removing the row permits a future purchase');
});

test('authoritative Pantry removal distinguishes incompatible count package labels', () => {
  const workspace = {
    ...emptyWorkspace('our-home'),
    pantry: [
      { name: 'water', quantity: 2, unit: 'count', kind: 'indivisible', countLabel: 'bottle' },
      { name: 'water', quantity: 3, unit: 'count', kind: 'indivisible', countLabel: 'can' },
    ],
  };
  const removed = applyWorkspaceMutation(workspace, mutation('remove-bottles', 'pantry.remove', {
    name: 'water', unit: 'count', countLabel: 'bottle',
  })).workspace;
  assert.deepEqual(removed.pantry.map(({ quantity, countLabel }) => ({ quantity, countLabel })), [
    { quantity: 3, countLabel: 'can' },
  ]);
});

test('plan generation excludes non-recipe and skipped meals and combines servings per recipe', () => {
  let workspace = emptyWorkspace('our-home');
  const entries = [
    { id: 'a', date: '2026-07-14', slot: 'dinner', type: 'recipe', recipeId: 'r1', targetServings: 2, plannedBySub: 'cook-1', cookSub: null, note: '', status: 'active' },
    { id: 'b', date: '2026-07-15', slot: 'dinner', type: 'recipe', recipeId: 'r1', targetServings: 4, plannedBySub: 'cook-1', cookSub: null, note: '', status: 'active' },
    { id: 'c', date: '2026-07-16', slot: 'dinner', type: 'dining-out', recipeId: null, targetServings: 2, plannedBySub: 'cook-1', cookSub: null, note: '', status: 'active' },
    { id: 'd', date: '2026-07-17', slot: 'dinner', type: 'recipe', recipeId: 'r1', targetServings: 8, plannedBySub: 'cook-1', cookSub: null, note: '', status: 'skipped' },
  ];
  for (const [index, entry] of entries.entries()) {
    workspace = applyWorkspaceMutation(workspace, mutation(`p${index}`, 'plan.upsert', entry)).workspace;
  }
  workspace.manualItems = [{ id: 'manual-1', name: 'flowers', checked: false }];
  workspace.shoppingChecked = { 'ingredient:egg': true };
  workspace = applyWorkspaceMutation(workspace, mutation('generate', 'shopping.regeneratePlanRange', {
    rangeStart: '2026-07-14', rangeEnd: '2026-07-20',
  }), { recipes: [recipe()] }).workspace;
  assert.equal(workspace.cart.length, 1);
  assert.equal(workspace.cart[0].targetServings, 6);
  assert.equal(workspace.cart[0].origin.kind, 'plan');
  assert.deepEqual(workspace.manualItems.map(({ id, name, checked }) => ({ id, name, checked })), [{ id: 'manual-1', name: 'flower', checked: false }]);
  assert.deepEqual(workspace.shoppingChecked, { 'ingredient:egg': true });
  assert.equal(aggregateCart(workspace.cart)[0].quantity, 6);
});

test('unchanged regeneration is idempotent and preserves ingredient removal tombstones', () => {
  let workspace = emptyWorkspace('our-home');
  const entry = { id: 'a', date: '2026-07-14', slot: 'dinner', type: 'recipe', recipeId: 'r1', targetServings: 2, plannedBySub: 'cook-1', cookSub: null, note: '', status: 'active' };
  workspace = applyWorkspaceMutation(workspace, mutation('p1', 'plan.upsert', entry)).workspace;
  workspace = applyWorkspaceMutation(workspace, mutation('g1', 'shopping.regeneratePlanRange', {
    rangeStart: '2026-07-14', rangeEnd: '2026-07-20',
  }), { recipes: [recipe()] }).workspace;
  workspace.cart[0].removedIngredientNames = ['egg'];
  const regenerated = applyWorkspaceMutation(workspace, mutation('g2', 'shopping.regeneratePlanRange', {
    rangeStart: '2026-07-14', rangeEnd: '2026-07-20',
  }), { recipes: [recipe()] }).workspace;
  assert.deepEqual(regenerated.cart[0].removedIngredientNames, ['egg']);
  assert.equal(regenerated.cart.length, 1);
});

test('clear removes generated shopping state without letting stale checked rows survive', () => {
  const workspace = {
    ...emptyWorkspace('our-home'),
    cart: [{ recipeId: 'r1', ingredients: [egg] }],
    shoppingChecked: { 'ingredient:egg': true },
    manualItems: [{ id: 'm1', name: 'flowers', checked: true }],
  };
  const cleared = applyWorkspaceMutation(workspace, mutation('clear', 'shopping.clear', {})).workspace;
  assert.deepEqual(cleared.cart, []);
  assert.deepEqual(cleared.shoppingChecked, {});
  assert.deepEqual(cleared.manualItems, []);
});

test('removing generated and manual rows prunes their authoritative checked state', () => {
  let workspace = {
    ...emptyWorkspace('our-home'),
    cart: [{ recipeId: 'r1', ingredients: [egg] }],
    shoppingChecked: { egg: true, 'manual:m1': true },
    manualItems: [{ id: 'm1', name: 'flowers', checked: true }],
  };
  workspace = applyWorkspaceMutation(workspace, mutation('remove-egg', 'shopping.removeIngredient', { name: 'egg' })).workspace;
  workspace = applyWorkspaceMutation(workspace, mutation('remove-manual', 'shopping.removeManual', { id: 'm1' })).workspace;
  assert.deepEqual(workspace.shoppingChecked, {});
});
