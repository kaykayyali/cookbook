// ════════════════════════════════════════════════════════
// app.js — orchestration: wires pure logic + controllers to the DOM
// ════════════════════════════════════════════════════════

import { $ } from './lib/dom.js';
import { state, init } from './lib/store.js';
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
import { showRecipeSchema, wireSchemaModal, exportRecipesToFile } from './lib/schema-modal.js';

init();
const panels = initPanels({ state });
const drawer = initDrawer({ state, onSchema: showRecipeSchema });
const detail = initDetail({ state, onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema });
initRecipes({ state, onOpenDetail: (id) => detail.open(id), onEdit: (id) => drawer.open(id), onSchema: showRecipeSchema });
initPantry({ state });
initCart({ state });
const extract = initExtract({ state, openPrefilled: (r) => drawer.openPrefilled(r) });
initSettings({ state, exportRecipes: () => exportRecipesToFile(state), panels });
initFab({ state, openDrawer: (id) => drawer.open(id), extract, showPanel: panels.showPanel });
initSearch({ state });
wireSchemaModal();

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('schema-overlay')?.classList.contains('open')) $('schema-overlay').classList.remove('open');
  else if ($('url-overlay')?.classList.contains('open')) extract.close();
  else if ($('recipe-drawer')?.classList.contains('open')) drawer.close();
  else if ($('detail-modal')?.classList.contains('open')) detail.close();
});

panels.showPanel('recipes');
