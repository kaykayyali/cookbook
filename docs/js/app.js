// ════════════════════════════════════════════════════════
// app.js — orchestration: wires pure logic + components to the DOM
// ════════════════════════════════════════════════════════

import { $, els, toast } from './lib/dom.js';
import { esc, pluralize } from './lib/format.js';
import { toSchema, parseImport } from './lib/schema.js';
import {
  allRecipeIngredients,
  togglePantry,
  addToPantry,
  removeFromPantry,
} from './lib/pantry.js';
import { filterRecipes } from './lib/filters.js';
import { addToCart, markBought, clearCart } from './lib/cart.js';
import { loadAuth, initGoogleSignIn, clearAuth, authFetch, getToken } from './lib/auth.js';
import { cartGroupsHTML, emptyCartHTML } from './components/cart.js';
import { state, save, init } from './lib/store.js';
import { recipeCardHTML, emptyStateHTML } from './components/recipeCard.js';
import {
  ingredientListHTML,
  pantryNoteHTML,
  metaRowHTML,
  stepsHTML,
  nutritionHTML,
} from './components/recipeDetail.js';
import {
  FIELD_MAP,
  NUTRI_MAP,
  formBuffers,
  rebuildIngEditor,
  rebuildStepsList,
  collectForm,
  validateRecipe,
} from './components/recipeForm.js';

// ── Rendering ──────────────────────────────────────────────
function populatePantryAutocomplete() {
  const dl = $('pantry-suggestions');
  if (!dl) return;
  const current = new Set(state.pantry);
  dl.innerHTML = allRecipeIngredients(state.recipes)
    .filter((name) => !current.has(name))
    .map((name) => `<option value="${esc(name)}">`)
    .join('');
}

function renderRecipes() {
  populatePantryAutocomplete();
  const list = filterRecipes(state.recipes, {
    searchTerm: state.searchTerm,
    categoryFilter: state.categoryFilter,
    eligibleOnly: state.eligibleOnly,
    pantry: state.pantry,
  });
  const total = state.recipes.length;
  $('recipe-count').textContent =
    list.length === total
      ? pluralize(total, 'recipe')
      : `${list.length} of ${pluralize(total, 'recipe')}`;

  $('recipe-grid').innerHTML = list.length
    ? list.map((r) => recipeCardHTML(r, state.pantry)).join('')
    : emptyStateHTML(total > 0);
}

function renderPantry() {
  populatePantryAutocomplete();
  const grid = $('pantry-grid');
  if (!state.pantry.length) {
    grid.innerHTML =
      '<p style="color:var(--ink-light);font-size:.85rem">Your pantry is empty. Add ingredients above to see which recipes you can make.</p>';
    return;
  }
  grid.innerHTML = [...state.pantry]
    .sort()
    .map(
      (item) =>
        `<span class="pantry-tag">${esc(item)}
       <button class="pantry-remove" data-item="${esc(item)}" aria-label="Remove ${esc(item)}">${'<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'}</button>
     </span>`
    )
    .join('');
}

function renderCart() {
  const grid = $('cart-grid');
  if (!grid) return;
  grid.innerHTML = state.cart.length ? cartGroupsHTML(state.cart) : emptyCartHTML();
}

function renderAuth() {
  const area = $('auth-area');
  if (!area) return;
  const { token, email } = loadAuth();
  if (token) {
    area.innerHTML =
      `<div class="auth-signed-in">
         <span class="auth-email">Signed in as ${esc(email)}</span>
         <button class="auth-signout" data-action="signout">Sign out</button>
       </div>`;
  } else {
    area.innerHTML = `<div id="g-signin-btn"></div>`;
    initGoogleSignIn({
      buttonEl: $('g-signin-btn'),
      clientId: window.COOKBOOK_GOOGLE_CLIENT_ID,
      onSignedIn: (em) => { renderAuth(); toast(`Signed in as ${em}`); },
      onError: (msg) => toast(`Sign-in failed: ${msg}`),
    });
  }
}

// Delegated handler: sign-out click anywhere inside #auth-area. The signed-in
// branch re-renders the area after clearAuth(); the delegated listener keeps
// working without re-binding.
function handleAuthAreaClick(e) {
  if (!e.target.closest('[data-action="signout"]')) return;
  clearAuth().then(() => {
    renderAuth();
    toast('Signed out');
  });
}

// ── Detail sheet ───────────────────────────────────────────
function refreshDetailIngredients() {
  const r = state.recipes.find((x) => x._id === state.detailId);
  if (!r) return;
  const ings = r.recipeIngredient || [];
  $('dm-ingredients').innerHTML = ingredientListHTML(ings, state.pantry);
  const note = $('dm-pantry-note');
  const html = pantryNoteHTML(ings, state.pantry);
  note.style.display = html ? '' : 'none';
  if (html) note.innerHTML = html;
}

function openDetail(id) {
  const r = state.recipes.find((x) => x._id === id);
  if (!r) return;
  state.detailId = id;

  $('dm-eyebrow').textContent = [r.recipeCategory, r.recipeCuisine].filter(Boolean).join(' · ');
  $('dm-title').textContent = r.name;
  $('dm-meta').innerHTML = metaRowHTML(r);

  refreshDetailIngredients();
  $('dm-steps').innerHTML = stepsHTML(r.recipeInstructions);

  const nut = nutritionHTML(r.nutrition);
  const nutWrap = $('dm-nutrition');
  if (nut) {
    $('dm-nutrition-grid').innerHTML = nut;
    nutWrap.style.display = '';
  } else {
    nutWrap.style.display = 'none';
  }

  openSheet('detail');
}

function addRecipeToCart(mode) {
  const r = state.recipes.find((x) => x._id === state.detailId);
  if (!r) return;
  const ings = r.recipeIngredient || [];
  if (!ings.length) {
    toast('This recipe has no ingredients');
    return;
  }
  const { cart, addedCount } = addToCart(state.cart, r, state.pantry, mode);
  state.cart = cart;
  save();
  renderCart();
  if (mode === 'missing' && addedCount === 0) toast('Nothing missing — you have everything');
  else toast(`Added ${pluralize(addedCount, 'item')} to cart`);
}

// ── Sheets (shared open/close) ─────────────────────────────
const SHEETS = {
  detail: ['detail-modal', 'detail-overlay'],
  drawer: ['recipe-drawer', 'drawer-overlay'],
};

function openSheet(which) {
  const [panel, overlay] = SHEETS[which];
  $(panel).classList.add('open');
  $(overlay).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSheet(which) {
  const [panel, overlay] = SHEETS[which];
  $(panel).classList.remove('open');
  $(overlay).classList.remove('open');
  if (!$('detail-modal').classList.contains('open') && !$('recipe-drawer').classList.contains('open')) {
    document.body.style.overflow = '';
  }
  if (which === 'detail') state.detailId = null;
}

// ── Drawer (create/edit) ───────────────────────────────────
function fillDrawerFromRecipe(r) {
  state.editingId = (r && r._id) || null;
  $('drawer-title').textContent = state.editingId ? 'Edit Recipe' : 'New Recipe';
  $('f-id').value = state.editingId || '';
  Object.entries(FIELD_MAP).forEach(([elId, key]) => {
    $(elId).value = r ? r[key] || '' : '';
  });
  const n = (r && r.nutrition) || {};
  Object.entries(NUTRI_MAP).forEach(([elId, key]) => {
    $(elId).value = n[key] || '';
  });
  formBuffers.ingredients = r ? [...(r.recipeIngredient || [])] : [];
  formBuffers.steps = r ? [...(r.recipeInstructions || [''])] : [''];
  rebuildIngEditor();
  rebuildStepsList();
}

function openDrawer(id) {
  const r = id ? state.recipes.find((x) => x._id === id) : null;
  fillDrawerFromRecipe(r);
  openSheet('drawer');
  setTimeout(() => $('f-name').focus(), 80);
}

/** Open the drawer pre-filled with an unsaved recipe (no _id) for review. */
function openDrawerPrefilled(recipe) {
  fillDrawerFromRecipe(recipe);
  openSheet('drawer');
  setTimeout(() => $('f-name').focus(), 80);
}

function saveRecipe() {
  const r = collectForm(state);
  const err = validateRecipe(r);
  if (err) {
    toast(err);
    if (err.includes('name')) $('f-name').focus();
    return;
  }
  const idx = state.editingId ? state.recipes.findIndex((x) => x._id === state.editingId) : -1;
  if (idx > -1) state.recipes[idx] = r;
  else state.recipes.unshift(r);
  save();
  closeSheet('drawer');
  renderRecipes();
  toast(state.editingId ? 'Recipe updated' : 'Recipe saved');
}

function deleteRecipe(id) {
  if (!confirm('Delete this recipe?')) return;
  state.recipes = state.recipes.filter((r) => r._id !== id);
  save();
  renderRecipes();
  toast('Recipe deleted');
}

// ── JSON-LD modal ──────────────────────────────────────────
function showSchema(id) {
  const r = id ? state.recipes.find((x) => x._id === id) : collectForm(state);
  if (!r) return;
  $('schema-preview').textContent = JSON.stringify(toSchema(r), null, 2);
  $('schema-overlay').classList.add('open');
}

// ── Import / export ────────────────────────────────────────
function exportRecipes() {
  const data = state.recipes.map(toSchema);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: 'recipes.json' }).click();
  URL.revokeObjectURL(url);
  toast(`Exported ${pluralize(data.length, 'recipe')}`);
}

function importRecipes(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = parseImport(JSON.parse(e.target.result));
      if (!imported.length) {
        toast('No valid recipes found in file');
        return;
      }
      state.recipes = [...imported, ...state.recipes];
      save();
      renderRecipes();
      toast(`Imported ${pluralize(imported.length, 'recipe')}`);
    } catch {
      toast('Could not read file — expected JSON-LD');
    }
  };
  reader.readAsText(file);
}

// ── Import from URL ────────────────────────────────────────
function openUrlModal() {
  const signedOut = !getToken();
  $('url-signedout').style.display = signedOut ? '' : 'none';
  $('url-signedin').style.display = signedOut ? 'none' : '';
  $('url-input').value = '';
  $('url-status').textContent = '';
  $('url-overlay').classList.add('open');
}

async function extractFromUrl() {
  const url = $('url-input').value.trim();
  if (!url) return;
  $('url-status').textContent = 'Extracting…';
  $('url-extract-btn').disabled = true;
  try {
    // authFetch prepends API_BASE ('/api'), so '/extract' -> '/api/extract'.
    const res = await authFetch('/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      $('url-status').textContent = data.error || 'failed';
      if (data.partial) {
        const [recipe] = parseImport([data.partial]);
        if (recipe) {
          $('url-overlay').classList.remove('open');
          openDrawerPrefilled(recipe);
        }
      }
      return;
    }
    const [recipe] = parseImport([data.recipe]);
    if (!recipe) { $('url-status').textContent = 'no recipe found'; return; }
    $('url-overlay').classList.remove('open');
    openDrawerPrefilled(recipe);
    toast('Recipe extracted — review and save');
  } catch (e) {
    $('url-status').textContent = e.message || 'network';
  } finally {
    $('url-extract-btn').disabled = false;
  }
}

// ── Panels ─────────────────────────────────────────────────
function showPanel(id) {
  els('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${id}`));
  els('.nav-item[data-panel]').forEach((n) =>
    n.classList.toggle('active', n.dataset.panel === id)
  );
  if (id === 'pantry') {
    renderPantry();
    renderCart();
  }
}

// ── Pantry mutations ───────────────────────────────────────
function addPantryFromInput() {
  const inp = $('pantry-input');
  const { pantry, added, name } = addToPantry(state.pantry, inp.value);
  if (!name) {
    inp.focus();
    return;
  }
  if (added) {
    state.pantry = pantry;
    save();
    renderPantry();
    renderRecipes();
    toast(`Added "${name}"`);
  } else {
    toast(`"${name}" is already in your pantry`);
  }
  inp.value = '';
  inp.focus();
}

// ── Event wiring ───────────────────────────────────────────
function wire() {
  // Navigation
  els('.nav-item[data-panel]').forEach((btn) =>
    btn.addEventListener('click', () => showPanel(btn.dataset.panel))
  );
  $('nav-import').addEventListener('click', () => $('import-file').click());
  $('nav-export').addEventListener('click', exportRecipes);
  $('nav-import-url').addEventListener('click', openUrlModal);
  $('url-close-btn').addEventListener('click', () => $('url-overlay').classList.remove('open'));
  $('url-overlay').addEventListener('click', (e) => { if (e.target === $('url-overlay')) $('url-overlay').classList.remove('open'); });
  $('url-extract-btn').addEventListener('click', extractFromUrl);
  $('url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); extractFromUrl(); } });
  $('url-signin-hint-btn').addEventListener('click', openUrlModal); // reminder to sign in first

  // Auth (delegated — works across the sign-in/sign-out swap)
  $('auth-area').addEventListener('click', handleAuthAreaClick);

  // New recipe
  $('new-recipe-btn').addEventListener('click', () => openDrawer(null));
  $('fab-new').addEventListener('click', () => openDrawer(null));

  // Recipe grid (card tap + action buttons)
  $('recipe-grid').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (action) {
      e.stopPropagation();
      const { action: a, id } = action.dataset;
      if (a === 'edit') openDrawer(id);
      else if (a === 'schema') showSchema(id);
      else if (a === 'delete') deleteRecipe(id);
      return;
    }
    const card = e.target.closest('.recipe-card');
    if (card) openDetail(card.dataset.id);
  });

  // Pantry remove
  $('pantry-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.pantry-remove');
    if (!btn) return;
    state.pantry = removeFromPantry(state.pantry, btn.dataset.item);
    save();
    renderPantry();
    renderRecipes();
    toast(`Removed "${btn.dataset.item}"`);
  });

  // Shopping cart: tap a contribution to mark it bought; Clear cart empties it
  $('cart-grid').addEventListener('click', (e) => {
    const bought = e.target.closest('[data-action="bought"]');
    if (bought) {
      const { recipeId, line } = bought.dataset;
      const res = markBought(state.cart, recipeId, line, state.pantry);
      if (!res.removed) return;
      state.cart = res.cart;
      state.pantry = res.pantry;
      save();
      renderCart();
      renderPantry();
      renderRecipes();
      toast(`Bought “${res.name}” — added to pantry`);
      return;
    }
  });

  $('cart-clear-btn').addEventListener('click', () => {
    if (!state.cart.length) return;
    state.cart = clearCart();
    save();
    renderCart();
    toast('Cart cleared');
  });

  // Pantry add
  $('pantry-add-btn').addEventListener('click', addPantryFromInput);
  $('pantry-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPantryFromInput();
    }
  });

  // Search
  const searchInput = $('search-input');
  searchInput.addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    $('search-clear').classList.toggle('show', !!e.target.value);
    renderRecipes();
  });
  $('search-clear').addEventListener('click', () => {
    searchInput.value = '';
    state.searchTerm = '';
    $('search-clear').classList.remove('show');
    renderRecipes();
    searchInput.focus();
  });

  // Eligible toggle
  $('eligible-only').addEventListener('change', (e) => {
    state.eligibleOnly = e.target.checked;
    renderRecipes();
  });

  // Category chips
  $('category-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    els('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.categoryFilter = chip.dataset.cat;
    renderRecipes();
  });

  // Drawer ingredient editor
  $('ing-editor').addEventListener('input', (e) => {
    if (e.target.matches('input')) formBuffers.ingredients[+e.target.dataset.index] = e.target.value;
  });
  $('ing-editor').addEventListener('click', (e) => {
    const btn = e.target.closest('.row-remove');
    if (!btn) return;
    formBuffers.ingredients.splice(+btn.dataset.index, 1);
    rebuildIngEditor();
  });
  $('ing-add-btn').addEventListener('click', () => {
    const inp = $('ing-new-input');
    if (!inp.value.trim()) return;
    formBuffers.ingredients.push(inp.value.trim());
    inp.value = '';
    rebuildIngEditor();
    inp.focus();
  });
  $('ing-new-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('ing-add-btn').click();
    }
  });

  // Drawer steps editor
  $('steps-list').addEventListener('input', (e) => {
    if (e.target.matches('textarea')) formBuffers.steps[+e.target.dataset.index] = e.target.value;
  });
  $('steps-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.row-remove');
    if (!btn) return;
    formBuffers.steps.splice(+btn.dataset.index, 1);
    rebuildStepsList();
  });
  $('step-add-btn').addEventListener('click', () => {
    formBuffers.steps.push('');
    rebuildStepsList();
    const tas = $('steps-list').querySelectorAll('textarea');
    tas[tas.length - 1]?.focus();
  });

  // Drawer buttons
  $('drawer-close-btn').addEventListener('click', () => closeSheet('drawer'));
  $('drawer-cancel-btn').addEventListener('click', () => closeSheet('drawer'));
  $('drawer-overlay').addEventListener('click', () => closeSheet('drawer'));
  $('save-recipe-btn').addEventListener('click', saveRecipe);
  $('view-schema-btn').addEventListener('click', () => showSchema(null));

  // Detail buttons
  $('detail-close-btn').addEventListener('click', () => closeSheet('detail'));
  $('detail-overlay').addEventListener('click', () => closeSheet('detail'));
  $('dm-edit-btn').addEventListener('click', () => {
    const id = state.detailId;
    closeSheet('detail');
    openDrawer(id);
  });
  $('dm-schema-btn').addEventListener('click', () => {
    if (state.detailId) showSchema(state.detailId);
  });
  $('dm-add-missing-btn').addEventListener('click', () => addRecipeToCart('missing'));
  $('dm-add-all-btn').addEventListener('click', () => addRecipeToCart('all'));

  // Detail ingredient tap → toggle pantry
  $('dm-ingredients').addEventListener('click', (e) => {
    const item = e.target.closest('.detail-ing-item');
    if (!item || !item.dataset.ing) return;
    const { pantry, added, name } = togglePantry(state.pantry, item.dataset.ing.toLowerCase());
    state.pantry = pantry;
    save();
    refreshDetailIngredients();
    renderRecipes();
    renderPantry();
    toast(added ? `Added "${name}" to pantry` : `Removed "${name}" from pantry`);
  });

  // Schema modal
  $('schema-close-btn').addEventListener('click', () => $('schema-overlay').classList.remove('open'));
  $('schema-overlay').addEventListener('click', (e) => {
    if (e.target === $('schema-overlay')) $('schema-overlay').classList.remove('open');
  });
  $('schema-copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('schema-preview').textContent);
      toast('Copied JSON-LD');
    } catch {
      toast('Copy failed');
    }
  });

  // Import file
  $('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importRecipes(e.target.files[0]);
    e.target.value = '';
  });

  // Esc closes whatever is open
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('url-overlay').classList.contains('open')) $('url-overlay').classList.remove('open');
    else if ($('schema-overlay').classList.contains('open')) $('schema-overlay').classList.remove('open');
    else if ($('recipe-drawer').classList.contains('open')) closeSheet('drawer');
    else if ($('detail-modal').classList.contains('open')) closeSheet('detail');
  });
}

// ── Boot ───────────────────────────────────────────────────
init();
wire();
renderRecipes();
renderPantry();
renderCart();
renderAuth();
