import { fetchRecipes, sendRecipeMutation } from './api.js';
import { createRecipeOutbox } from './recipe-outbox.js';
import { createSyncStatusPresenter } from './sync-status.js';
import { publishRecipeAuthority } from './recipe-authority.js';

const AUTHORITY_POLL_MS = 15_000;
const CHANNEL_PREFIX = 'cookbook-recipe-authority';

export async function initRecipeRuntime({
  state, repo, authSub, onChange = () => {}, onUnauthorized,
  document = globalThis.document, window = globalThis.window,
  send = sendRecipeMutation,
  refreshAuthority = (options) => fetchRecipes(options),
  schedule = globalThis.setInterval,
  clearSchedule = globalThis.clearInterval,
  BroadcastChannel = window?.BroadcastChannel,
} = {}) {
  const householdId = state.household?.household?.id;
  if (!repo || !authSub || !householdId) return null;
  const banner = document?.getElementById?.('recipe-sync-status');
  let failedSequence = null;
  let destroyed = false;
  let refreshing = null;
  let refreshGeneration = 0;
  let refreshQueued = false;
  let channel = null;
  const statusPresenter = createSyncStatusPresenter({
    banner,
    messageSelector: '[data-recipe-sync-message]',
    retrySelector: '[data-action="retry-recipe-sync"]',
    discardSelector: '[data-action="discard-recipe-sync"]',
    noun: 'recipe change',
  });
  const manager = createRecipeOutbox({
    repo, authSub, householdId, initial: state.recipes, send,
    isOnline: () => window?.navigator?.onLine !== false,
    onChange: (recipes, meta) => {
      publishRecipeAuthority(state, recipes);
      onChange(recipes, meta);
    },
    onAccepted: () => {
      try { channel?.postMessage({ type: 'recipe-authority-changed' }); } catch { /* advisory signal only */ }
    },
    onStatus: ({ status, pending, sequence, discardable }) => {
      failedSequence = sequence || null;
      statusPresenter.update({ status, pending, sequence, discardable });
    },
  });
  await manager.init();

  function refreshNow() {
    if (destroyed) return Promise.resolve(false);
    if (!refreshing) {
      const mutationVersion = manager.version();
      const generation = refreshGeneration;
      refreshing = Promise.resolve()
        .then(() => refreshAuthority({ onUnauthorized }))
        .then((result) => {
          if (destroyed || generation !== refreshGeneration
              || !result?.ok || !Array.isArray(result.recipes)) return false;
          return manager.setAuthority(result.recipes, { mutationVersion });
        })
        .catch(() => false)
        .finally(() => {
          refreshing = null;
          if (refreshQueued && !destroyed) {
            refreshQueued = false;
            void refreshNow();
          }
        });
    }
    return refreshing;
  }

  function requestRefresh() {
    if (destroyed) return Promise.resolve(false);
    refreshGeneration += 1;
    if (refreshing) refreshQueued = true;
    return refreshNow();
  }

  const retryButton = banner?.querySelector('[data-action="retry-recipe-sync"]');
  const discardButton = banner?.querySelector('[data-action="discard-recipe-sync"]');
  const onRetry = () => { if (failedSequence) void manager.retry(failedSequence); };
  const onDiscard = () => { if (failedSequence) void manager.discard(failedSequence); };
  retryButton?.addEventListener('click', onRetry);
  discardButton?.addEventListener('click', onDiscard);

  const onOnline = () => {
    void manager.drain().then(requestRefresh, requestRefresh);
  };
  const onVisible = () => {
    if (!document?.hidden && window?.navigator?.onLine !== false) void requestRefresh();
  };
  const onFocus = () => {
    if (window?.navigator?.onLine !== false) void requestRefresh();
  };
  window?.addEventListener?.('online', onOnline);
  window?.addEventListener?.('focus', onFocus);
  document?.addEventListener?.('visibilitychange', onVisible);

  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(`${CHANNEL_PREFIX}:${householdId}`);
      channel.addEventListener?.('message', onVisible);
    } catch { channel = null; }
  }
  const poller = schedule?.(() => {
    if (!document?.hidden && window?.navigator?.onLine !== false) void requestRefresh();
  }, AUTHORITY_POLL_MS);
  poller?.unref?.();
  if (window?.navigator?.onLine !== false) void manager.drain();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window?.removeEventListener?.('online', onOnline);
    window?.removeEventListener?.('focus', onFocus);
    document?.removeEventListener?.('visibilitychange', onVisible);
    retryButton?.removeEventListener?.('click', onRetry);
    discardButton?.removeEventListener?.('click', onDiscard);
    channel?.removeEventListener?.('message', onVisible);
    try { channel?.close?.(); } catch { /* cleanup is best effort */ }
    if (poller != null) clearSchedule?.(poller);
  }

  return Object.assign(manager, {
    refresh: refreshNow,
    refreshNow,
    destroy,
  });
}
