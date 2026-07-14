import { sendRecipeMutation } from './api.js';
import { createRecipeOutbox } from './recipe-outbox.js';

export async function initRecipeRuntime({
  state, repo, authSub, onChange = () => {}, document = globalThis.document,
  window = globalThis.window, send = sendRecipeMutation,
} = {}) {
  const householdId = state.household?.household?.id;
  if (!repo || !authSub || !householdId) return null;
  const banner = document?.getElementById?.('recipe-sync-status');
  let failedSequence = null;
  const manager = createRecipeOutbox({
    repo, authSub, householdId, initial: state.recipes, send,
    onChange: (recipes, meta) => { state.recipes = recipes; onChange(recipes, meta); },
    onStatus: ({ status, pending, sequence }) => {
      failedSequence = sequence || null;
      if (!banner) return;
      banner.hidden = status === 'synced' && pending === 0;
      const message = banner.querySelector('[data-recipe-sync-message]');
      if (message) message.textContent = status === 'blocked'
        ? `A saved recipe change needs attention (${pending} pending).`
        : status === 'offline' ? `Offline — ${pending} saved recipe change${pending === 1 ? '' : 's'} waiting.`
          : `Syncing ${pending} recipe change${pending === 1 ? '' : 's'}…`;
      banner.querySelector('[data-action="retry-recipe-sync"]')?.toggleAttribute('hidden', status !== 'blocked');
      banner.querySelector('[data-action="discard-recipe-sync"]')?.toggleAttribute('hidden', status !== 'blocked');
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
  return manager;
}
