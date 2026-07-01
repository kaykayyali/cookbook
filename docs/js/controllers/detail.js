// ════════════════════════════════════════════════════════
// controllers/detail.js — recipe detail sheet open/close + render
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { save as persist } from '../lib/store.js';
import { togglePantry } from '../lib/pantry.js';
import { addToCart } from '../lib/cart.js';
import { pluralize, esc } from '../lib/format.js';
import { fromSchema } from '../lib/schema.js';
import {
  ingredientListHTML,
  pantryNoteHTML,
  metaRowHTML,
  stepsHTML,
  nutritionHTML,
} from '../components/recipeDetail.js';

/**
 * Detail modal controller.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {(id: string) => void} [deps.onEdit] - fires when user clicks "Edit"
 * @param {(id: string) => void} [deps.onSchema] - fires when user clicks "Schema"
 * @param {() => void} [deps.onChange] - fires when pantry changes via ingredient tap (re-render recipes)
 * @param {(ctx: object) => void} [deps.onSaveCommunityLocal] - "Save to my library" on a community recipe
 * @param {(item: object) => void} [deps.onEditCommunity] - author "Edit" on a community recipe
 * @param {(ctx: object) => void} [deps.onDeleteCommunity] - author "Delete" on a community recipe
 * @param {(recipe: object) => void} [deps.onShareCommunity] - "Share to Community" on a local recipe
 * @returns {{ open: (id) => void, openCommunity: (item) => void, close: () => void, _renderIngredients: () => void }}
 */
export function initDetail({
  state,
  document = globalThis.document,
  onEdit = null,
  onSchema = null,
  onChange = null,
  onSaveCommunityLocal = null,
  onEditCommunity = null,
  onDeleteCommunity = null,
  onShareCommunity = null,
}) {
  // The recipe currently shown in the detail modal (works for local + community).
  let current = null;
  // ctx = { source: 'local' | 'community', author?: {sub,name,picture}, isAuthor?: boolean, id?: string }

  function openRecipe(r, ctx = { source: 'local' }) {
    if (!r) return;
    current = { r, ctx };
    state.detailId = ctx.source === 'local' ? r._id : null;

    const eyebrow = document.getElementById('dm-eyebrow');
    if (eyebrow) eyebrow.textContent = [r.recipeCategory, r.recipeCuisine].filter(Boolean).join(' · ');
    const title = document.getElementById('dm-title');
    if (title) title.textContent = r.name;
    const meta = document.getElementById('dm-meta');
    if (meta) meta.innerHTML = metaRowHTML(r);

    // Author badge: shown only for community recipes.
    const badge = document.getElementById('dm-author-badge');
    if (badge) {
      if (ctx.source === 'community' && ctx.author) {
        const a = ctx.author;
        const avatar = a.picture
          ? `<img class="author-avatar" src="${esc(a.picture)}" alt="" width="22" height="22" referrerpolicy="no-referrer" crossorigin="anonymous">`
          : `<span class="author-avatar author-initial">${esc((a.name || '?').slice(0, 1).toUpperCase())}</span>`;
        badge.innerHTML = `${avatar}<span class="author-name">added by ${esc(a.name || 'someone')}</span>`;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    // Footer button visibility by source/ownership.
    setDisplay('dm-edit-btn', ctx.source === 'local' ? '' : 'none');
    setDisplay('dm-share-community-btn', ctx.source === 'local' ? '' : 'none');
    setDisplay('dm-schema-btn', ctx.source === 'local' ? '' : 'none');
    setDisplay('dm-save-local-btn', ctx.source === 'community' ? '' : 'none');
    setDisplay('dm-community-edit-btn', ctx.source === 'community' && ctx.isAuthor ? '' : 'none');
    setDisplay('dm-community-delete-btn', ctx.source === 'community' && ctx.isAuthor ? '' : 'none');

    renderIngredients();
    const stepsEl = document.getElementById('dm-steps');
    if (stepsEl) stepsEl.innerHTML = stepsHTML(r.recipeInstructions);
    const nut = nutritionHTML(r.nutrition);
    const nutWrap = document.getElementById('dm-nutrition');
    if (nut) {
      const grid = document.getElementById('dm-nutrition-grid');
      if (grid) grid.innerHTML = nut;
      if (nutWrap) nutWrap.style.display = '';
    } else if (nutWrap) nutWrap.style.display = 'none';

    openSheet();
  }

  function setDisplay(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  }

  function open(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return;
    openRecipe(r, { source: 'local' });
  }

  /** Open a community recipe item (read-only for non-authors; author sees Edit/Delete). */
  function openCommunity(item) {
    const internal = fromSchema(item.recipe); // canonical JSON-LD -> internal model for rendering
    internal._id = item.id; // detail render uses this as a key; not persisted
    const isAuthor = !!(state.auth && item.author && state.auth.sub === item.author.sub);
    openRecipe(internal, { source: 'community', author: item.author, isAuthor, id: item.id });
  }

  function renderIngredients() {
    const r = current && current.r;
    if (!r) return;
    const ings = r.recipeIngredient || [];
    const list = document.getElementById('dm-ingredients');
    if (list) list.innerHTML = ingredientListHTML(ings, state.pantry);
    const note = document.getElementById('dm-pantry-note');
    if (note) {
      const html = pantryNoteHTML(ings, state.pantry);
      note.style.display = html ? '' : 'none';
      if (html) note.innerHTML = html;
    }
  }

  function openSheet() {
    const modal = document.getElementById('detail-modal');
    const overlay = document.getElementById('detail-overlay');
    if (modal) modal.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    const modal = document.getElementById('detail-modal');
    const overlay = document.getElementById('detail-overlay');
    if (modal) modal.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (!isAnyOpen(document)) document.body.style.overflow = '';
    state.detailId = null;
    current = null;
  }

  function addToCartHandler(mode) {
    const r = current && current.r;
    if (!r) return;
    const ings = r.recipeIngredient || [];
    if (!ings.length) { toast('This recipe has no ingredients'); return; }
    const { cart, addedCount } = addToCart(state.cart, r, state.pantry, mode);
    state.cart = cart;
    persist();
    if (mode === 'missing' && addedCount === 0) toast('Nothing missing — you have everything');
    else toast(`Added ${pluralize(addedCount, 'item')} to cart`);
  }

  function wireDetail() {
    const closeBtn = document.getElementById('detail-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    const overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.addEventListener('click', closeSheet);
    const editBtn = document.getElementById('dm-edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => {
      const id = state.detailId;
      closeSheet();
      if (onEdit) onEdit(id);
    });
    const schemaBtn = document.getElementById('dm-schema-btn');
    if (schemaBtn) schemaBtn.addEventListener('click', () => { if (state.detailId && onSchema) onSchema(state.detailId); });
    const missingBtn = document.getElementById('dm-add-missing-btn');
    if (missingBtn) missingBtn.addEventListener('click', () => addToCartHandler('missing'));
    const allBtn = document.getElementById('dm-add-all-btn');
    if (allBtn) allBtn.addEventListener('click', () => addToCartHandler('all'));
    const ings = document.getElementById('dm-ingredients');
    if (ings) {
      ings.addEventListener('click', (e) => {
        const item = e.target.closest('.detail-ing-item');
        if (!item || !item.dataset.ing) return;
        const { pantry, added, name } = togglePantry(state.pantry, item.dataset.ing.toLowerCase());
        state.pantry = pantry;
        persist();
        renderIngredients();
        if (onChange) onChange();
        toast(added ? `Added "${name}" to pantry` : `Removed "${name}" from pantry`);
      });
    }
    const saveLocalBtn = document.getElementById('dm-save-local-btn');
    if (saveLocalBtn) saveLocalBtn.addEventListener('click', () => {
      if (current && current.ctx.source === 'community' && onSaveCommunityLocal) onSaveCommunityLocal(current.ctx);
    });
    const cEditBtn = document.getElementById('dm-community-edit-btn');
    if (cEditBtn) cEditBtn.addEventListener('click', () => {
      if (current && current.ctx.source === 'community' && onEditCommunity) {
        const ctx = current.ctx;
        const r = current.r;
        closeSheet();
        onEditCommunity({ id: ctx.id, author: ctx.author, recipe: r });
      }
    });
    const cDelBtn = document.getElementById('dm-community-delete-btn');
    if (cDelBtn) cDelBtn.addEventListener('click', () => {
      if (!current || current.ctx.source !== 'community' || !onDeleteCommunity) return;
      if (!confirm('Delete this shared recipe?')) return;
      onDeleteCommunity(current.ctx);
    });
    const shareBtn = document.getElementById('dm-share-community-btn');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      if (current && current.ctx.source === 'local' && onShareCommunity) onShareCommunity(current.r);
    });
  }

  wireDetail();
  return { open, openCommunity, close: closeSheet, _renderIngredients: renderIngredients };
}

function isAnyOpen(document) {
  return !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
