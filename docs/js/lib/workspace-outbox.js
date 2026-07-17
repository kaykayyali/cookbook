import { applyWorkspaceOperation, isWorkspace, normalizeWorkspace } from './workspace-sync.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeMutationId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const SAFE_REBASE = new Set([
  'plan.remove', 'pantry.remove', 'cart.setTargetServings', 'cart.removeSelection',
  'shopping.removeIngredient', 'shopping.removeManual', 'shopping.clear',
]);

export async function createWorkspaceOutbox({
  repo,
  authSub,
  householdId,
  initial,
  send = async () => ({ ok: false, status: 0 }),
  isOnline = () => globalThis.navigator?.onLine !== false,
  makeId = makeMutationId,
  onChange = () => {},
  onStatus = () => {},
  locks = globalThis.navigator?.locks,
} = {}) {
  if (!repo || !authSub || !householdId || !isWorkspace(initial)) throw new Error('invalid_outbox_configuration');
  const cached = await repo.getWorkspace(authSub, householdId);
  let confirmed = normalizeWorkspace(
    isWorkspace(cached) && cached.revision >= initial.revision ? cached : initial,
  );
  let rows = await repo.listOutbox(authSub, householdId);
  let optimistic = clone(confirmed);
  let draining = null;
  let persistence = Promise.resolve();
  let mutationGeneration = 0;
  const localGenerations = new Map();
  const persisting = new Set();

  const rebuild = () => {
    optimistic = rows.reduce((state, row) => applyWorkspaceOperation(state, row), clone(confirmed));
  };
  const publish = (meta = {}) => {
    rebuild();
    onChange(clone(optimistic), { pending: rows.length, ...meta });
  };
  const status = (state, extra = {}) => onStatus({ state, pending: rows.length, ...extra });
  const reloadRows = async () => {
    const startedAt = mutationGeneration;
    const preserve = new Set(persisting);
    const presentAtStart = new Set(rows.map((row) => row.mutationId));
    const listed = await repo.listOutbox(authSub, householdId);
    const stillPresent = new Set(rows.map((row) => row.mutationId));
    const merged = new Map(listed
      .filter((row) => !presentAtStart.has(row.mutationId) || stillPresent.has(row.mutationId))
      .map((row) => [row.mutationId, row]));
    for (const row of rows) {
      if (preserve.has(row.mutationId) || (localGenerations.get(row.mutationId) || 0) > startedAt) {
        merged.set(row.mutationId, row);
      }
    }
    rows = [...merged.values()].sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER));
  };
  rebuild();
  status(isOnline() ? (rows.length ? 'pending' : 'synced') : 'offline');

  async function setRow(row, values) {
    const next = { ...row, ...values };
    await repo.updateOutbox(next);
    rows = rows.map((item) => item.sequence === next.sequence ? next : item);
    return next;
  }

  async function sendOnce(row) {
    return send({ mutationId: row.mutationId, op: row.op, payload: clone(row.payload), baseRevision: confirmed.revision });
  }

  async function processRows() {
    if (!isOnline()) { status('offline'); return false; }
    await reloadRows();
    publish({ queued: rows.length > 0 });
    for (let row of rows) {
      if (row.status === 'failed') { status('failed', { sequence: row.sequence, code: row.lastError }); return false; }
      row = await setRow(row, { status: 'sending', attempts: (row.attempts || 0) + 1, lastError: null });
      status('syncing');
      let response;
      try {
        response = await sendOnce(row);
      } catch {
        await setRow(row, { status: 'pending', lastError: 'network_unavailable', nextAttemptAt: Date.now() + 1000 });
        status('offline', { code: 'network_unavailable' });
        publish({ queued: true });
        return false;
      }
      if (response?.ok && isWorkspace(response.workspace) && response.workspace.revision >= confirmed.revision) {
        confirmed = normalizeWorkspace(response.workspace);
        await repo.acknowledge(authSub, householdId, row.mutationId, confirmed);
        rows = rows.filter((item) => item.sequence !== row.sequence);
        publish({ acknowledged: row.mutationId });
        continue;
      }
      if (response?.ok) {
        await setRow(row, { status: 'pending', lastError: 'stale_workspace_response' });
        status('failed', { sequence: row.sequence, code: 'stale_workspace_response' });
        publish({ queued: true });
        return false;
      }
      if (response?.status === 409 && isWorkspace(response.workspace)) {
        confirmed = normalizeWorkspace(response.workspace);
        await repo.putWorkspace(authSub, householdId, confirmed);
        publish({ rebased: true, queued: true });
        if (SAFE_REBASE.has(row.op)) {
          try { response = await sendOnce(row); } catch { response = { ok: false, status: 0 }; }
          if (response?.ok && isWorkspace(response.workspace) && response.workspace.revision >= confirmed.revision) {
            confirmed = normalizeWorkspace(response.workspace);
            await repo.acknowledge(authSub, householdId, row.mutationId, confirmed);
            rows = rows.filter((item) => item.sequence !== row.sequence);
            publish({ acknowledged: row.mutationId });
            continue;
          }
        }
        await setRow(row, { status: 'failed', lastError: 'revision_conflict' });
        status('failed', { sequence: row.sequence, code: 'revision_conflict' });
        publish({ queued: true });
        return false;
      }
      const permanent = [400, 403, 404].includes(response?.status);
      const code = response?.status === 401 ? 'authentication_required'
        : permanent ? 'invalid_mutation' : 'workspace_unavailable';
      await setRow(row, { status: permanent || response?.status === 401 ? 'failed' : 'pending', lastError: code });
      status(permanent || response?.status === 401 ? 'failed' : 'offline', { sequence: row.sequence, code });
      publish({ queued: true });
      return false;
    }
    status('synced');
    return true;
  }

  async function runDrain() {
    if (locks?.request) {
      return locks.request(`cookbook-sync:${authSub}:${householdId}`, { ifAvailable: true },
        (lock) => lock ? processRows() : false);
    }
    return processRows();
  }

  function drain() {
    if (!draining) draining = persistence.then(runDrain).finally(() => { draining = null; });
    return draining;
  }

  return {
    current: () => clone(optimistic),
    pending: () => rows.length,
    async mutate(op, payload) {
      const provisional = {
        mutationId: makeId(), authSub, householdId, scope: 'workspace',
        op, payload: clone(payload || {}), createdAt: Date.now(), status: 'pending',
        attempts: 0, nextAttemptAt: 0, lastError: null,
      };
      mutationGeneration += 1;
      localGenerations.set(provisional.mutationId, mutationGeneration);
      persisting.add(provisional.mutationId);
      rows.push(provisional);
      publish({ queued: true, optimistic: true });
      let row;
      try {
        const persisted = persistence.then(() => repo.enqueue(provisional));
        persistence = persisted.catch(() => undefined);
        row = await persisted;
        rows = rows.map((item) => item.mutationId === row.mutationId ? row : item);
      } catch {
        rows = rows.filter((item) => item.mutationId !== provisional.mutationId);
        publish({ rolledBack: true });
        status('failed', { code: 'local_storage_unavailable' });
        return false;
      } finally {
        persisting.delete(provisional.mutationId);
      }
      if (!isOnline()) { status('offline'); return true; }
      void drain();
      return true;
    },
    drain,
    async retry(sequence) {
      const row = rows.find((item) => item.sequence === sequence);
      if (!row) return false;
      await setRow(row, { status: 'pending', lastError: null, nextAttemptAt: 0 });
      if (draining) await draining;
      return drain();
    },
    async discard(sequence) {
      await repo.deleteOutbox(sequence);
      rows = rows.filter((row) => row.sequence !== sequence);
      publish({ discarded: true });
      status(rows.length ? 'pending' : 'synced');
      if (rows.length && isOnline()) {
        if (draining) await draining;
        return drain();
      }
      return true;
    },
    async refresh(workspace) {
      if (!isWorkspace(workspace) || workspace.revision < confirmed.revision) return false;
      confirmed = normalizeWorkspace(workspace);
      await repo.putWorkspace(authSub, householdId, confirmed);
      await reloadRows();
      publish({ refreshed: true, queued: rows.length > 0 });
      return true;
    },
  };
}
