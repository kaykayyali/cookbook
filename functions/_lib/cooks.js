import { readWorkspace } from './workspace.js';

const REACTIONS = new Set(['loved', 'good', 'not_for_us']);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function normalizeCookInput(input, now = Date.now()) {
  if (!input || typeof input !== 'object') throw new Error('invalid_cook_event');
  const eventId = text(input.eventId, 100);
  const recipeId = text(input.recipeId, 100);
  const cookedAt = Number(input.cookedAt ?? now);
  const participants = [...new Set(Array.isArray(input.participants)
    ? input.participants.map((value) => text(value, 200)).filter(Boolean) : [])].slice(0, 2);
  const servings = Number(input.servings);
  if (!eventId || !recipeId || !Number.isFinite(cookedAt) || cookedAt <= 0
    || cookedAt > now + 86_400_000 || !participants.length
    || !Number.isFinite(servings) || servings <= 0 || servings > 100) {
    throw new Error('invalid_cook_event');
  }
  return {
    eventId,
    recipeId,
    planEntryId: text(input.planEntryId, 100) || null,
    cookedAt,
    participants,
    cookSub: text(input.cookSub, 200) || participants[0],
    servings,
    occasion: text(input.occasion ?? input.notes, 2000),
    notes: text(input.notes, 2000),
    photoRef: text(input.photoRef, 500) || null,
  };
}

export function normalizeReaction(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid_reaction');
  const reaction = input.reaction == null || input.reaction === '' ? null : text(input.reaction, 20);
  const dismissed = input.dismissed === true;
  const taste = input.taste == null ? null : Number(input.taste);
  const complexity = input.complexity == null ? null : Number(input.complexity);
  const review = text(input.review, 1000);
  const validTaste = taste == null || (Number.isInteger(taste) && taste >= 1 && taste <= 5);
  const validComplexity = complexity == null
    || (Number.isInteger(complexity) && complexity >= 1 && complexity <= 5);
  const hasFeedback = taste != null || complexity != null || review || reaction || dismissed;
  if (!hasFeedback || !validTaste || !validComplexity
    || (reaction && !REACTIONS.has(reaction))) throw new Error('invalid_reaction');
  if (input.wouldMakeAgain != null && typeof input.wouldMakeAgain !== 'boolean') throw new Error('invalid_reaction');
  return {
    taste,
    complexity,
    review,
    reaction,
    wouldMakeAgain: input.wouldMakeAgain == null ? null : input.wouldMakeAgain,
    note: text(input.note, 1000),
    dismissed,
  };
}

export function summarizeRecipeHistory(recipeId, events = [], reactions = []) {
  const active = events.filter((event) => event.recipeId === recipeId && !event.deletedAt)
    .sort((a, b) => b.cookedAt - a.cookedAt);
  const ids = new Set(active.map((event) => event.id));
  return {
    cookCount: active.length,
    lastCookedAt: active[0]?.cookedAt || null,
    reactions: reactions.filter((reaction) => ids.has(reaction.cookEventId)),
  };
}

export async function recordCookEvent(store, { householdId, actorSub, input, now = Date.now() }) {
  if (!householdId || !actorSub) throw new Error('household_required');
  const normalized = normalizeCookInput(input, now);
  const prior = await store.getEvent(normalized.eventId, householdId);
  if (prior) return prior;
  if (!await store.hasRecipe(normalized.recipeId, householdId)) throw new Error('recipe_not_found');
  const members = new Set(await store.listMemberSubs(householdId));
  if (!members.has(actorSub) || !normalized.participants.every((sub) => members.has(sub))
    || !members.has(normalized.cookSub)) throw new Error('invalid_participants');
  let workspace = null;
  let priorPlanStatus = null;
  if (normalized.planEntryId) {
    const current = await store.getWorkspace(householdId);
    const index = current.plan.findIndex((entry) => entry.id === normalized.planEntryId);
    if (index < 0 || current.plan[index].recipeId !== normalized.recipeId) throw new Error('invalid_plan_link');
    priorPlanStatus = current.plan[index].status;
    workspace = {
      ...current,
      plan: current.plan.map((entry, entryIndex) => entryIndex === index
        ? { ...entry, status: 'cooked' } : entry),
    };
  }
  const event = {
    id: normalized.eventId, householdId, recipeId: normalized.recipeId,
    planEntryId: normalized.planEntryId, cookedAt: normalized.cookedAt,
    participants: normalized.participants, cookSub: normalized.cookSub,
    servings: normalized.servings, occasion: normalized.occasion,
    notes: normalized.notes, photoRef: normalized.photoRef,
    createdBySub: actorSub, createdAt: now, updatedAt: now, deletedAt: null, revision: 1, priorPlanStatus,
  };
  return store.commitCook({ event, workspace });
}

export async function saveMemberReaction(store, { householdId, actorSub, eventId, input, now = Date.now() }) {
  if (!householdId || !actorSub || !eventId) throw new Error('invalid_reaction');
  const event = await store.getEvent(eventId, householdId);
  if (!event || event.deletedAt) throw new Error('cook_event_not_found');
  const normalized = normalizeReaction(input);
  return store.saveReaction({
    cookEventId: eventId, recipeId: event.recipeId, memberSub: actorSub,
    ...normalized, createdAt: now, updatedAt: now,
  });
}

export async function correctCookEvent(store, { householdId, actorSub, input, now = Date.now() }) {
  if (!householdId || !actorSub || !input?.eventId) throw new Error('invalid_cook_event');
  const before = await store.getEvent(input.eventId, householdId);
  if (!before || before.deletedAt) throw new Error('cook_event_not_found');
  const members = new Set(await store.listMemberSubs(householdId));
  const revisionMatches = Number(input.eventRevision) === before.revision;
  let normalized;
  try {
    normalized = normalizeCookInput({ ...input, recipeId: before.recipeId, planEntryId: before.planEntryId }, now);
  } catch (error) {
    if (!revisionMatches) throw new Error('event_revision_conflict');
    throw error;
  }
  if (!members.has(actorSub) || !normalized.participants.every((sub) => members.has(sub))
    || !members.has(normalized.cookSub)) throw new Error('invalid_participants');
  if (!revisionMatches) {
    const alreadyApplied = before.cookedAt === normalized.cookedAt
      && JSON.stringify(before.participants) === JSON.stringify(normalized.participants)
      && before.cookSub === normalized.cookSub && before.servings === normalized.servings
      && before.occasion === normalized.occasion && before.notes === normalized.notes
      && before.photoRef === normalized.photoRef;
    if (alreadyApplied) return before;
    throw new Error('event_revision_conflict');
  }
  const event = {
    ...before, cookedAt: normalized.cookedAt, participants: normalized.participants,
    cookSub: normalized.cookSub, servings: normalized.servings,
    occasion: normalized.occasion, notes: normalized.notes,
    photoRef: normalized.photoRef, updatedAt: now, revision: before.revision + 1,
  };
  return store.commitCorrection({ before, event, actorSub });
}

export async function deleteCookEvent(store, { householdId, actorSub, input, now = Date.now() }) {
  if (!householdId || !actorSub || !input?.eventId) throw new Error('invalid_cook_event');
  const before = await store.getEvent(input.eventId, householdId);
  if (!before) throw new Error('cook_event_not_found');
  if (before.deletedAt) return before;
  if (Number(input.eventRevision) !== before.revision) throw new Error('event_revision_conflict');
  let workspace = null;
  if (before.planEntryId) {
    const current = await store.getWorkspace(householdId);
    workspace = {
      ...current,
      plan: current.plan.map((entry) => entry.id === before.planEntryId
        ? { ...entry, status: before.priorPlanStatus || 'active' } : entry),
    };
  }
  const event = { ...before, deletedAt: now, updatedAt: now, revision: before.revision + 1 };
  return store.commitDeletion({ before, event, workspace, actorSub });
}

const eventFromRow = (row) => row && ({
  id: row.id, householdId: row.household_id, recipeId: row.recipe_id,
  planEntryId: row.plan_entry_id || null, cookedAt: row.cooked_at,
  participants: JSON.parse(row.participants_json || '[]'), cookSub: row.cook_sub,
  servings: row.servings, occasion: row.occasion || row.notes || '',
  notes: row.notes || '', photoRef: row.photo_ref || null,
  createdBySub: row.created_by_sub, createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at || null, revision: row.revision, priorPlanStatus: row.prior_plan_status || null,
});
const reactionFromRow = (row) => ({
  cookEventId: row.cook_event_id, recipeId: row.recipe_id, memberSub: row.member_sub,
  taste: row.taste == null ? null : Number(row.taste),
  complexity: row.complexity == null ? null : Number(row.complexity),
  review: row.review || row.note || '',
  reaction: row.reaction || null, wouldMakeAgain: row.would_make_again == null ? null : row.would_make_again === 1,
  note: row.note || '', dismissed: row.dismissed === 1, createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function ensureCooksSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cook_events (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, recipe_id TEXT NOT NULL, plan_entry_id TEXT,
      cooked_at INTEGER NOT NULL, participants_json TEXT NOT NULL, cook_sub TEXT NOT NULL,
      servings REAL NOT NULL, occasion TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', photo_ref TEXT, created_by_sub TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
      revision INTEGER NOT NULL DEFAULT 1, prior_plan_status TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cook_events_household_time ON cook_events(household_id, cooked_at DESC, id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cook_event_reactions (
      cook_event_id TEXT NOT NULL, member_sub TEXT NOT NULL,
      reaction TEXT CHECK (reaction IN ('loved', 'good', 'not_for_us')), would_make_again INTEGER,
      note TEXT NOT NULL DEFAULT '', taste INTEGER CHECK (taste BETWEEN 1 AND 5),
      complexity INTEGER CHECK (complexity BETWEEN 1 AND 5), review TEXT NOT NULL DEFAULT '',
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (cook_event_id, member_sub)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cook_event_audit (
      id TEXT PRIMARY KEY, cook_event_id TEXT NOT NULL, household_id TEXT NOT NULL,
      actor_sub TEXT NOT NULL, operation TEXT NOT NULL,
      before_json TEXT, after_json TEXT, created_at INTEGER NOT NULL
    )`),
  ]);
  const columns = await db.prepare('PRAGMA table_info(cook_events)').all();
  if (!(columns?.results || []).some((column) => column.name === 'prior_plan_status')) {
    await db.prepare('ALTER TABLE cook_events ADD COLUMN prior_plan_status TEXT').run();
  }
  if (!(columns?.results || []).some((column) => column.name === 'occasion')) {
    await db.prepare("ALTER TABLE cook_events ADD COLUMN occasion TEXT NOT NULL DEFAULT ''").run();
    await db.prepare("UPDATE cook_events SET occasion = notes WHERE occasion = '' AND notes <> ''").run();
  }
  const reactionColumns = await db.prepare('PRAGMA table_info(cook_event_reactions)').all();
  const reactionNames = new Set((reactionColumns?.results || []).map((column) => column.name));
  if (!reactionNames.has('taste')) await db.prepare('ALTER TABLE cook_event_reactions ADD COLUMN taste INTEGER CHECK (taste BETWEEN 1 AND 5)').run();
  if (!reactionNames.has('complexity')) await db.prepare('ALTER TABLE cook_event_reactions ADD COLUMN complexity INTEGER CHECK (complexity BETWEEN 1 AND 5)').run();
  if (!reactionNames.has('review')) {
    await db.prepare("ALTER TABLE cook_event_reactions ADD COLUMN review TEXT NOT NULL DEFAULT ''").run();
    await db.prepare("UPDATE cook_event_reactions SET review = note WHERE review = '' AND note <> ''").run();
  }
}

export async function createD1CookStore(db) {
  await ensureCooksSchema(db);
  const casGuard = () => db.prepare(`/* cook_cas_guard */
    INSERT INTO cook_event_audit
      (id, cook_event_id, household_id, actor_sub, operation, before_json, after_json, created_at)
    SELECT 'cook_cas_guard', NULL, '', '', 'created', NULL, NULL, 0
    WHERE changes() != 1`);
  return {
    async getEvent(id, householdId) {
      return eventFromRow(await db.prepare('SELECT * FROM cook_events WHERE id = ? AND household_id = ?').bind(id, householdId).first());
    },
    async hasRecipe(id, householdId) {
      return !!await db.prepare('SELECT id FROM household_recipes WHERE id = ? AND household_id = ?').bind(id, householdId).first();
    },
    async listMemberSubs(householdId) {
      const result = await db.prepare('SELECT user_sub FROM household_members WHERE household_id = ?').bind(householdId).all();
      return (result?.results || []).map((row) => row.user_sub);
    },
    getWorkspace: (householdId) => readWorkspace(db, householdId),
    async commitCook({ event, workspace }) {
      const insert = db.prepare(`INSERT OR IGNORE INTO cook_events
        (id, household_id, recipe_id, plan_entry_id, cooked_at, participants_json, cook_sub, servings,
         occasion, notes, photo_ref, created_by_sub, created_at, updated_at, deleted_at, revision, prior_plan_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`).bind(
        event.id, event.householdId, event.recipeId, event.planEntryId, event.cookedAt,
        JSON.stringify(event.participants), event.cookSub, event.servings, event.occasion, event.notes, event.photoRef,
        event.createdBySub, event.createdAt, event.updatedAt, event.priorPlanStatus,
      );
      const audit = db.prepare(`INSERT OR IGNORE INTO cook_event_audit
        (id, cook_event_id, household_id, actor_sub, operation, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, 'created', NULL, ?, ?)`).bind(
        `${event.id}:created`, event.id, event.householdId, event.createdBySub, JSON.stringify(event), event.createdAt,
      );
      try {
        if (workspace) {
          const updatedAt = event.updatedAt;
          const update = db.prepare(`UPDATE household_workspace SET
            plan_json = ?, revision = revision + 1, updated_at = ?
            WHERE household_id = ? AND revision = ?
              AND NOT EXISTS (SELECT 1 FROM cook_events WHERE id = ? AND household_id = ?)`).bind(
            JSON.stringify(workspace.plan), updatedAt, event.householdId, workspace.revision, event.id, event.householdId,
          );
          await db.batch([update, casGuard(), insert, casGuard(), audit]);
        } else {
          await db.batch([insert, casGuard(), audit]);
        }
      } catch (error) {
        const existing = eventFromRow(await db.prepare('SELECT * FROM cook_events WHERE id = ? AND household_id = ?')
          .bind(event.id, event.householdId).first());
        if (existing) return existing;
        throw new Error('event_revision_conflict', { cause: error });
      }
      return eventFromRow(await db.prepare('SELECT * FROM cook_events WHERE id = ? AND household_id = ?')
        .bind(event.id, event.householdId).first());
    },
    async commitCorrection({ before, event, actorSub }) {
      const update = db.prepare(`UPDATE cook_events SET
        cooked_at = ?, participants_json = ?, cook_sub = ?, servings = ?, occasion = ?, notes = ?, photo_ref = ?,
        updated_at = ?, revision = revision + 1
        WHERE id = ? AND household_id = ? AND revision = ? AND deleted_at IS NULL`).bind(
        event.cookedAt, JSON.stringify(event.participants), event.cookSub, event.servings,
        event.occasion, event.notes, event.photoRef, event.updatedAt, event.id, event.householdId, before.revision,
      );
      const audit = db.prepare(`INSERT INTO cook_event_audit
        (id, cook_event_id, household_id, actor_sub, operation, before_json, after_json, created_at)
        SELECT ?, ?, ?, ?, 'corrected', ?, ?, ? WHERE changes() = 1`).bind(
        `${event.id}:corrected:${event.revision}`, event.id, event.householdId, actorSub,
        JSON.stringify(before), JSON.stringify(event), event.updatedAt,
      );
      const [updateResult] = await db.batch([update, audit]);
      if (Number(updateResult?.meta?.changes) !== 1) throw new Error('event_revision_conflict');
      const saved = eventFromRow(await db.prepare('SELECT * FROM cook_events WHERE id = ? AND household_id = ?')
        .bind(event.id, event.householdId).first());
      if (saved?.revision !== event.revision) throw new Error('event_revision_conflict');
      return saved;
    },
    async commitDeletion({ before, event, workspace, actorSub }) {
      const statements = [];
      if (workspace) {
        statements.push(db.prepare(`UPDATE household_workspace SET
          plan_json = ?, revision = revision + 1, updated_at = ?
          WHERE household_id = ? AND revision = ?`).bind(
          JSON.stringify(workspace.plan), event.updatedAt, event.householdId, workspace.revision,
        ));
        statements.push(casGuard());
      }
      statements.push(db.prepare(`UPDATE cook_events SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND household_id = ? AND revision = ? AND deleted_at IS NULL
          AND (? IS NULL OR EXISTS (SELECT 1 FROM household_workspace
            WHERE household_id = ? AND revision = ? AND plan_json = ?))`).bind(
        event.deletedAt, event.updatedAt, event.id, event.householdId, before.revision,
        workspace ? event.planEntryId : null, event.householdId,
        workspace ? workspace.revision + 1 : 0, workspace ? JSON.stringify(workspace.plan) : '',
      ));
      statements.push(casGuard());
      statements.push(db.prepare(`INSERT INTO cook_event_audit
        (id, cook_event_id, household_id, actor_sub, operation, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, 'deleted', ?, ?, ?)`).bind(
        `${event.id}:deleted:${event.revision}`, event.id, event.householdId, actorSub,
        JSON.stringify(before), JSON.stringify(event), event.updatedAt,
      ));
      try { await db.batch(statements); }
      catch (error) { throw new Error('event_revision_conflict', { cause: error }); }
      const saved = eventFromRow(await db.prepare('SELECT * FROM cook_events WHERE id = ? AND household_id = ?')
        .bind(event.id, event.householdId).first());
      if (saved?.revision !== event.revision || !saved.deletedAt) throw new Error('event_revision_conflict');
      return saved;
    },
    async saveReaction(reaction) {
      await db.prepare(`INSERT INTO cook_event_reactions
        (cook_event_id, member_sub, reaction, would_make_again, note, taste, complexity, review, dismissed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cook_event_id, member_sub) DO UPDATE SET
          reaction = excluded.reaction, would_make_again = excluded.would_make_again,
          note = excluded.note, taste = excluded.taste, complexity = excluded.complexity,
          review = excluded.review, dismissed = excluded.dismissed, updated_at = excluded.updated_at`).bind(
        reaction.cookEventId, reaction.memberSub, reaction.reaction,
        reaction.wouldMakeAgain == null ? null : reaction.wouldMakeAgain ? 1 : 0,
        reaction.note, reaction.taste, reaction.complexity, reaction.review,
        reaction.dismissed ? 1 : 0, reaction.createdAt, reaction.updatedAt,
      ).run();
      return reaction;
    },
    async listEvents(householdId) {
      const result = await db.prepare('SELECT * FROM cook_events WHERE household_id = ? AND deleted_at IS NULL ORDER BY cooked_at DESC, id DESC')
        .bind(householdId).all();
      return (result?.results || []).map(eventFromRow);
    },
    async listReactions(householdId) {
      const result = await db.prepare(`SELECT r.*, e.recipe_id FROM cook_event_reactions r
        JOIN cook_events e ON e.id = r.cook_event_id WHERE e.household_id = ?`).bind(householdId).all();
      return (result?.results || []).map(reactionFromRow);
    },
  };
}
