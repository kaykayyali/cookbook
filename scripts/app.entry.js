// scripts/app.entry.js — bundled into docs/js/bundle.js by scripts/build.js.
// Imports every controller init the bootstrap uses; build.test.js greps this
// file for the names to enforce the contract.

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

import '../docs/js/app.js';

// Re-export so esbuild keeps the names visible (test contract).
export { initPanels, initRecipes, initPantry, initCart, initDetail, initDrawer, initExtract, initSettings, initFab, initSearch };
