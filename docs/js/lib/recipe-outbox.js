const clone = (value) => JSON.parse(JSON.stringify(value));
const makeMutationId = () => globalThis.crypto?.randomUUID?.() || `recipe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const recipeId = (item) => String(item?._id || item?.id || '');

export function applyRecipeOperation(recipes, request) {
  const next = clone(recipes);
  const payload = request.payload || {};
  if (request.op === 'recipe.delete') return next.filter((item) => recipeId(item) !== String(payload.id));
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
  let syncStatus = 'synced';
  let blockedSequence = null;
  const rebuild = () => { optimistic = rows.reduce(applyRecipeOperation, clone(confirmed)); };
  const publish = (meta) => onChange(clone(optimistic), meta);
  const report = () => onStatus({ status: syncStatus, pending: rows.length, sequence: blockedSequence });

  async function init() {
    rows = await repo.listOutbox(authSub, householdId, 'recipe');
    rebuild();
    publish({ pending: rows.length, offline: !isOnline() });
    syncStatus = rows.length ? (isOnline() ? 'syncing' : 'offline') : 'synced';
    report();
    return clone(optimistic);
  }
  async function mutate(op, payload) {
    const row = await repo.enqueue({ mutationId: makeId(), authSub, householdId, scope: 'recipe', op, payload: clone(payload) });
    rows.push(row);
    rows.sort((a, b) => a.sequence - b.sequence);
    rebuild();
    publish({ optimistic: true, pending: rows.length });
    syncStatus = isOnline() ? 'syncing' : 'offline';
    report();
    if (isOnline()) await drain();
    return true;
  }
  async function runDrain() {
    while (rows.length && isOnline()) {
      const row = rows[0];
      let response;
      try { response = await send({ mutationId: row.mutationId, op: row.op, payload: row.payload }); }
      catch { syncStatus = 'offline'; report(); return false; }
      if (!response?.ok || !Array.isArray(response.recipes)) {
        syncStatus = 'blocked'; blockedSequence = row.sequence; report(); return false;
      }
      confirmed = clone(response.recipes);
      await repo.acknowledgeRecipes(authSub, householdId, row.mutationId, confirmed);
      rows.shift();
      blockedSequence = null;
      rebuild();
      publish({ optimistic: rows.length > 0, pending: rows.length });
      syncStatus = rows.length ? 'syncing' : 'synced';
      report();
    }
    return rows.length === 0;
  }
  function drain() {
    if (!draining) draining = runDrain().finally(() => { draining = null; });
    return draining;
  }
  function setAuthority(recipes) {
    confirmed = clone(recipes);
    rebuild();
    publish({ optimistic: rows.length > 0, pending: rows.length, refreshed: true });
  }
  async function retry(sequence) {
    if (!rows.some((row) => row.sequence === sequence)) return false;
    blockedSequence = null; syncStatus = 'syncing'; report();
    return drain();
  }
  async function discard(sequence) {
    const index = rows.findIndex((row) => row.sequence === sequence);
    if (index < 0) return false;
    await repo.deleteOutbox(sequence);
    rows.splice(index, 1);
    blockedSequence = null;
    rebuild(); publish({ discarded: true, pending: rows.length });
    syncStatus = rows.length ? (isOnline() ? 'syncing' : 'offline') : 'synced'; report();
    return true;
  }
  return {
    init, mutate, drain, retry, discard, setAuthority,
    current: () => clone(optimistic), pending: () => clone(rows), status: () => syncStatus,
  };
}
