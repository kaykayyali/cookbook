import { sendRecipeMutation } from './api.js';
import { createRecipeOutbox } from './recipe-outbox.js';
import { createSyncStatusPresenter } from './sync-status.js';

export async function initRecipeRuntime({
  state, repo, authSub, onChange = () => {}, document = globalThis.document,
  window = globalThis.window, send = sendRecipeMutation,
} = {}) {
  const householdId = state.household?.household?.id;
  if (!repo || !authSub || !householdId) return null;
  const banner = document?.getElementById?.('recipe-sync-status');
  let failedSequence = null;
  const statusPresenter = createSyncStatusPresenter({
    banner,
    messageSelector: '[data-recipe-sync-message]',
    retrySelector: '[data-action="retry-recipe-sync"]',
    discardSelector: '[data-action="discard-recipe-sync"]',
    noun: 'recipe change',
  });
  const manager = createRecipeOutbox({
    repo, authSub, householdId, initial: state.recipes, send,
    onChange: (recipes, meta) => { state.recipes = recipes; onChange(recipes, meta); },
    onStatus: ({ status, pending, sequence, discardable }) => {
      failedSequence = sequence || null;
      statusPresenter.update({ status, pending, sequence, discardable });
    },
  });
  await manager.init();
  banner?.querySelector('[data-action="retry-recipe-sync"]')?.addEventListener('click', () => {
    if (failedSequence) void manager.retry(failedSequence);
  });
  banner?.querySelector('[data-action="discard-recipe-sync"]')?.addEventListener('click', () => {
    if (failedSequence) void manager.discard(failedSequence);
  });
  window?.addEventListener?.('online', () => { void manager.drain(); });
  if (window?.navigator?.onLine !== false) void manager.drain();
  return manager;
}
