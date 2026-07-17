const clone = (value) => JSON.parse(JSON.stringify(value));
import { applyReviewedIngredientCorrection } from './ingredient-corrections.js';
const makeMutationId = () => globalThis.crypto?.randomUUID?.() || `recipe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const recipeId = (item) => String(item?._id || item?.id || '');

function mergeRecipeAuthority(current, updates) {
  const byId = new Map((Array.isArray(updates) ? updates : []).map((item) => [recipeId(item), clone(item)]).filter(([id]) => id));
  const merged = (Array.isArray(current) ? current : []).map((item) => byId.has(recipeId(item)) ? byId.get(recipeId(item)) : clone(item));
  const existing = new Set(merged.map(recipeId));
  for (const item of byId.values()) if (!existing.has(recipeId(item))) merged.push(item);
  return merged;
}

export function applyRecipeOperation(recipes, request) {
  const next = clone(recipes);
  const payload = request.payload || {};
  if (request.op === 'recipe.delete') return next.filter((item) => recipeId(item) !== String(payload.id));
  if (request.op === 'recipe.ingredient.review') {
    const index = next.findIndex((item) => recipeId(item) === String(payload.id));
    if (index < 0) return next;
    const reviewedAt = Math.max(Date.now(), Number(next[index]._updatedAt) + 1 || 0);
    const reviewed = applyReviewedIngredientCorrection(next[index], {
      ingredientId: payload.ingredientId,
      correction: payload.correction,
      reviewer: { sub: 'pending', name: 'You' },
      reviewedAt,
    });
    if (reviewed.ok) next[index] = { ...reviewed.recipe, _updatedAt: reviewedAt };
    return next;
  }
  if (request.op === 'recipe.create' || request.op === 'recipe.update') {
    const item = clone(payload.item || { ...payload.recipe, id: payload.id, _id: payload.id });
    const id = String(payload.id || recipeId(item));
    item.id ||= id;
    item._id ||= id;
    const index = next.findIndex((current) => recipeId(current) === id);
    if (index >= 0) next[index] = item;
    else next.push(item);
  }
  return next;
}

export function createRecipeOutbox({
  repo, authSub, householdId, initial = [], send = async () => ({ ok: false, status: 503 }),
  isOnline = () => globalThis.navigator?.onLine !== false, onChange = () => {}, onStatus = () => {},
  makeId = makeMutationId,
} = {}) {
  let confirmed = clone(initial);
  let optimistic = clone(initial);
  let rows = [];
  let draining = null;
  let persistence = Promise.resolve();
  let authorityWrites = Promise.resolve();
  let sendingMutationId = null;
  let acceptedMutationId = null;
  const neverAttempted = new Set();
  const restored = new Set();
  let mutationVersion = 0;
  let syncStatus = 'synced';
  let blockedSequence = null;
  let discardable = true;
  const rebuild = () => { optimistic = rows.reduce(applyRecipeOperation, clone(confirmed)); };
  const publish = (meta) => onChange(clone(optimistic), meta);
  const report = () => onStatus({
    status: syncStatus, pending: rows.length, sequence: blockedSequence,
    ...(discardable ? {} : { discardable: false }),
  });
  const withAuthorityWrite = (task) => {
    const result = authorityWrites.then(task, task);
    authorityWrites = result.then(() => undefined, () => undefined);
    return result;
  };

  async function init() {
    rows = await repo.listOutbox(authSub, householdId, 'recipe');
    rows.forEach((row) => restored.add(row.mutationId));
    rebuild();
    publish({ pending: rows.length, offline: !isOnline() });
    syncStatus = rows.length ? (isOnline() ? 'syncing' : 'offline') : 'synced';
    report();
    return clone(optimistic);
  }
  async function mutate(op, payload) {
    const provisional = { mutationId: makeId(), authSub, householdId, scope: 'recipe', op, payload: clone(payload) };
    neverAttempted.add(provisional.mutationId);
    mutationVersion += 1;
    rows.push(provisional);
    rebuild();
    publish({ optimistic: true, pending: rows.length });
    syncStatus = isOnline() ? 'syncing' : 'offline';
    report();
    try {
      const persisted = persistence.then(() => repo.enqueue(provisional));
      persistence = persisted.catch(() => undefined);
      const row = await persisted;
      rows = rows.map((item) => item.mutationId === row.mutationId ? row : item)
        .sort((a, b) => a.sequence - b.sequence);
    } catch {
      rows = rows.filter((item) => item.mutationId !== provisional.mutationId);
      neverAttempted.delete(provisional.mutationId);
      rebuild(); publish({ rolledBack: true, pending: rows.length });
      syncStatus = 'blocked'; report();
      return false;
    }
    if (isOnline()) {
      const resume = () => {
        const row = rows.find((item) => item.mutationId === provisional.mutationId);
        if (row?.sequence != null && rows[0]?.mutationId === row.mutationId && syncStatus !== 'blocked') void drain();
      };
      if (draining) void draining.finally(resume);
      else void drain();
    }
    return true;
  }
  async function runDrain() {
    while (rows.length && isOnline()) {
      const row = rows[0];
      if (row.sequence == null) return false;
      let response;
      sendingMutationId = row.mutationId;
      neverAttempted.delete(row.mutationId);
      try {
        const outgoingPayload = clone(row.payload);
        if (row.op === 'recipe.ingredient.review') {
          const base = confirmed.find((item) => recipeId(item) === String(outgoingPayload.id));
          if (base && Number.isSafeInteger(Number(base._updatedAt))) outgoingPayload.expectedUpdatedAt = Number(base._updatedAt);
        }
        response = await send({ mutationId: row.mutationId, op: row.op, payload: outgoingPayload });
      }
      catch {
        syncStatus = 'offline'; blockedSequence = row.sequence; discardable = false; report(); return false;
      }
      finally { sendingMutationId = null; }
      if (!response?.ok) {
        const permanent = [400, 401, 403, 404, 409, 422].includes(Number(response?.status));
        syncStatus = permanent ? 'blocked' : 'offline';
        blockedSequence = row.sequence;
        discardable = permanent && acceptedMutationId !== row.mutationId && !restored.has(row.mutationId);
        report(); return false;
      }
      acceptedMutationId = row.mutationId;
      if (!Array.isArray(response.recipes)) {
        syncStatus = 'blocked'; blockedSequence = row.sequence; discardable = false; report(); return false;
      }
      let outcome;
      try {
        outcome = await withAuthorityWrite(async () => {
          if (rows[0]?.mutationId !== row.mutationId) return 'skipped';
          const authority = response.authorityMode === 'merge'
            ? mergeRecipeAuthority(confirmed, response.recipes)
            : clone(response.recipes);
          await repo.acknowledgeRecipes(authSub, householdId, row.mutationId, authority);
          confirmed = authority;
          rows.shift();
          restored.delete(row.mutationId);
          mutationVersion += 1;
          blockedSequence = null;
          rebuild();
          publish({ optimistic: rows.length > 0, pending: rows.length, authoritative: true });
          return 'acknowledged';
        });
      } catch {
        syncStatus = 'blocked'; blockedSequence = row.sequence; discardable = false; report(); return false;
      }
      if (outcome === 'skipped') { acceptedMutationId = null; continue; }
      acceptedMutationId = null;
      discardable = true;
      syncStatus = rows.length ? 'syncing' : 'synced';
      report();
    }
    return rows.length === 0;
  }
  function drain() {
    if (!draining) draining = persistence.then(runDrain).finally(() => { draining = null; });
    return draining;
  }
  function setAuthority(recipes, { mutationVersion: expectedVersion } = {}) {
    if (!Array.isArray(recipes)) return Promise.resolve(false);
    return withAuthorityWrite(async () => {
      if (expectedVersion != null && expectedVersion !== mutationVersion) return false;
      const authority = clone(recipes);
      await repo.putRecipes(authSub, householdId, authority);
      confirmed = authority;
      rebuild();
      publish({ optimistic: rows.length > 0, pending: rows.length, refreshed: true });
      return true;
    });
  }
  async function retry(sequence) {
    if (!rows.some((row) => row.sequence === sequence)) return false;
    blockedSequence = null; discardable = true; syncStatus = 'syncing'; report();
    if (draining) await draining;
    return drain();
  }
  async function discard(sequence) {
    let target = rows.find((row) => row.sequence === sequence);
    if (target?.mutationId === sendingMutationId && draining) {
      try { await draining; } catch { /* persistence failed; row remains discardable */ }
    }
    target = rows.find((row) => row.sequence === sequence);
    const safelyRejected = blockedSequence === sequence && discardable;
    if (!target || target.mutationId === acceptedMutationId || (!neverAttempted.has(target.mutationId) && !safelyRejected)) return false;
    const discarded = await withAuthorityWrite(async () => {
      const index = rows.findIndex((row) => row.sequence === sequence);
      if (index < 0) return false;
      await repo.deleteOutbox(sequence);
      neverAttempted.delete(rows[index].mutationId);
      restored.delete(rows[index].mutationId);
      rows.splice(index, 1);
      mutationVersion += 1;
      blockedSequence = null;
      rebuild(); publish({ discarded: true, pending: rows.length });
      return true;
    });
    if (!discarded) return false;
    syncStatus = rows.length ? (isOnline() ? 'syncing' : 'offline') : 'synced'; report();
    if (rows.length && isOnline()) {
      if (draining) await draining;
      return drain();
    }
    return true;
  }
  return {
    init, mutate, drain, retry, discard, setAuthority,
    version: () => mutationVersion,
    current: () => clone(optimistic), pending: () => clone(rows), status: () => syncStatus,
  };
}
