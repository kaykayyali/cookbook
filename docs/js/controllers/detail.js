// ════════════════════════════════════════════════════════
// controllers/detail.js — recipe detail sheet open/close + render
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { save as persist } from '../lib/store.js';
import { togglePantry } from '../lib/pantry.js';
import {
  addRecipeSelection,
  isNormalizedIngredient,
  normalizeIngredientsLocal,
  recipeSetSignature,
  NORMALIZATION_VERSION,
} from '../lib/cart.js';
import { normalizeRecipeIngredients } from '../lib/api.js';
import { esc } from '../lib/format.js';

import {
  ingredientListHTML,
  pantryNoteHTML,
  metaRowHTML,
  stepsHTML,
  nutritionHTML,
} from '../components/recipeDetail.js';

const reactionLabel = { loved: 'Loved it', good: 'Good', not_for_us: 'Not for us' };

export function historyHTML(events = [], reactions = [], actorSub = '') {
  if (!events.length) return '<p class="empty-state">Not cooked yet — your first memory will appear here.</p>';
  return events.map((event) => {
    const eventReactions = reactions.filter((reaction) => reaction.cookEventId === event.id);
    const own = eventReactions.find((reaction) => reaction.memberSub === actorSub);
    const memories = eventReactions.map((reaction) => `<p class="cook-memory"><strong>${reaction.memberSub === actorSub ? 'You' : 'Partner'} · ${reactionLabel[reaction.reaction] || 'Memory'}</strong>${reaction.note ? ` — ${esc(reaction.note)}` : ''}</p>`).join('');
    return `<article class="cook-history-card" data-event-id="${esc(event.id)}">
      <p><strong>${new Date(event.cookedAt).toLocaleDateString()}</strong>${event.notes ? ` — ${esc(event.notes)}` : ''}</p>
      ${memories}
      <div class="cook-reaction-actions" role="group" aria-label="Your reaction">
        <button class="btn btn-ghost btn-sm" data-reaction="loved">Loved it</button>
        <button class="btn btn-ghost btn-sm" data-reaction="good">Good</button>
        <button class="btn btn-ghost btn-sm" data-reaction="not_for_us">Not for us</button>
      </div>
      <label>Shared memory <textarea class="input" data-memory maxlength="1000">${esc(own?.note || '')}</textarea></label>
      <div class="cook-history-actions">
        <button class="btn btn-primary btn-sm" data-action="save-reaction">Save my memory</button>
        <button class="btn btn-ghost btn-sm" data-action="edit-history">Edit history</button>
        <button class="btn btn-ghost btn-sm" data-action="delete-history">Delete</button>
      </div>
    </article>`;
  }).join('');
}

/**
 * Detail modal controller.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {(id: string) => void} [deps.onEdit] - fires when user clicks "Edit"
 * @param {(id: string) => void} [deps.onSchema] - fires when user clicks "Schema"
 * @param {() => void} [deps.onChange] - fires when pantry changes via ingredient tap (re-render recipes)

 * @returns {{ open: (id) => void, close: () => void, _renderIngredients: () => void }}
 */
export function initDetail({
  state,
  document = globalThis.document,
  onEdit = null,
  onSchema = null,
  onChange = null,
  mutate = null,
  normalizeIngredients = normalizeRecipeIngredients,
  notify = toast,
  getHistory = () => [],
  getReactions = () => [],
  onMarkCooked = async () => false,
  onCookMode = () => {},
  onReact = async () => false,
  onCorrectHistory = async () => false,
  onDeleteHistory = async () => false,
  prompt = globalThis.prompt,
  confirm = globalThis.confirm,
}) {
  let current = null;
  let addQueue = Promise.resolve();

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
      if (ctx.author) {
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
    setDisplay('dm-edit-btn', ctx.source === 'local' && ctx.isAuthor !== false ? '' : 'none');
    setDisplay('dm-schema-btn', ctx.source === 'local' ? '' : 'none');


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

    renderHistory();
    openSheet();
  }

  function setDisplay(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  }

  function open(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return;
    const isAuthor = !r._author || !!(state.auth?.sub && r._author.sub === state.auth.sub);
    openRecipe(r, { source: 'local', author: r._author, isAuthor });
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

  function renderHistory() {
    const target = document.getElementById('dm-history');
    const recipeId = current ? String(current.r._id || current.r.id || '') : '';
    if (target) target.innerHTML = historyHTML(getHistory(recipeId), getReactions(), state.auth?.sub || '');
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

  async function performAddToCart(r, queuedCancellationGeneration) {
    if (queuedCancellationGeneration !== (Number(state.cartCancellationGeneration) || 0)) return false;
    const generation = Number(state.cartMutationGeneration) || 0;
    const currentLines = (r.recipeIngredient || []).filter((line) => typeof line === 'string' && line.trim());
    if (!currentLines.length) { notify('This recipe has no ingredients'); return; }

    state.normalizations ||= {};
    state.normalizationAudit ||= {};
    const activeRecipes = (state.cart || []).map((selection) => {
      const source = (state.recipes || []).find((recipe) => String(recipe._id || recipe.id) === selection.recipeId);
      return {
        recipeId: selection.recipeId,
        recipeName: source?.name || selection.recipeName,
        recipeYield: source?.recipeYield || selection.sourceServings,
        ingredients: source
          ? (source.recipeIngredient || []).filter((line) => typeof line === 'string' && line.trim())
          : (selection.ingredients || []).map((ingredient) => ingredient.raw).filter(Boolean),
        recipe: source || { _id: selection.recipeId, name: selection.recipeName, recipeYield: selection.sourceServings },
      };
    }).filter((entry) => entry.ingredients.length);
    const recipeId = String(r._id || r.id || r.name);
    const set = activeRecipes.filter((entry) => entry.recipeId !== recipeId);
    set.push({ recipeId, recipeName: r.name, recipeYield: r.recipeYield, ingredients: currentLines, recipe: r });
    const signature = recipeSetSignature(set);
    const cachesMatch = set.every((entry) => {
      const cached = state.normalizations[entry.recipeId];
      return cached?.version === NORMALIZATION_VERSION
        && Array.isArray(cached.raw) && cached.raw.length === entry.ingredients.length
        && cached.raw.every((line, index) => line === entry.ingredients[index])
        && Array.isArray(cached.ingredients) && cached.ingredients.length === entry.ingredients.length
        && cached.ingredients.every((item) => isNormalizedIngredient(item)
          && typeof item.displayName === 'string' && typeof item.countLabel === 'string' && typeof item.category === 'string');
    });

    let normalizedSet;
    if (state.normalizationAudit.signature === signature && cachesMatch) {
      normalizedSet = set.map((entry) => ({ recipeId: entry.recipeId, ingredients: state.normalizations[entry.recipeId].ingredients }));
    } else {
      const request = set.map(({ recipeId: id, recipeName, recipeYield, ingredients }) => ({ recipeId: id, recipeName, recipeYield, ingredients }));
      try {
        normalizedSet = await normalizeIngredients(request);
        const valid = Array.isArray(normalizedSet) && normalizedSet.length === set.length
          && normalizedSet.every((result, index) => result?.recipeId === set[index].recipeId
            && Array.isArray(result.ingredients) && result.ingredients.length === set[index].ingredients.length
            && result.ingredients.every((item, itemIndex) => isNormalizedIngredient(item)
              && item.raw === set[index].ingredients[itemIndex]
              && typeof item.displayName === 'string' && typeof item.countLabel === 'string' && typeof item.category === 'string'));
        if (!valid) throw new Error('invalid_normalization');
      } catch {
        normalizedSet = set.map((entry) => ({ recipeId: entry.recipeId, ingredients: normalizeIngredientsLocal(entry.ingredients) }));
      }
    }

    if (generation !== (Number(state.cartMutationGeneration) || 0)
        || queuedCancellationGeneration !== (Number(state.cartCancellationGeneration) || 0)) return false;

    normalizedSet.forEach((result, index) => {
      const entry = set[index];
      state.normalizations[entry.recipeId] = {
        version: NORMALIZATION_VERSION,
        raw: [...entry.ingredients],
        ingredients: result.ingredients.map((item) => ({ ...item })),
      };
      state.cart = addRecipeSelection(state.cart || [], entry.recipe, result.ingredients);
      const selection = state.cart.find((item) => item.recipeId === entry.recipeId);
      if (mutate && selection) void mutate('cart.upsertSelection', { selection });
    });
    state.cartMutationGeneration = generation + 1;
    state.normalizationAudit = { signature };
    while (Object.keys(state.normalizations).length > 100) delete state.normalizations[Object.keys(state.normalizations)[0]];
    persist();
    notify(`Added “${r.name}” to shopping list`);
    return true;
  }

  function addToCartHandler() {
    const r = current && current.r;
    if (!r) return Promise.resolve(false);
    const queuedCancellationGeneration = Number(state.cartCancellationGeneration) || 0;
    const run = () => performAddToCart(r, queuedCancellationGeneration);
    const pending = addQueue.then(run, run);
    addQueue = pending.catch(() => false);
    return pending;
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
    const allBtn = document.getElementById('dm-add-all-btn');
    if (allBtn) allBtn.addEventListener('click', () => { void addToCartHandler(); });
    document.getElementById('dm-mark-cooked-btn')?.addEventListener('click', async () => {
      if (current && await onMarkCooked(current.r)) renderHistory();
    });
    document.getElementById('dm-cook-mode-btn')?.addEventListener('click', () => {
      if (current) onCookMode(current.r);
    });
    document.getElementById('dm-history')?.addEventListener('click', async (event) => {
      const card = event.target.closest('[data-event-id]');
      if (!card) return;
      const eventId = card.dataset.eventId;
      const reaction = event.target.closest('[data-reaction]')?.dataset.reaction;
      if (reaction) {
        card.dataset.selectedReaction = reaction;
        card.querySelectorAll('[data-reaction]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.reaction === reaction)));
        return;
      }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'save-reaction') {
        const selected = card.dataset.selectedReaction || getReactions().find((item) => item.cookEventId === eventId && item.memberSub === state.auth?.sub)?.reaction;
        if (selected && await onReact(eventId, selected, { note: card.querySelector('[data-memory]')?.value || '', wouldMakeAgain: selected !== 'not_for_us' })) renderHistory();
      } else if (action === 'edit-history') {
        const existing = getHistory(String(current?.r?._id || current?.r?.id || '')).find((item) => item.id === eventId);
        const notes = prompt?.('Edit this cooking memory', existing?.notes || '');
        if (notes != null && await onCorrectHistory(eventId, { notes })) renderHistory();
      } else if (action === 'delete-history' && confirm?.('Delete this cooking history entry?')) {
        if (await onDeleteHistory(eventId)) renderHistory();
      }
    });
    // Pantry note "Add to cart" button (shown only when missing > 0) —
    // replaces the old section-label "Add missing to cart" button.
    const note = document.getElementById('dm-pantry-note');
    if (note) note.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="add-missing"]')) void addToCartHandler();
    });
    const ings = document.getElementById('dm-ingredients');
    if (ings) {
      ings.addEventListener('click', (e) => {
        const item = e.target.closest('.detail-ing-item');
        if (!item || !item.dataset.ing) return;
        const { pantry, added, name } = togglePantry(state.pantry, item.dataset.ing.toLowerCase());
        state.pantry = pantry;
        if (mutate) void mutate(added ? 'pantry.add' : 'pantry.remove', { name });
        persist();
        renderIngredients();
        if (onChange) onChange();
        notify(added ? `Added "${name}" to pantry` : `Removed "${name}" from pantry`);
      });
    }


  }

  wireDetail();
  return { open, close: closeSheet, _renderIngredients: renderIngredients, _addToCart: addToCartHandler };
}

function isAnyOpen(document) {
  return !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
