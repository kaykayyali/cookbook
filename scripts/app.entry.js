// scripts/app.entry.js — bundled into docs/js/bundle.js by scripts/build.js.
// Replaces the inline <script type=module src=./js/app.js> in index.html
// once the controller split (Phase 2) is done. Until then, this file only
// exists so the build pipeline has something to bundle.

import { state, init } from '../docs/js/lib/store.js';
import { initPanels } from '../docs/js/controllers/panels.js';
import { initRecipes } from '../docs/js/controllers/recipes.js';
import { initPantry } from '../docs/js/controllers/pantry.js';
import { initCart } from '../docs/js/controllers/cart.js';
import { initDetail } from '../docs/js/controllers/detail.js';
import { initDrawer } from '../docs/js/controllers/drawer.js';
import { initExtract } from '../docs/js/controllers/extract.js';
import { initSettings } from '../docs/js/controllers/settings.js';
import { initFab } from '../docs/js/controllers/fab.js';
import { initSearch } from '../docs/js/controllers/search.js';

init();
initPanels({ state });
initRecipes({ state });
initPantry({ state });
initCart({ state });
initDetail({ state });
initDrawer({ state });
initExtract({ state });
initSettings({ state });
initFab({ state });
initSearch({ state });
