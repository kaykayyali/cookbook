import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeCookInput, normalizeReaction, summarizeRecipeHistory, recordCookEvent, saveMemberReaction,
  correctCookEvent, deleteCookEvent, createD1CookStore,
} from '../functions/_lib/cooks.js';

const migration = readFileSync(new URL('../docs/superpowers/migrations/0007_cooking_history.sql', import.meta.url), 'utf8');
const auditMigration = readFileSync(new URL('../docs/superpowers/migrations/0009_cook_history_audit.sql', import.meta.url), 'utf8');

const guardAwareD1 = () => {
  let operationSql = [];
  const db = {
    prepare: (sql) => ({
      sql,
      bind() { return this; },
      first: async () => null,
      all: async () => ({ results: sql.includes('cook_event_reactions')
        ? ['taste', 'complexity', 'review'].map((name) => ({ name }))
        : ['prior_plan_status', 'occasion'].map((name) => ({ name })) }),
      run: async () => ({ meta: { changes: 0 } }),
    }),
    batch: async (statements) => {
      const sql = statements.map((statement) => statement.sql || '');
      if (sql.some((statement) => /CREATE TABLE|ALTER TABLE/.test(statement))) {
        return statements.map(() => ({ meta: { changes: 0 } }));
      }
      operationSql = sql;
      if (sql.some((statement) => statement.includes('cook_cas_guard'))) {
        throw new Error('CHECK constraint failed');
      }
      return statements.map((_, index) => ({ meta: { changes: index === 0 ? 0 : 1 } }));
    },
  };
  return { db, operationSql: () => operationSql };
};

test('cooking-history migration stores auditable events and one reaction per member', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cook_events/);
  assert.match(migration, /plan_entry_id/);
  assert.match(migration, /deleted_at/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cook_event_reactions/);
  assert.match(migration, /PRIMARY KEY \(cook_event_id, member_sub\)/);
});

test('cook history completion migration preserves prior plan state and append-only audit records', () => {
  assert.match(auditMigration, /prior_plan_status/);
  assert.match(auditMigration, /CREATE TABLE IF NOT EXISTS cook_event_audit/);
  assert.match(auditMigration, /corrected.*deleted/);
});

test('cook input is bounded, idempotent, and preserves plan linkage', () => {
  const event = normalizeCookInput({
    eventId: 'event-1', recipeId: 'recipe-1', planEntryId: 'plan-1', cookedAt: 1000,
    participants: ['kay', 'gloria', 'kay'], servings: 4, occasion: 'Friday night',
  }, 2000);
  assert.deepEqual(event.participants, ['kay', 'gloria']);
  assert.equal(event.servings, 4);
  assert.equal(event.planEntryId, 'plan-1');
  assert.equal(event.occasion, 'Friday night');
  assert.throws(() => normalizeCookInput({ eventId: 'x', recipeId: '', participants: [] }, 2000), /invalid_cook_event/);
});

test('member reviews use bounded Taste and Complexity stars plus personal review text', () => {
  assert.deepEqual(normalizeReaction({ taste: 5, complexity: 2, review: 'Crispy edges' }), {
    taste: 5, complexity: 2, review: 'Crispy edges',
    reaction: null, wouldMakeAgain: null, note: '', dismissed: false,
  });
  assert.throws(() => normalizeReaction({ taste: 0, complexity: 3 }), /invalid_reaction/);
  assert.throws(() => normalizeReaction({ taste: 4, complexity: 6 }), /invalid_reaction/);
});

test('Taste, Complexity, and Review can each be saved independently', () => {
  assert.deepEqual(normalizeReaction({ taste: 4 }), {
    taste: 4, complexity: null, review: '',
    reaction: null, wouldMakeAgain: null, note: '', dismissed: false,
  });
  assert.deepEqual(normalizeReaction({ complexity: 3 }), {
    taste: null, complexity: 3, review: '',
    reaction: null, wouldMakeAgain: null, note: '', dismissed: false,
  });
  assert.deepEqual(normalizeReaction({ review: 'Lovely with lemon' }), {
    taste: null, complexity: null, review: 'Lovely with lemon',
    reaction: null, wouldMakeAgain: null, note: '', dismissed: false,
  });
});

test('legacy categorical reactions remain readable without fabricating star ratings', () => {
  assert.deepEqual(normalizeReaction({ reaction: 'loved', wouldMakeAgain: true, note: 'Legacy memory' }), {
    taste: null, complexity: null, review: '',
    reaction: 'loved', wouldMakeAgain: true, note: 'Legacy memory', dismissed: false,
  });
});

test('rating migration adds shared occasion and member-owned star review fields', () => {
  const ratingsMigration = readFileSync(new URL('../docs/superpowers/migrations/0010_cook_ratings.sql', import.meta.url), 'utf8');
  assert.match(ratingsMigration, /occasion/i);
  assert.match(ratingsMigration, /taste/i);
  assert.match(ratingsMigration, /complexity/i);
  assert.match(ratingsMigration, /review/i);
});

test('recipe history excludes deleted events and reports shared reaction memory', () => {
  const summary = summarizeRecipeHistory('r1', [
    { id: 'old', recipeId: 'r1', cookedAt: 100, deletedAt: null },
    { id: 'new', recipeId: 'r1', cookedAt: 200, deletedAt: null },
    { id: 'deleted', recipeId: 'r1', cookedAt: 300, deletedAt: 400 },
  ], [
    { cookEventId: 'new', memberSub: 'kay', reaction: 'loved', note: 'Keep this one' },
    { cookEventId: 'new', memberSub: 'gloria', reaction: 'good', note: '' },
  ]);
  assert.equal(summary.cookCount, 2);
  assert.equal(summary.lastCookedAt, 200);
  assert.equal(summary.reactions.length, 2);
});

test('recording a planned cook is idempotent and atomically marks the plan cooked', async () => {
  const commits = [];
  const existing = new Map();
  const store = {
    getEvent: async (id) => existing.get(id) || null,
    hasRecipe: async () => true,
    listMemberSubs: async () => ['kay', 'gloria'],
    getWorkspace: async () => ({ revision: 2, plan: [{ id: 'plan-1', recipeId: 'r1', status: 'active' }] }),
    commitCook: async ({ event, workspace }) => {
      if (existing.has(event.id)) return existing.get(event.id);
      existing.set(event.id, event);
      commits.push({ event, workspace });
      return event;
    },
  };
  const input = { eventId: 'event-1', recipeId: 'r1', planEntryId: 'plan-1', cookedAt: 1000, participants: ['kay', 'gloria'], servings: 2 };
  const first = await recordCookEvent(store, { householdId: 'our-home', actorSub: 'kay', input, now: 2000 });
  const second = await recordCookEvent(store, { householdId: 'our-home', actorSub: 'kay', input, now: 2000 });
  assert.equal(first.id, second.id);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].workspace.plan[0].status, 'cooked');
});

test('reaction writes are always attributed to the authenticated member', async () => {
  let saved;
  const store = {
    getEvent: async () => ({ id: 'event-1', householdId: 'our-home', deletedAt: null }),
    saveReaction: async (reaction) => { saved = reaction; return reaction; },
  };
  await saveMemberReaction(store, {
    householdId: 'our-home', actorSub: 'kay', eventId: 'event-1',
    input: { memberSub: 'gloria', taste: 5, complexity: 2, review: 'Excellent' }, now: 2000,
  });
  assert.equal(saved.memberSub, 'kay');
  assert.equal(saved.taste, 5);
  assert.equal(saved.complexity, 2);
});

test('history corrections use event revision CAS and preserve immutable identity', async () => {
  let committed;
  const before = { id: 'e1', householdId: 'home', recipeId: 'r1', planEntryId: 'p1', createdBySub: 'kay', createdAt: 1, revision: 2, deletedAt: null };
  const store = {
    getEvent: async () => before,
    listMemberSubs: async () => ['kay', 'gloria'],
    commitCorrection: async (change) => { committed = change; return change.event; },
  };
  const corrected = await correctCookEvent(store, { householdId: 'home', actorSub: 'gloria', input: {
    eventId: 'e1', eventRevision: 2, cookedAt: 1000, participants: ['kay', 'gloria'], cookSub: 'gloria', servings: 4, notes: 'Crispier',
  }, now: 2000 });
  assert.equal(corrected.recipeId, 'r1');
  assert.equal(corrected.revision, 3);
  assert.equal(committed.before, before);
  await assert.rejects(() => correctCookEvent(store, { householdId: 'home', actorSub: 'kay', input: { eventId: 'e1', eventRevision: 1 }, now: 2000 }), /event_revision_conflict/);
});

test('retrying an already committed absolute correction is idempotent', async () => {
  const current = {
    id: 'e1', householdId: 'home', recipeId: 'r1', planEntryId: 'p1', revision: 3, deletedAt: null,
    cookedAt: 1000, participants: ['kay', 'gloria'], cookSub: 'gloria', servings: 4,
    occasion: 'Thursday dinner', notes: '', photoRef: null,
  };
  let commits = 0;
  const store = {
    getEvent: async () => current,
    listMemberSubs: async () => ['kay', 'gloria'],
    commitCorrection: async () => { commits += 1; },
  };
  const result = await correctCookEvent(store, { householdId: 'home', actorSub: 'kay', input: {
    eventId: 'e1', eventRevision: 2, cookedAt: 1000, participants: ['kay', 'gloria'],
    cookSub: 'gloria', servings: 4, occasion: 'Thursday dinner', notes: '', photoRef: null,
  }, now: 3000 });
  assert.equal(result, current);
  assert.equal(commits, 0);
});

test('D1 correction CAS rejects a losing writer even when the winner has the same revision', async () => {
  const winner = {
    id: 'e1', household_id: 'home', recipe_id: 'r1', plan_entry_id: 'p1', cooked_at: 1000,
    participants_json: '["kay"]', cook_sub: 'kay', servings: 2, occasion: 'Winner', notes: '',
    photo_ref: null, created_by_sub: 'kay', created_at: 1, updated_at: 3,
    deleted_at: null, revision: 2, prior_plan_status: 'active',
  };
  const db = {
    prepare: (sql) => ({
      bind() { return this; },
      first: async () => sql.includes('SELECT * FROM cook_events') ? winner : null,
      all: async () => ({ results: sql.includes('cook_event_reactions')
        ? ['taste', 'complexity', 'review'].map((name) => ({ name }))
        : ['prior_plan_status', 'occasion'].map((name) => ({ name })) }),
      run: async () => ({ meta: { changes: 0 } }),
    }),
    batch: async () => [{ meta: { changes: 0 } }, { meta: { changes: 0 } }],
  };
  const store = await createD1CookStore(db);
  const before = {
    id: 'e1', householdId: 'home', recipeId: 'r1', planEntryId: 'p1', cookedAt: 900,
    participants: ['kay'], cookSub: 'kay', servings: 2, occasion: 'Before', notes: '',
    photoRef: null, createdBySub: 'kay', createdAt: 1, updatedAt: 1,
    deletedAt: null, revision: 1, priorPlanStatus: 'active',
  };
  const loser = { ...before, occasion: 'Loser', updatedAt: 2, revision: 2 };
  await assert.rejects(
    () => store.commitCorrection({ before, event: loser, actorSub: 'kay' }),
    /event_revision_conflict/,
  );
});

test('planned D1 cook creation aborts the batch when workspace or event CAS does not change one row', async () => {
  const fake = guardAwareD1();
  const store = await createD1CookStore(fake.db);
  const event = {
    id: 'e1', householdId: 'home', recipeId: 'r1', planEntryId: 'p1', cookedAt: 1,
    participants: ['kay'], cookSub: 'kay', servings: 2, occasion: '', notes: '', photoRef: null,
    createdBySub: 'kay', createdAt: 1, updatedAt: 1, revision: 1, priorPlanStatus: 'skipped',
  };
  await assert.rejects(
    store.commitCook({ event, workspace: { revision: 3, plan: [{ id: 'p1', status: 'cooked' }] } }),
    /event_revision_conflict/,
  );
  assert.equal(fake.operationSql().filter((sql) => sql.includes('cook_cas_guard')).length, 2);
});

test('planned D1 cook deletion rolls back workspace restoration when event CAS loses', async () => {
  const fake = guardAwareD1();
  const store = await createD1CookStore(fake.db);
  const before = { id: 'e1', householdId: 'home', recipeId: 'r1', planEntryId: 'p1', revision: 1 };
  await assert.rejects(
    store.commitDeletion({
      before, actorSub: 'kay',
      event: { ...before, deletedAt: 2, updatedAt: 2, revision: 2 },
      workspace: { revision: 3, plan: [{ id: 'p1', status: 'skipped' }] },
    }),
    /event_revision_conflict/,
  );
  assert.equal(fake.operationSql().filter((sql) => sql.includes('cook_cas_guard')).length, 2);
});

test('history deletion is idempotent and restores the linked plan prior status', async () => {
  let committed;
  const before = { id: 'e1', householdId: 'home', recipeId: 'r1', planEntryId: 'p1', priorPlanStatus: 'skipped', revision: 2, deletedAt: null };
  const store = {
    getEvent: async () => before,
    getWorkspace: async () => ({ revision: 4, plan: [{ id: 'p1', status: 'cooked' }] }),
    commitDeletion: async (change) => { committed = change; return change.event; },
  };
  const deleted = await deleteCookEvent(store, { householdId: 'home', actorSub: 'kay', input: { eventId: 'e1', eventRevision: 2 }, now: 3000 });
  assert.equal(deleted.deletedAt, 3000);
  assert.equal(committed.workspace.plan[0].status, 'skipped');
  const alreadyDeleted = { ...deleted };
  store.getEvent = async () => alreadyDeleted;
  assert.equal(await deleteCookEvent(store, { householdId: 'home', actorSub: 'gloria', input: { eventId: 'e1', eventRevision: 3 }, now: 4000 }), alreadyDeleted);
});
