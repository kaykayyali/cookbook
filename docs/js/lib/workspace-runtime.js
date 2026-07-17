import { fetchWorkspace, mutateWorkspace } from './api.js';
import { createWorkspaceSync } from './workspace-sync.js';
import { createWorkspaceOutbox } from './workspace-outbox.js';
import { createSyncStatusPresenter } from './sync-status.js';

function snapshot(state) {
  return {
    householdId: state.household?.household?.id || 'our-home',
    revision: state.workspaceRevision,
    plan: state.plan,
    cart: state.cart,
    pantry: state.pantry,
    shoppingChecked: state.shoppingChecked,
    manualItems: state.manualItems,
    recentMutations: [],
    updatedAt: 0,
  };
}

function applyToState(state, workspace) {
  if (workspace.revision < state.workspaceRevision) return false;
  state.workspaceRevision = workspace.revision;
  state.plan = workspace.plan;
  state.cart = workspace.cart;
  state.pantry = workspace.pantry;
  state.shoppingChecked = workspace.shoppingChecked;
  state.manualItems = workspace.manualItems;
  state.workspaceLoaded = true;
  return true;
}

export function initWorkspaceRuntime({
  state,
  onChange = () => {},
  onUnauthorized,
  document = globalThis.document,
  send = (mutation) => mutateWorkspace(mutation, { onUnauthorized }),
  fetch: fetchAuthority = (options) => fetchWorkspace(options),
  schedule = globalThis.setInterval,
  repo,
  authSub,
  window = globalThis.window,
}) {
  if (repo && authSub) return initDurableRuntime({
    state, onChange, onUnauthorized, document, send, fetchAuthority, schedule, repo, authSub, window,
  });
  const banner = document?.getElementById('workspace-status');
  let retry = null;
  const hideError = () => {
    retry = null;
    if (banner) banner.hidden = true;
  };
  const sync = createWorkspaceSync({
    initial: snapshot(state),
    send,
    onChange: (workspace, meta) => {
      applyToState(state, workspace);
      if (!meta.optimistic) hideError();
      onChange(workspace, meta);
    },
    onError: (error) => {
      retry = error.retry;
      if (banner) banner.hidden = false;
    },
  });
  banner?.querySelector('[data-action="retry-workspace"]')?.addEventListener('click', () => {
    if (retry) void retry();
  });
  let refreshing = null;
  function refresh() {
    if (!refreshing) refreshing = fetchAuthority({ onUnauthorized })
      .then((result) => result.ok && result.workspace ? sync.replace(result.workspace) : false)
      .catch(() => false)
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  const poller = schedule(() => { if (!document?.hidden) void refresh(); }, 15_000);
  poller?.unref?.();
  document?.addEventListener?.('visibilitychange', () => { if (!document.hidden) void refresh(); });
  return { mutate: sync.mutate, current: sync.current, replace: sync.replace, refresh };
}

async function initDurableRuntime({
  state, onChange, onUnauthorized, document, send, fetchAuthority, schedule, repo, authSub, window,
}) {
  const banner = document?.getElementById('sync-status');
  let failedSequence = null;
  const statusPresenter = createSyncStatusPresenter({
    banner,
    messageSelector: '[data-sync-message]',
    retrySelector: '[data-action="retry-sync"]',
    discardSelector: '[data-action="discard-sync"]',
    noun: 'change',
  });
  const renderStatus = ({ state: status, pending, sequence, discardable }) => {
    failedSequence = sequence || null;
    statusPresenter.update({ status, pending, sequence, discardable });
  };
  const manager = await createWorkspaceOutbox({
    repo,
    authSub,
    householdId: state.household?.household?.id || 'our-home',
    initial: snapshot(state),
    send,
    onChange: (workspace, meta) => {
      applyToState(state, workspace);
      onChange(workspace, meta);
    },
    onStatus: renderStatus,
  });
  applyToState(state, manager.current());
  banner?.querySelector('[data-action="retry-sync"]')?.addEventListener('click', () => {
    if (failedSequence) void manager.retry(failedSequence);
  });
  banner?.querySelector('[data-action="discard-sync"]')?.addEventListener('click', () => {
    if (failedSequence) void manager.discard(failedSequence);
  });
  let refreshing = null;
  function refresh() {
    if (!refreshing) refreshing = fetchAuthority({ onUnauthorized })
      .then(async (result) => {
        if (!result.ok || !result.workspace) return false;
        const replaced = await manager.refresh(result.workspace);
        if (replaced) void manager.drain();
        return replaced;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  const poller = schedule(() => { if (!document?.hidden) void refresh(); }, 15_000);
  poller?.unref?.();
  document?.addEventListener?.('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window?.addEventListener?.('online', () => { void manager.drain(); });
  return { mutate: manager.mutate, current: manager.current, refresh, drain: manager.drain };
}
