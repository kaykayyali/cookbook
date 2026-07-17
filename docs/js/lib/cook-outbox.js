const clone = (value) => JSON.parse(JSON.stringify(value));
const makeMutationId = () => globalThis.crypto?.randomUUID?.() || `cook-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const validHistory = (value) => Array.isArray(value?.events) && Array.isArray(value?.reactions);

export function applyCookOperation(history, request) {
  const next = clone(history);
  const payload = request?.payload || {};
  if (request.op === 'cook.record') {
    const event = clone(payload.event);
    next.events = [event, ...next.events.filter((item) => item.id !== event.id)];
  } else if (request.op === 'cook.react') {
    const reaction = clone(payload.reaction);
    next.reactions = [
      ...next.reactions.filter((item) => !(item.cookEventId === reaction.cookEventId && item.memberSub === reaction.memberSub)),
      reaction,
    ];
  } else if (request.op === 'cook.correct') {
    const event = clone(payload.event);
    next.events = next.events.map((item) => item.id === event.id ? event : item);
  } else if (request.op === 'cook.delete') {
    const eventId = String(payload.eventId || payload.event?.id || '');
    next.events = next.events.filter((item) => item.id !== eventId);
    next.reactions = next.reactions.filter((item) => item.cookEventId !== eventId);
  }
  next.events.sort((a, b) => Number(b.cookedAt) - Number(a.cookedAt) || String(b.id).localeCompare(String(a.id)));
  return next;
}

function authoritativeHistory(current, row, response) {
  if (validHistory(response?.history)) return clone(response.history);
  if (row.op === 'cook.react' && response?.reaction) {
    return applyCookOperation(current, { op: row.op, payload: { reaction: response.reaction } });
  }
  if ((row.op === 'cook.record' || row.op === 'cook.correct') && response?.event) {
    return applyCookOperation(current, { op: row.op, payload: { event: response.event } });
  }
  if (row.op === 'cook.delete' && response?.event) return applyCookOperation(current, row);
  return null;
}

export function createCookOutbox({
  repo,
  authSub,
  householdId,
  initial = { events: [], reactions: [] },
  send = async () => ({ ok: false, status: 503 }),
  isOnline = () => globalThis.navigator?.onLine !== false,
  onChange = () => {},
  onStatus = () => {},
  onAcknowledged = () => {},
  makeId = makeMutationId,
} = {}) {
  if (!repo || !authSub || !householdId || !validHistory(initial)) throw new Error('invalid_cook_outbox_configuration');
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
  const rebuild = () => { optimistic = rows.reduce(applyCookOperation, clone(confirmed)); };
  const publish = (meta = {}) => onChange(clone(optimistic), meta);
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
    const cached = await repo.getCookHistory(authSub, householdId);
    if (validHistory(cached)) confirmed = clone(cached);
    rows = await repo.listOutbox(authSub, householdId, 'cook');
    rows.forEach((row) => restored.add(row.mutationId));
    rebuild();
    publish({ pending: rows.length, offline: !isOnline() });
    syncStatus = rows.length ? (isOnline() ? 'syncing' : 'offline') : 'synced';
    report();
    return clone(optimistic);
  }

  async function mutate(op, payload) {
    const provisional = { mutationId: makeId(), authSub, householdId, scope: 'cook', op, payload: clone(payload || {}) };
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
      rebuild();
      publish({ rolledBack: true, pending: rows.length });
      syncStatus = 'blocked';
      report();
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
    if (!isOnline()) { syncStatus = 'offline'; report(); return false; }
    while (rows.length && isOnline()) {
      const row = rows[0];
      if (row.sequence == null) return false;
      let response;
      sendingMutationId = row.mutationId;
      neverAttempted.delete(row.mutationId);
      try { response = await send({ mutationId: row.mutationId, op: row.op, payload: clone(row.payload) }); }
      catch {
        syncStatus = 'offline'; blockedSequence = row.sequence; discardable = false; report(); return false;
      }
      finally { sendingMutationId = null; }
      if (!response?.ok) {
        const permanent = [400, 401, 403, 404, 409, 422].includes(Number(response?.status));
        syncStatus = permanent ? 'blocked' : 'offline';
        blockedSequence = row.sequence;
        discardable = permanent && acceptedMutationId !== row.mutationId && !restored.has(row.mutationId);
        report();
        return false;
      }
      acceptedMutationId = row.mutationId;
      let outcome;
      try {
        outcome = await withAuthorityWrite(async () => {
          if (rows[0]?.mutationId !== row.mutationId) return 'skipped';
          const authority = authoritativeHistory(confirmed, row, response);
          if (!authority) return 'uncertain';
          await repo.acknowledgeCooks(authSub, householdId, row.mutationId, authority);
          confirmed = authority;
          rows.shift();
          restored.delete(row.mutationId);
          mutationVersion += 1;
          blockedSequence = null;
          rebuild();
          publish({ acknowledged: row.mutationId, pending: rows.length });
          return 'acknowledged';
        });
      } catch {
        syncStatus = 'blocked'; blockedSequence = row.sequence; discardable = false; report(); return false;
      }
      if (outcome === 'uncertain') {
        syncStatus = 'blocked'; blockedSequence = row.sequence; discardable = false; report(); return false;
      }
      if (outcome === 'skipped') { acceptedMutationId = null; continue; }
      acceptedMutationId = null;
      discardable = true;
      onAcknowledged(row, response);
      syncStatus = rows.length ? 'syncing' : 'synced';
      report();
    }
    return rows.length === 0;
  }

  function drain() {
    if (!draining) draining = persistence.then(runDrain).finally(() => { draining = null; });
    return draining;
  }

  async function retry(sequence) {
    if (!rows.some((row) => row.sequence === sequence)) return false;
    if (draining) await draining;
    blockedSequence = null;
    discardable = true;
    syncStatus = 'syncing';
    report();
    return drain();
  }

  async function discard(sequence) {
    let target = rows.find((item) => item.sequence === sequence);
    if (target?.mutationId === sendingMutationId && draining) {
      try { await draining; } catch { /* persistence failed; row remains discardable */ }
    }
    target = rows.find((item) => item.sequence === sequence);
    const safelyRejected = blockedSequence === sequence && discardable;
    if (!target || target.mutationId === acceptedMutationId || (!neverAttempted.has(target.mutationId) && !safelyRejected)) return false;
    const discarded = await withAuthorityWrite(async () => {
      const index = rows.findIndex((item) => item.sequence === sequence);
      if (index < 0) return false;
      await repo.deleteOutbox(sequence);
      neverAttempted.delete(rows[index].mutationId);
      restored.delete(rows[index].mutationId);
      rows.splice(index, 1);
      mutationVersion += 1;
      blockedSequence = null;
      rebuild();
      publish({ discarded: true, pending: rows.length });
      return true;
    });
    if (!discarded) return false;
    syncStatus = rows.length ? (isOnline() ? 'syncing' : 'offline') : 'synced';
    report();
    if (rows.length && isOnline()) {
      if (draining) await draining;
      return drain();
    }
    return true;
  }

  async function setAuthority(history, { mutationVersion: expectedVersion } = {}) {
    if (!validHistory(history)) return false;
    return withAuthorityWrite(async () => {
      if (expectedVersion != null && expectedVersion !== mutationVersion) return false;
      const authority = clone(history);
      await repo.putCookHistory(authSub, householdId, authority);
      confirmed = authority;
      rebuild();
      publish({ refreshed: true, pending: rows.length });
      return true;
    });
  }

  return {
    init, mutate, drain, retry, discard, setAuthority,
    version: () => mutationVersion,
    current: () => clone(optimistic), pending: () => clone(rows), status: () => syncStatus,
  };
}
