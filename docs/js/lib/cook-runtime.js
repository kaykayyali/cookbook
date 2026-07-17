import {
  correctCookHistory, deleteCookHistory, markCooked, saveCookReaction,
} from './api.js';
import { createCookOutbox } from './cook-outbox.js';
import { createSyncStatusPresenter } from './sync-status.js';

export async function sendCookMutation({ op, payload }) {
  if (op === 'cook.record') return markCooked(payload.request);
  if (op === 'cook.react') return saveCookReaction(payload.eventId, payload.reaction);
  if (op === 'cook.correct') return correctCookHistory(payload.change);
  if (op === 'cook.delete') return deleteCookHistory(payload.eventId, payload.eventRevision);
  return { ok: false, status: 400, error: 'unknown_cook_mutation' };
}

export async function initCookRuntime({
  state,
  repo,
  authSub,
  onChange = () => {},
  refreshWorkspace = async () => {},
  document = globalThis.document,
  window = globalThis.window,
  send = sendCookMutation,
} = {}) {
  const householdId = state.household?.household?.id;
  if (!repo || !authSub || !householdId) return null;
  const banner = document?.getElementById?.('cook-sync-status');
  let failedSequence = null;
  const statusPresenter = createSyncStatusPresenter({
    banner,
    messageSelector: '[data-cook-sync-message]',
    retrySelector: '[data-action="retry-cook-sync"]',
    discardSelector: '[data-action="discard-cook-sync"]',
    noun: 'cooking change',
  });
  const manager = createCookOutbox({
    repo,
    authSub,
    householdId,
    initial: { events: state.cookEvents || [], reactions: state.cookReactions || [] },
    send,
    onChange: (history, meta) => {
      state.cookEvents = history.events;
      state.cookReactions = history.reactions;
      const cookedPlanIds = new Set(history.events.filter((event) => !event.deletedAt && event.planEntryId).map((event) => event.planEntryId));
      const restoredPlanStatuses = new Map(manager.pending()
        .filter((row) => row.op === 'cook.delete' && row.payload?.event?.planEntryId)
        .map((row) => [row.payload.event.planEntryId, row.payload.event.priorPlanStatus || 'active']));
      state.plan = (state.plan || []).map((entry) => cookedPlanIds.has(entry.id)
        ? { ...entry, status: 'cooked' }
        : restoredPlanStatuses.has(entry.id) ? { ...entry, status: restoredPlanStatuses.get(entry.id) } : entry);
      onChange(history, meta);
    },
    onStatus: ({ status, pending, sequence, discardable }) => {
      failedSequence = sequence || null;
      statusPresenter.update({ status, pending, sequence, discardable });
    },
    onAcknowledged: (row) => {
      if (row.op === 'cook.record' || row.op === 'cook.delete') void refreshWorkspace();
    },
  });
  await manager.init();
  banner?.querySelector('[data-action="retry-cook-sync"]')?.addEventListener('click', () => {
    if (failedSequence) void manager.retry(failedSequence);
  });
  banner?.querySelector('[data-action="discard-cook-sync"]')?.addEventListener('click', () => {
    if (failedSequence) void manager.discard(failedSequence);
  });
  window?.addEventListener?.('online', () => { void manager.drain(); });
  if (window?.navigator?.onLine !== false) void manager.drain();
  return manager;
}
