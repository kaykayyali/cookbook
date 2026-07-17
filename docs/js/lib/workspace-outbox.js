import {
  applyWorkspaceOperation,
  isWorkspace,
  normalizeWorkspace,
  normalizeWorkspaceMutationPayload,
} from './workspace-sync.js';

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
  let rows = (await repo.listOutbox(authSub, householdId)).map((row) => ({
    ...row,
    payload: normalizeWorkspaceMutationPayload(row.op, row.payload),
  }));
  let optimistic = clone(confirmed);
  let draining = null;
  let persistence = Promise.resolve();
  let authorityWrites = Promise.resolve();
  let sendingMutationId = null;
  let acceptedMutationId = null;
  let blockedSequence = null;
  let discardable = true;
  let mutationGeneration = 0;
  const localGenerations = new Map();
  const persisting = new Set();
  const neverAttempted = new Set();
  const restored = new Set(rows.map((row) => row.mutationId));

  const rebuild = () => {
    let next = clone(confirmed);
    for (const row of rows) {
      try {
        next = applyWorkspaceOperation(next, row);
      } catch (error) {
        if (row.status !== 'failed') throw error;
      }
    }
    optimistic = next;
  };
  const publish = (meta = {}) => {
    rebuild();
    onChange(clone(optimistic), { pending: rows.length, ...meta });
  };
  const status = (state, extra = {}) => onStatus({ state, pending: rows.length, ...extra });
  const preserveDeliveryState = (row, fallback) => {
    if (fallback === 'accepted' || row.deliveryState === 'accepted') return 'accepted';
    if (row.deliveryState === 'uncertain') return 'uncertain';
    return fallback;
  };
  const withAuthorityWrite = (task) => {
    const result = authorityWrites.then(task, task);
    authorityWrites = result.then(() => undefined, () => undefined);
    return result;
  };
  const reloadRows = async () => {
    const startedAt = mutationGeneration;
    const preserve = new Set(persisting);
    const presentAtStart = new Set(rows.map((row) => row.mutationId));
    const listed = (await repo.listOutbox(authSub, householdId)).map((row) => ({
      ...row,
      payload: normalizeWorkspaceMutationPayload(row.op, row.payload),
    }));
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

  async function retainForReconciliation(row, code, deliveryState) {
    const values = { status: 'pending', lastError: code, deliveryState };
    try {
      return await setRow(row, values);
    } catch {
      const next = { ...row, ...values };
      rows = rows.map((item) => item.sequence === next.sequence ? next : item);
      return next;
    }
  }

  async function acknowledgeResponse(row, response) {
    const authority = normalizeWorkspace(response.workspace);
    acceptedMutationId = row.mutationId;
    try {
      const acknowledged = await withAuthorityWrite(async () => {
        if (!rows.some((item) => item.mutationId === row.mutationId)) return false;
        await repo.acknowledge(authSub, householdId, row.mutationId, authority);
        confirmed = authority;
        rows = rows.filter((item) => item.sequence !== row.sequence);
        restored.delete(row.mutationId);
        neverAttempted.delete(row.mutationId);
        localGenerations.delete(row.mutationId);
        mutationGeneration += 1;
        publish({ acknowledged: row.mutationId });
        return true;
      });
      if (acknowledged) acceptedMutationId = null;
      return acknowledged ? 'acknowledged' : 'skipped';
    } catch {
      await retainForReconciliation(row, 'local_acknowledgement_failed', 'accepted');
      blockedSequence = row.sequence;
      discardable = false;
      status('failed', {
        sequence: row.sequence, code: 'local_acknowledgement_failed', discardable: false,
      });
      publish({ queued: true });
      return 'failed';
    }
  }

  async function sendOnce(row) {
    return send({ mutationId: row.mutationId, op: row.op, payload: clone(row.payload), baseRevision: confirmed.revision });
  }

  async function processRows() {
    if (!isOnline()) { status('offline'); return false; }
    await reloadRows();
    publish({ queued: rows.length > 0 });
    for (let row of rows) {
      if (row.status === 'failed') {
        blockedSequence = row.sequence;
        discardable = row.deliveryState === 'rejected' && !restored.has(row.mutationId);
        status('failed', {
          sequence: row.sequence, code: row.lastError,
          ...(discardable ? {} : { discardable: false }),
        });
        return false;
      }
      const priorDeliveryState = row.deliveryState;
      try {
        row = await setRow(row, {
          status: 'sending', attempts: (row.attempts || 0) + 1, lastError: null,
          deliveryState: priorDeliveryState || (restored.has(row.mutationId) ? 'uncertain' : 'attempting'),
        });
      } catch {
        blockedSequence = row.sequence;
        discardable = false;
        status('failed', { sequence: row.sequence, code: 'local_storage_unavailable', discardable: false });
        publish({ queued: true });
        return false;
      }
      neverAttempted.delete(row.mutationId);
      status('syncing');
      let response;
      sendingMutationId = row.mutationId;
      try {
        response = await sendOnce(row);
      } catch {
        row = await retainForReconciliation(
          row, 'network_unavailable', preserveDeliveryState(row, 'uncertain'),
        );
        blockedSequence = row.sequence;
        discardable = false;
        status('offline', {
          sequence: row.sequence, code: 'network_unavailable', discardable: false,
        });
        publish({ queued: true });
        return false;
      } finally {
        sendingMutationId = null;
      }
      if (response?.ok && isWorkspace(response.workspace) && response.workspace.revision >= confirmed.revision) {
        const outcome = await acknowledgeResponse(row, response);
        if (outcome === 'acknowledged' || outcome === 'skipped') continue;
        return false;
      }
      if (response?.ok) {
        row = await retainForReconciliation(
          row, 'stale_workspace_response', preserveDeliveryState(row, 'accepted'),
        );
        blockedSequence = row.sequence;
        discardable = false;
        status('failed', {
          sequence: row.sequence, code: 'stale_workspace_response', discardable: false,
        });
        publish({ queued: true });
        return false;
      }
      if (response?.status === 409 && isWorkspace(response.workspace)) {
        try {
          await withAuthorityWrite(async () => {
            if (response.workspace.revision < confirmed.revision) return false;
            const authority = normalizeWorkspace(response.workspace);
            await repo.putWorkspace(authSub, householdId, authority);
            confirmed = authority;
            return true;
          });
        } catch {
          row = await retainForReconciliation(
            row, 'local_authority_persistence_failed', preserveDeliveryState(row, 'uncertain'),
          );
          blockedSequence = row.sequence;
          discardable = false;
          status('failed', {
            sequence: row.sequence, code: 'local_authority_persistence_failed', discardable: false,
          });
          publish({ queued: true });
          return false;
        }
        if (SAFE_REBASE.has(row.op)) {
          publish({ rebased: true, queued: true });
          sendingMutationId = row.mutationId;
          try { response = await sendOnce(row); } catch { response = { ok: false, status: 0 }; }
          finally { sendingMutationId = null; }
          if (response?.ok && isWorkspace(response.workspace) && response.workspace.revision >= confirmed.revision) {
            const outcome = await acknowledgeResponse(row, response);
            if (outcome === 'acknowledged' || outcome === 'skipped') continue;
            return false;
          }
          if (!response?.status) {
            row = await retainForReconciliation(
              row, 'workspace_unavailable', preserveDeliveryState(row, 'uncertain'),
            );
            blockedSequence = row.sequence;
            discardable = false;
            status('offline', {
              sequence: row.sequence, code: 'workspace_unavailable', discardable: false,
            });
            publish({ queued: true });
            return false;
          }
        }
        const deliveryState = ['accepted', 'uncertain'].includes(row.deliveryState)
          ? row.deliveryState : 'rejected';
        const failed = { ...row, status: 'failed', lastError: 'revision_conflict', deliveryState };
        try { row = await setRow(row, failed); }
        catch { rows = rows.map((item) => item.sequence === row.sequence ? failed : item); row = failed; }
        blockedSequence = row.sequence;
        discardable = deliveryState === 'rejected' && !restored.has(row.mutationId);
        status('failed', {
          sequence: row.sequence, code: 'revision_conflict',
          ...(discardable ? {} : { discardable: false }),
        });
        publish({ rebased: true, queued: true });
        return false;
      }
      const responseStatus = Number(response?.status || 0);
      const permanent = [400, 401, 403, 404, 422].includes(responseStatus);
      const code = responseStatus === 401 ? 'authentication_required'
        : permanent ? 'invalid_mutation' : 'workspace_unavailable';
      const deliveryState = preserveDeliveryState(row, permanent ? 'rejected' : 'uncertain');
      if (permanent) {
        const failed = { ...row, status: 'failed', lastError: code, deliveryState };
        try { row = await setRow(row, failed); }
        catch { rows = rows.map((item) => item.sequence === row.sequence ? failed : item); row = failed; }
      } else {
        row = await retainForReconciliation(row, code, deliveryState);
      }
      blockedSequence = row.sequence;
      discardable = permanent && deliveryState === 'rejected' && !restored.has(row.mutationId);
      status(permanent ? 'failed' : 'offline', {
        sequence: row.sequence, code, ...(discardable ? {} : { discardable: false }),
      });
      publish({ queued: true });
      return false;
    }
    blockedSequence = null;
    discardable = true;
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

  function reportDrainFailure() {
    const row = rows.find((item) => item.sequence != null) || rows[0];
    blockedSequence = row?.sequence ?? null;
    discardable = false;
    status('failed', {
      sequence: blockedSequence, code: 'local_storage_unavailable', discardable: false,
    });
    publish({ queued: rows.length > 0 });
    return false;
  }

  function drain() {
    if (!draining) {
      draining = persistence.then(runDrain)
        .catch(reportDrainFailure)
        .finally(() => { draining = null; });
    }
    return draining;
  }

  return {
    current: () => clone(optimistic),
    pending: () => rows.length,
    async mutate(op, payload) {
      const mutationId = String(makeId() || '');
      if (!mutationId
          || rows.some((row) => row.mutationId === mutationId)
          || confirmed.recentMutations.includes(mutationId)
          || persisting.has(mutationId)) {
        status('failed', { code: 'mutation_id_collision' });
        return false;
      }
      const provisional = {
        mutationId, authSub, householdId, scope: 'workspace',
        op, payload: normalizeWorkspaceMutationPayload(op, payload),
        createdAt: Date.now(), status: 'pending',
        attempts: 0, nextAttemptAt: 0, lastError: null,
      };
      mutationGeneration += 1;
      localGenerations.set(provisional.mutationId, mutationGeneration);
      persisting.add(provisional.mutationId);
      neverAttempted.add(provisional.mutationId);
      rows.push(provisional);
      publish({ queued: true, optimistic: true });
      let row;
      try {
        const persisted = persistence.then(() => repo.enqueue(provisional));
        persistence = persisted.catch(() => undefined);
        row = await persisted;
        rows = rows.map((item) => item === provisional ? row : item);
      } catch {
        await withAuthorityWrite(async () => {
          const unpersisted = rows.filter((item) => item !== provisional && item.sequence == null);
          try {
            const durable = await repo.listOutbox(authSub, householdId);
            durable.forEach((item) => restored.add(item.mutationId));
            const durableIds = new Set(durable.map((item) => item.mutationId));
            rows = [
              ...durable,
              ...unpersisted.filter((item) => !durableIds.has(item.mutationId)),
            ].sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER));
          } catch {
            rows = rows.filter((item) => item !== provisional);
          }
        });
        neverAttempted.delete(provisional.mutationId);
        localGenerations.delete(provisional.mutationId);
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
      let row = rows.find((item) => item.sequence === sequence);
      if (!row) return false;
      if (draining) await draining;
      row = rows.find((item) => item.sequence === sequence);
      if (!row) return false;
      try { await setRow(row, { status: 'pending', lastError: null, nextAttemptAt: 0 }); }
      catch { return false; }
      blockedSequence = null;
      discardable = true;
      status('pending');
      return drain();
    },
    async discard(sequence) {
      let target = rows.find((row) => row.sequence === sequence);
      if (target?.mutationId === sendingMutationId && draining) {
        try { await draining; } catch { /* drain contains persistence failures; re-check below */ }
      }
      target = rows.find((row) => row.sequence === sequence);
      const safelyRejected = blockedSequence === sequence && discardable;
      const safeBeforeSend = target && neverAttempted.has(target.mutationId);
      if (!target || target.mutationId === acceptedMutationId || (!safeBeforeSend && !safelyRejected)) return false;
      const discarded = await withAuthorityWrite(async () => {
        const current = rows.find((row) => row.sequence === sequence);
        if (!current) return false;
        let durableRows;
        try { durableRows = await repo.listOutbox(authSub, householdId); }
        catch { return false; }
        const durable = durableRows.find((row) => row.sequence === sequence);
        if (!durable || durable.mutationId !== current.mutationId) return false;
        const safeBeforeSend = neverAttempted.has(current.mutationId)
          && !['attempting', 'accepted', 'uncertain'].includes(durable.deliveryState);
        const safelyRejected = blockedSequence === sequence && discardable
          && current.deliveryState === 'rejected' && durable.deliveryState === 'rejected';
        if (current.mutationId === sendingMutationId || current.mutationId === acceptedMutationId
          || (!safeBeforeSend && !safelyRejected)) return false;
        await repo.deleteOutbox(sequence);
        const index = rows.findIndex((row) => row.sequence === sequence && row.mutationId === current.mutationId);
        if (index < 0) return false;
        const [removed] = rows.splice(index, 1);
        neverAttempted.delete(removed.mutationId);
        restored.delete(removed.mutationId);
        localGenerations.delete(removed.mutationId);
        mutationGeneration += 1;
        blockedSequence = null;
        discardable = true;
        publish({ discarded: true });
        return true;
      });
      if (!discarded) return false;
      status(rows.length ? 'pending' : 'synced');
      if (rows.length && isOnline()) {
        if (draining) await draining;
        return drain();
      }
      return true;
    },
    async refresh(workspace) {
      if (!isWorkspace(workspace)) return false;
      return withAuthorityWrite(async () => {
        if (workspace.revision < confirmed.revision) return false;
        const authority = normalizeWorkspace(workspace);
        await repo.putWorkspace(authSub, householdId, authority);
        confirmed = authority;
        await reloadRows();
        publish({ refreshed: true, queued: rows.length > 0 });
        return true;
      });
    },
  };
}
