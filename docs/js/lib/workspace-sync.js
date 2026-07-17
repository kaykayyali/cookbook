import {
  aggregateCart,
  canonicalName,
  removeRecipeSelection,
  removeShoppingItem,
  setTargetServings,
} from './cart.js';
import {
  addToPantry,
  normalizePantry,
  normalizePantryEntry,
  pantryRecordFingerprint,
  removeFromPantry,
  restorePantryRecord,
  updatePantryRecord,
} from './pantry.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const SAFE_REBASE = new Set([
  'plan.remove', 'pantry.remove', 'cart.setTargetServings', 'cart.removeSelection',
  'shopping.removeIngredient', 'shopping.removeManual', 'shopping.clear',
]);
const TRANSFER_PREFIX = 'pantry-transfer:';
const PLAN_SLOTS = new Set(['breakfast', 'lunch', 'dinner']);
const slotOrder = { breakfast: 0, lunch: 1, dinner: 2 };

export function normalizeWorkspaceMutationPayload(op, payload) {
  const normalized = clone(payload || {});
  if ((op === 'pantry.add' || op === 'pantry.update' || op === 'pantry.restore')
      && Object.prototype.hasOwnProperty.call(normalized, 'item')) {
    const item = normalizePantryEntry(normalized.item);
    if (item) normalized.item = item;
  }
  return normalized;
}

/** Decide whether retrying the same absolute mutation over newer authority is still safe. */
export function workspaceMutationRebaseDecision(request, authority) {
  if (request.op === 'pantry.remove' && request.payload?.id) {
    const target = authority.pantry.find((entry) => entry.id === request.payload.id);
    const expected = String(request.payload.expectedFingerprint || '');
    return target && expected && pantryRecordFingerprint(target) === expected
      ? { safe: true, code: '' }
      : { safe: false, code: 'pantry_record_conflict' };
  }
  if (request.op === 'pantry.restore') {
    if (request.payload?.expectedAbsent !== true) return { safe: false, code: 'pantry_restore_conflict' };
    try {
      const result = restorePantryRecord(authority.pantry, request.payload.item);
      return result.restored
        ? { safe: true, code: '' }
        : { safe: false, code: 'pantry_restore_conflict' };
    } catch {
      return { safe: false, code: 'pantry_restore_conflict' };
    }
  }
  return { safe: SAFE_REBASE.has(request.op), code: '' };
}

function pruneTransferMarkers(workspace) {
  const valid = new Set([
    ...aggregateCart(workspace.cart).map((item) => item.name),
    ...workspace.manualItems.map((item) => `manual:${item.id}`),
  ]);
  Object.keys(workspace.shoppingChecked).forEach((key) => {
    if (key.startsWith(TRANSFER_PREFIX) && !valid.has(key.slice(TRANSFER_PREFIX.length))) {
      delete workspace.shoppingChecked[key];
    }
  });
}

export function normalizeWorkspace(value) {
  const workspace = clone(value);
  workspace.plan = workspace.plan.map((entry) => ({
    ...entry,
    slot: PLAN_SLOTS.has(entry?.slot) ? entry.slot : 'dinner',
  })).sort((a, b) => a.date.localeCompare(b.date)
    || slotOrder[a.slot] - slotOrder[b.slot]
    || a.id.localeCompare(b.id));
  workspace.pantry = normalizePantry(workspace.pantry, { updatedAt: Number(workspace.updatedAt) || 0 });
  workspace.manualItems = workspace.manualItems.flatMap((item) => {
    const normalized = normalizePantryEntry(item);
    return item?.id && normalized
      ? [{ ...normalized, id: String(item.id), checked: item.checked === true }]
      : [];
  });
  return workspace;
}

export function isWorkspace(value) {
  return typeof value?.householdId === 'string'
    && Number.isInteger(value.revision) && value.revision >= 0
    && Array.isArray(value.plan) && Array.isArray(value.cart) && Array.isArray(value.pantry)
    && value.shoppingChecked && typeof value.shoppingChecked === 'object' && !Array.isArray(value.shoppingChecked)
    && Array.isArray(value.manualItems) && Array.isArray(value.recentMutations);
}

export function applyWorkspaceOperation(source, request) {
  const workspace = normalizeWorkspace(source);
  const payload = normalizeWorkspaceMutationPayload(request.op, request.payload);
  switch (request.op) {
    case 'plan.upsert': {
      const entry = clone(payload);
      entry.slot = PLAN_SLOTS.has(entry.slot) ? entry.slot : 'dinner';
      const index = workspace.plan.findIndex((item) => item.id === entry.id);
      if (index >= 0) workspace.plan[index] = entry;
      else workspace.plan.push(entry);
      workspace.plan.sort((a, b) => a.date.localeCompare(b.date)
        || slotOrder[a.slot] - slotOrder[b.slot]
        || a.id.localeCompare(b.id));
      break;
    }
    case 'plan.remove':
      workspace.plan = workspace.plan.filter((entry) => entry.id !== payload.id);
      break;
    case 'pantry.add': {
      const marker = payload.sourceKey ? `${TRANSFER_PREFIX}${payload.sourceKey}` : '';
      if (marker && workspace.shoppingChecked[marker] === true) break;
      const result = addToPantry(workspace.pantry, payload.item || payload.name, {
        updatedAt: request.createdAt,
        overrideUpdatedAt: true,
      });
      if (!result.item) throw new Error('invalid_pantry_item');
      workspace.pantry = result.pantry;
      if (marker) workspace.shoppingChecked[marker] = true;
      break;
    }
    case 'pantry.update': {
      if (!payload.id) throw new Error('invalid_pantry_record_id');
      workspace.pantry = updatePantryRecord(
        workspace.pantry,
        payload.id,
        payload.item,
        { updatedAt: request.createdAt },
      );
      break;
    }
    case 'pantry.remove': {
      if (payload.id) {
        const target = workspace.pantry.find((entry) => entry.id === payload.id);
        if (!payload.expectedFingerprint) throw new Error('invalid_pantry_remove');
        if (!target || pantryRecordFingerprint(target) !== payload.expectedFingerprint) {
          throw new Error('pantry_record_conflict');
        }
        workspace.pantry = removeFromPantry(workspace.pantry, { id: payload.id });
        break;
      }
      const name = canonicalName(payload.name);
      const identity = payload.unit ? { name, unit: payload.unit } : name;
      if (payload.unit && Object.prototype.hasOwnProperty.call(payload, 'countLabel')) {
        identity.countLabel = payload.countLabel;
      }
      workspace.pantry = removeFromPantry(workspace.pantry, identity);
      break;
    }
    case 'pantry.restore': {
      if (payload.expectedAbsent !== true) throw new Error('invalid_pantry_restore');
      const restored = restorePantryRecord(workspace.pantry, payload.item);
      if (!restored.restored) throw new Error('pantry_restore_conflict');
      workspace.pantry = restored.pantry;
      break;
    }
    case 'cart.upsertSelection': {
      const selection = clone(payload.selection);
      const index = workspace.cart.findIndex((item) => item.recipeId === selection.recipeId);
      if (index >= 0) workspace.cart[index] = selection;
      else workspace.cart.push(selection);
      pruneTransferMarkers(workspace);
      break;
    }
    case 'cart.setTargetServings':
      workspace.cart = setTargetServings(workspace.cart, payload.recipeId, payload.targetServings);
      break;
    case 'cart.removeSelection':
      workspace.cart = removeRecipeSelection(workspace.cart, payload.recipeId);
      pruneTransferMarkers(workspace);
      break;
    case 'shopping.removeIngredient':
      workspace.cart = removeShoppingItem(workspace.cart, payload.name);
      delete workspace.shoppingChecked[canonicalName(payload.name)];
      pruneTransferMarkers(workspace);
      break;
    case 'shopping.setChecked':
      if (payload.checked === true) workspace.shoppingChecked[payload.key] = true;
      else delete workspace.shoppingChecked[payload.key];
      break;
    case 'shopping.addManual': {
      const normalized = normalizePantryEntry(payload);
      if (!payload.id || !normalized) break;
      const item = { ...normalized, id: payload.id, checked: payload.checked === true };
      const index = workspace.manualItems.findIndex((current) => current.id === item.id);
      if (index >= 0) workspace.manualItems[index] = item;
      else workspace.manualItems.push(item);
      break;
    }
    case 'shopping.removeManual':
      workspace.manualItems = workspace.manualItems.filter((item) => item.id !== payload.id);
      delete workspace.shoppingChecked[`manual:${payload.id}`];
      pruneTransferMarkers(workspace);
      break;
    case 'shopping.clear':
      workspace.cart = [];
      workspace.shoppingChecked = {};
      workspace.manualItems = [];
      break;
    case 'shopping.regeneratePlanRange':
      if (Array.isArray(payload.optimisticCart)) workspace.cart = clone(payload.optimisticCart);
      pruneTransferMarkers(workspace);
      break;
    default:
      break;
  }
  return workspace;
}

export function createWorkspaceSync({ initial, send, onChange = () => {}, onError = () => {}, makeId = id }) {
  if (!isWorkspace(initial)) throw new Error('invalid_workspace');
  let confirmed = normalizeWorkspace(initial);
  let optimistic = normalizeWorkspace(initial);
  let chain = Promise.resolve();
  const pending = [];

  const publish = (meta) => onChange(clone(optimistic), meta);
  const rebuild = () => {
    let next = clone(confirmed);
    const invalid = [];
    for (const request of pending) {
      if (request.cancelledCode) continue;
      try { next = applyWorkspaceOperation(next, request); }
      catch (error) { invalid.push({ request, error }); }
    }
    optimistic = next;
    return invalid;
  };
  const conflictCode = (error) => (
    ['pantry_record_conflict', 'pantry_restore_conflict'].includes(error?.message)
      ? error.message : 'invalid_mutation'
  );
  const reconcilePending = () => {
    const invalid = rebuild();
    for (const { request, error } of invalid) request.cancelledCode = conflictCode(error);
    if (invalid.length) rebuild();
    return invalid;
  };

  async function execute(request) {
    if (request.cancelledCode) {
      const index = pending.indexOf(request);
      if (index >= 0) pending.splice(index, 1);
      rebuild();
      publish({ optimistic: false, rolledBack: true });
      onError({
        code: request.cancelledCode,
        retry: () => enqueue({ ...request, cancelledCode: '' }),
      });
      return false;
    }
    let responseConflictCode = '';
    let response = await send({ ...request, baseRevision: confirmed.revision });
    if (!response.ok && response.status === 409 && isWorkspace(response.workspace)) {
      confirmed = normalizeWorkspace(response.workspace);
      const decision = workspaceMutationRebaseDecision(request, confirmed);
      responseConflictCode = decision.code;
      if (decision.safe) {
        rebuild();
        publish({ optimistic: true, rebased: true });
        response = await send({ ...request, baseRevision: confirmed.revision });
      }
    }
    const index = pending.indexOf(request);
    if (response.ok && isWorkspace(response.workspace)) {
      if (response.workspace.revision < confirmed.revision) {
        response = { ok: false, status: 409, stale: true };
      } else {
        confirmed = normalizeWorkspace(response.workspace);
      }
    }
    if (response.ok && isWorkspace(response.workspace)) {
      if (index >= 0) pending.splice(index, 1);
      reconcilePending();
      publish({ optimistic: false });
      return true;
    }
    if (index >= 0) pending.splice(index, 1);
    reconcilePending();
    publish({ optimistic: false, rolledBack: true });
    onError({
      code: response.stale ? 'stale_workspace_response'
        : responseConflictCode || (response.status === 409 ? 'revision_conflict' : 'workspace_unavailable'),
      retry: () => enqueue(request),
    });
    return false;
  }

  function enqueue(request) {
    const inserted = !pending.includes(request);
    if (inserted && request.op === 'pantry.restore' && request.payload?.expectedAbsent === true) {
      const dependency = [...pending].reverse().find((item) => item.op === 'pantry.remove'
        && item.payload?.id === request.payload.item?.id);
      if (dependency) request.undoOf = dependency.mutationId;
    }
    if (inserted) pending.push(request);
    const invalid = rebuild();
    const ownFailure = invalid.find((item) => item.request === request);
    if (ownFailure) {
      if (inserted) pending.splice(pending.indexOf(request), 1);
      rebuild();
      throw ownFailure.error;
    }
    publish({ optimistic: true });
    const result = chain.then(() => execute(request));
    chain = result.catch(() => false);
    return result;
  }

  return {
    current: () => clone(optimistic),
    replace(value) {
      if (!isWorkspace(value) || value.revision < confirmed.revision) return false;
      confirmed = normalizeWorkspace(value);
      reconcilePending();
      publish({ optimistic: pending.length > 0 });
      return true;
    },
    mutate(op, payload) {
      return enqueue({
        mutationId: makeId(), op,
        payload: normalizeWorkspaceMutationPayload(op, payload),
        createdAt: Date.now(),
      });
    },
  };
}
