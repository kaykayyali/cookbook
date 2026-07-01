// app.js — orchestration: wires pure logic + controllers to the DOM
import { $ } from './lib/dom.js';
import { state, init } from './lib/store.js';
import { loadAuth, getToken } from './lib/auth.js';
import { editCommunityRecipe } from './lib/community.js';
import { initPanels } from './controllers/panels.js';
import { initRecipes } from './controllers/recipes.js';
import { initPantry } from './controllers/pantry.js';
import { initCart } from './controllers/cart.js';
import { initDetail } from './controllers/detail.js';
import { initDrawer } from './controllers/drawer.js';
import { initExtract } from './controllers/extract.js';
import { initSettings } from './controllers/settings.js';
import { initFab } from './controllers/fab.js';
import { initSearch } from './controllers/search.js';
import { initCommunity } from './controllers/community.js';
import { showRecipeSchema, wireSchemaModal, exportRecipesToFile } from './lib/schema-modal.js';

// Late-binding refresh: drawer captures onCommunitySave before community exists.
let communityRefresh = async () => {};
const readSub = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch { return null; } };

init();
const panels = initPanels({ state });
const drawer = initDrawer({
  state, onSchema: showRecipeSchema, onSaved: () => panels.renderActive(),
  onCommunitySave: async (id, recipe) => {
    const res = await editCommunityRecipe(id, recipe, { onUnauthorized: () => panels.showPanel('recipes') });
    if (res.ok && panels._current() === 'community') await communityRefresh();
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  },
});
state.auth = (() => { const a = loadAuth(); return { sub: readSub(a.token), email: a.email }; })();
let community;
const detail = initDetail({ state, onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema,
  onSaveCommunityLocal: (ctx) => community.saveToLocal(ctx), onEditCommunity: (item) => drawer.openCommunityEdit(item),
  onDeleteCommunity: (ctx) => community.deleteShared(ctx), onShareCommunity: (r) => community.share(r) });
initRecipes({ state, onOpenDetail: (id) => detail.open(id), onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema });
initPantry({ state });
initCart({ state });
const extract = initExtract({ state, openPrefilled: (r) => drawer.openPrefilled(r) });
// onSignedIn refreshes state.auth.sub + loads the community feed; onSignedOut resets it.
initSettings({ state, exportRecipes: () => exportRecipesToFile(state), panels,
  onSignedIn: (email) => { state.auth = { sub: readSub(getToken()), email }; if (community) community.loadFirst(); },
  onSignedOut: () => { state.auth = { sub: null, email: '' }; } });
initFab({ state, openDrawer: (id) => drawer.open(id), extract, showPanel: panels.showPanel });
initSearch({ state });
community = initCommunity({ state, panels, onRefreshLibrary: () => panels.renderActive(),
  onOpenCommunityDetail: (item) => detail.openCommunity(item),
  onSignedOut: () => { state.auth = { sub: null, email: '' }; panels.showPanel('recipes'); } });
communityRefresh = community.refresh;
wireSchemaModal();

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('schema-overlay')?.classList.contains('open')) $('schema-overlay').classList.remove('open');
  else if ($('url-overlay')?.classList.contains('open')) extract.close();
  else if ($('recipe-drawer')?.classList.contains('open')) drawer.close();
  else if ($('detail-modal')?.classList.contains('open')) detail.close();
});

panels.showPanel('recipes');