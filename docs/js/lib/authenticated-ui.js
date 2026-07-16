import { $ } from './dom.js';
import { initPanels } from '../controllers/panels.js';
import { initRecipes } from '../controllers/recipes.js';
import { initPantry } from '../controllers/pantry.js';
import { initCart } from '../controllers/cart.js';
import { initDetail } from '../controllers/detail.js';
import { initDrawer } from '../controllers/drawer.js';
import { initExtract } from '../controllers/extract.js';
import { initSettings } from '../controllers/settings.js';
import { initFab } from '../controllers/fab.js';
import { initSearch } from '../controllers/search.js';
import { initWeek } from '../controllers/week.js';
import { initEngagement } from '../controllers/engagement.js';
import { initReminders } from '../controllers/reminders.js';
import { initImageCapture } from '../controllers/image-capture.js';
import { initCookingMode } from '../controllers/cooking-mode.js';
import { initTour } from '../controllers/tour.js';
import { patchImportDraft } from './api.js';
import { createCookbookTour } from './cookbook-tour.js';
import { showRecipeSchema, wireSchemaModal, exportRecipesToFile } from './schema-modal.js';

export function wireAuthenticatedUi({ state, runtime, recipeRuntime = null, onSignedIn, onSignedOut }) {
  const panels = initPanels({ state });
  const tour = initTour({
    tours: [createCookbookTour()], subject: state.auth?.sub,
    navigate: panels.showPanel, getCurrentPanel: panels._current,
  });
  let detail;
  const reminders = initReminders();
  const engagement = initEngagement({
    state, refreshWorkspace: runtime.refresh, onOpenRecipe: (id) => detail?.open(id),
    onCooked: reminders.notifyPostCook,
  });
  const week = initWeek({ state, mutate: runtime.mutate, onMarkCooked: engagement.markPlan });
  const cookingMode = initCookingMode({ state });
  const drawer = initDrawer({ state, mutateRecipe: recipeRuntime?.mutate, onSchema: showRecipeSchema, onSaved: () => panels.renderActive() });
  const imageCapture = initImageCapture({
    state,
    onDraftCreated: (draft) => drawer.openPrefilled(
      draft.recipe || draft.extracted?.recipe || { name: 'Untitled image draft', recipeIngredient: [], recipeInstructions: [] },
      { uncertainFields: draft.confidence?.uncertainFields || [], onSave: async (recipe) => {
        let result = await patchImportDraft(draft.id, 'confirm', { recipe });
        if (!result.ok && result.error === 'duplicate_confirmation_required'
            && globalThis.confirm?.('A recipe with this name already exists. Publish this reviewed draft anyway?')) {
          result = await patchImportDraft(draft.id, 'confirm', { recipe, allowDuplicate: true });
        }
        if (result.ok) setTimeout(() => globalThis.location?.reload?.(), 0);
        return result;
      } },
    ),
  });
  detail = initDetail({
    state, mutate: runtime.mutate, onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema,
    onChange: () => recipes.render(), getHistory: engagement.history,
    getReactions: () => state.cookReactions || [], onMarkCooked: engagement.markRecipe,
    onCookMode: cookingMode.open,
    onReact: engagement.react, onCorrectHistory: engagement.correct, onDeleteHistory: engagement.remove,
  });
  const recipes = initRecipes({
    state, onOpenDetail: (id) => detail.open(id), onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema,
    offlineMutations: Boolean(recipeRuntime),
    removeRecipe: recipeRuntime ? async (id) => ({ ok: await recipeRuntime.mutate('recipe.delete', { id }) }) : undefined,
  });
  const pantry = initPantry({ state, mutate: runtime.mutate });
  const cart = initCart({ state, mutate: runtime.mutate });
  const extract = initExtract({ state, openPrefilled: (recipe) => drawer.openPrefilled(recipe) });
  const settings = initSettings({ state, exportRecipes: () => exportRecipesToFile(state), onSignedIn, onSignedOut });
  panels.register('week', week.render);
  panels.register('recipes', recipes.render);
  panels.register('pantry', pantry.render);
  panels.register('cart', cart.render);
  panels.register('settings', () => { settings.renderSettings(); settings.renderAuth(); });
  settings.renderAuth();
  $('settings-tour-btn')?.addEventListener('click', () => tour.start('cookbook'));
  initFab({ state, openDrawer: (id) => drawer.open(id), extract, imageCapture, showPanel: panels.showPanel });
  initSearch({ state, onChange: () => recipes.render() });
  wireSchemaModal();
  reminders.maybeWeeklyPlanReminder(state.plan);
  void engagement.load();
  globalThis.window?.addEventListener?.('online', () => { void engagement.load(); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('schema-overlay')?.classList.contains('open')) $('schema-overlay').classList.remove('open');
    else if ($('url-overlay')?.classList.contains('open')) extract.close();
    else if ($('recipe-drawer')?.classList.contains('open')) drawer.close();
    else if ($('detail-modal')?.classList.contains('open')) detail.close();
  });
  panels.restore();
  detail.restore();
  tour.maybeStart('cookbook');
  return {
    renderShared: () => { week.render(); pantry.render(); cart.render(); engagement.render(); },
    renderActive: panels.renderActive,
  };
}
