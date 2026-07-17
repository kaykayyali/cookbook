// ════════════════════════════════════════════════════════
// controllers/detail.js — recipe detail sheet open/close + render
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { save as persist } from '../lib/store.js';
import { normalizePantryEntry, togglePantry } from '../lib/pantry.js';
import {
  addRecipeSelection,
  isNormalizedIngredient,
  normalizeIngredientsLocal,
  recipeSetSignature,
  NORMALIZATION_VERSION,
} from '../lib/cart.js';
import { normalizeRecipeIngredients } from '../lib/api.js';
import { esc, formatListValue } from '../lib/format.js';
import { householdIdentityHTML } from '../components/householdIdentity.js';
import { interactionFeedback as defaultFeedback } from '../lib/interaction-feedback.js';

import {
  ingredientListHTML,
  pantryNoteHTML,
  metaRowHTML,
  stepsHTML,
  nutritionHTML,
} from '../components/recipeDetail.js';

const reactionLabel = { loved: 'Loved it', good: 'Good', not_for_us: 'Not for us' };
const starsText = (value) => Number.isInteger(value)
  ? `${'★'.repeat(value)}${'☆'.repeat(5 - value)}` : 'Not rated';
const starRatingHTML = (label, name, value) => `<div class="cook-star-field">
  <span>${label}</span>
  <div class="cook-star-rating" role="radiogroup" aria-label="${label}" data-rating="${name}" data-selected="${value || ''}">
    ${[1, 2, 3, 4, 5].map((score) => `<button type="button" data-rating="${name}" data-value="${score}" data-feedback="select" role="radio" tabindex="${score === (value || 1) ? 0 : -1}" aria-checked="${score === value}" aria-label="${label}: ${score} out of 5">★</button>`).join('')}
  </div>
</div>`;

function selectStar(star, focus = false) {
  const group = star.closest('[role="radiogroup"]');
  group.dataset.selected = star.dataset.value;
  group.querySelectorAll('[data-value]').forEach((button) => {
    const selected = Number(button.dataset.value) === Number(star.dataset.value);
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  if (focus) star.focus();
}

export function historyHTML(events = [], reactions = [], actorSub = '') {
  if (!events.length) return '<p class="empty-state">Not cooked yet — your first memory will appear here.</p>';
  return events.map((event) => {
    const eventReactions = reactions.filter((reaction) => reaction.cookEventId === event.id);
    const own = eventReactions.find((reaction) => reaction.memberSub === actorSub);
    const memories = eventReactions.map((reaction) => {
      const ratingParts = [
        reaction.taste ? `Taste ${starsText(reaction.taste)}` : '',
        reaction.complexity ? `Complexity ${starsText(reaction.complexity)}` : '',
      ].filter(Boolean);
      const ratings = `<span>${ratingParts.join(' · ') || reactionLabel[reaction.reaction] || 'Unrated'}</span>`;
      return `<div class="cook-member-review"><strong>${reaction.memberSub === actorSub ? 'You' : 'Partner'}</strong>${ratings}${reaction.review || reaction.note ? `<p>${esc(reaction.review || reaction.note)}</p>` : ''}</div>`;
    }).join('');
    return `<article class="cook-history-card" data-event-id="${esc(event.id)}">
      <p><strong>${new Date(event.cookedAt).toLocaleDateString()}</strong></p>
      <label class="cook-memory-field"><span>Occasion</span><textarea class="input" data-occasion maxlength="2000" placeholder="Weeknight dinner, birthday, friends over…">${esc(event.occasion || event.notes || '')}</textarea></label>
      <button class="btn btn-ghost btn-sm" data-action="save-occasion" data-feedback="commit">Save occasion</button>
      ${memories}
      <div class="cook-ratings">
        ${starRatingHTML('Taste', 'taste', own?.taste)}
        ${starRatingHTML('Complexity', 'complexity', own?.complexity)}
      </div>
      <label class="cook-memory-field"><span>Review</span><textarea class="input" data-review maxlength="1000" placeholder="What worked? What would you change?">${esc(own?.review || own?.note || '')}</textarea></label>
      <div class="cook-history-actions">
        <button class="btn btn-primary btn-sm" data-action="save-review" data-feedback="commit">Save my review</button>
        <button class="btn btn-ghost btn-sm" data-action="edit-history" data-feedback="commit">Edit history</button>
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
  feedback = defaultFeedback,
}) {
  let current = null;
  let opener = null;
  const pendingAudits = new Set();

  function openRecipe(r, ctx = { source: 'local' }) {
    if (!r) return;
    current = { r, ctx };
    state.detailId = ctx.source === 'local' ? r._id : null;

    const eyebrow = document.getElementById('dm-eyebrow');
    if (eyebrow) {
      eyebrow.textContent = [formatListValue(r.recipeCategory), formatListValue(r.recipeCuisine)]
        .filter(Boolean)
        .join(' · ');
    }
    const title = document.getElementById('dm-title');
    if (title) title.textContent = r.name;
    const meta = document.getElementById('dm-meta');
    if (meta) meta.innerHTML = metaRowHTML(r);

    // Author badge: shown only for community recipes.
    const badge = document.getElementById('dm-author-badge');
    if (badge) {
      if (ctx.author) {
        badge.innerHTML = householdIdentityHTML(ctx.author);
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
    try { localStorage.setItem('cb_detail_id', id); } catch { /* private mode */ }
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
    renderAddButtonState();
  }

  function renderAddButtonState() {
    const recipeId = current ? String(current.r._id || current.r.id || current.r.name) : '';
    const inCart = recipeId && (state.cart || []).some((selection) => selection.recipeId === recipeId);
    const allButton = document.getElementById('dm-add-all-btn');
    if (allButton) {
      allButton.disabled = Boolean(inCart);
      allButton.textContent = inCart ? 'In shopping list' : 'Add recipe to cart';
    }
    const noteButton = document.querySelector?.('#dm-pantry-note [data-action="add-missing"]');
    if (noteButton) {
      noteButton.disabled = Boolean(inCart);
      noteButton.textContent = inCart ? 'In cart' : 'Add to cart';
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
    const scroller = document.querySelector?.('.detail-body');
    if (scroller) scroller.scrollTop = 0;
    opener = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : opener;
    if (modal) {
      modal.hidden = false;
      modal.removeAttribute?.('aria-hidden');
      modal.removeAttribute?.('inert');
      modal.setAttribute?.('aria-modal', 'true');
      modal.classList.add('open');
    }
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add('open');
    }
    document.body.style.overflow = 'hidden';
    document.getElementById('detail-close-btn')?.focus?.();
  }

  function closeSheet() {
    const modal = document.getElementById('detail-modal');
    const overlay = document.getElementById('detail-overlay');
    if (modal) {
      modal.setAttribute?.('inert', '');
      modal.setAttribute?.('aria-hidden', 'true');
      modal.classList.remove('open');
      modal.removeAttribute?.('aria-modal');
      modal.hidden = true;
    }
    if (overlay) {
      overlay.classList.remove('open');
      overlay.hidden = true;
    }
    if (!isAnyOpen(document)) document.body.style.overflow = '';
    state.detailId = null;
    current = null;
    try { localStorage.removeItem('cb_detail_id'); } catch { /* private mode */ }
    const restore = opener;
    opener = null;
    if (restore?.isConnected !== false) {
      try { restore?.focus?.(); } catch { /* Detached opener. */ }
    }
  }

  function focusableElements(modal) {
    return [...(modal?.querySelectorAll?.('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])]
      .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true'
        && element.style?.display !== 'none' && !element.closest?.('[hidden]'));
  }

  function handleModalKey(event) {
    const modal = document.getElementById('detail-modal');
    if (!modal?.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(modal);
    if (!focusable.length) { event.preventDefault(); modal.focus?.(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function activeCartEntries() {
    return (state.cart || []).map((selection) => {
      const source = (state.recipes || []).find((recipe) => String(recipe._id || recipe.id) === selection.recipeId);
      return {
        recipeId: selection.recipeId,
        recipeName: source?.name || selection.recipeName,
        recipeYield: source?.recipeYield || selection.sourceServings,
        ingredients: source
          ? (source.recipeIngredient || []).filter((line) => typeof line === 'string' && line.trim())
          : (selection.ingredients || []).map((ingredient) => ingredient.raw).filter(Boolean),
      };
    }).filter((entry) => entry.ingredients.length);
  }

  function cacheMatches(recipeId, lines) {
    const cached = state.normalizations?.[recipeId];
    return cached?.version === NORMALIZATION_VERSION
      && Array.isArray(cached.raw) && cached.raw.length === lines.length
      && cached.raw.every((line, index) => line === lines[index])
      && Array.isArray(cached.ingredients) && cached.ingredients.length === lines.length
      && cached.ingredients.every((item) => isNormalizedIngredient(item)
        && typeof item.displayName === 'string' && typeof item.countLabel === 'string' && typeof item.category === 'string');
  }

  function commitSelection(recipe, lines, ingredients) {
    const recipeId = String(recipe._id || recipe.id || recipe.name);
    state.normalizations[recipeId] = {
      version: NORMALIZATION_VERSION,
      raw: [...lines],
      ingredients: ingredients.map((item) => ({ ...item })),
    };
    state.cart = addRecipeSelection(state.cart || [], recipe, ingredients);
    state.cartMutationGeneration = (Number(state.cartMutationGeneration) || 0) + 1;
    const activeEntries = activeCartEntries();
    const allRecipesCurrent = activeEntries.length === state.cart.length
      && activeEntries.every((entry) => cacheMatches(entry.recipeId, entry.ingredients));
    state.normalizationAudit = allRecipesCurrent
      ? { signature: recipeSetSignature(activeEntries) }
      : {};
    while (Object.keys(state.normalizations).length > 100) delete state.normalizations[Object.keys(state.normalizations)[0]];
    persist();
    const selection = state.cart.find((item) => item.recipeId === recipeId);
    if (mutate && selection) void mutate('cart.upsertSelection', { selection });
    renderAddButtonState();
    if (onChange) onChange();
    return selection;
  }

  function currentRecipeForAudit(recipeId, lines) {
    const recipe = (state.recipes || []).find((item) => String(item._id || item.id || item.name) === recipeId);
    const currentLines = (recipe?.recipeIngredient || []).filter((line) => typeof line === 'string' && line.trim());
    return recipe && currentLines.length === lines.length && currentLines.every((line, index) => line === lines[index])
      ? recipe
      : null;
  }

  async function auditRecipe(recipe, lines, cancellationGeneration) {
    const recipeId = String(recipe._id || recipe.id || recipe.name);
    const request = [{ recipeId, recipeName: recipe.name, recipeYield: recipe.recipeYield, ingredients: lines }];
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    const timeout = controller ? globalThis.setTimeout(() => controller.abort(), 12_000) : null;
    try {
      const normalized = await normalizeIngredients(request, { signal: controller?.signal });
      const result = normalized?.[0];
      const valid = Array.isArray(normalized) && normalized.length === 1 && result?.recipeId === recipeId
        && Array.isArray(result.ingredients) && result.ingredients.length === lines.length
        && result.ingredients.every((item, index) => isNormalizedIngredient(item)
          && item.raw === lines[index]
          && typeof item.displayName === 'string' && typeof item.countLabel === 'string' && typeof item.category === 'string');
      if (!valid) return false;
      const currentRecipe = currentRecipeForAudit(recipeId, lines);
      if (cancellationGeneration !== (Number(state.cartCancellationGeneration) || 0)
          || !(state.cart || []).some((selection) => selection.recipeId === recipeId)
          || !currentRecipe) return false;
      commitSelection(currentRecipe, lines, result.ingredients);
      return true;
    } catch {
      return false;
    } finally {
      if (timeout) globalThis.clearTimeout(timeout);
    }
  }

  function scheduleAudit(recipe, lines, cancellationGeneration) {
    const audit = auditRecipe(recipe, lines, cancellationGeneration);
    pendingAudits.add(audit);
    void audit.finally(() => pendingAudits.delete(audit));
  }

  function performAddToCart(recipe, cancellationGeneration) {
    if (cancellationGeneration !== (Number(state.cartCancellationGeneration) || 0)) return false;
    const lines = (recipe.recipeIngredient || []).filter((line) => typeof line === 'string' && line.trim());
    if (!lines.length) { notify('This recipe has no ingredients'); return false; }
    state.normalizations ||= {};
    state.normalizationAudit ||= {};
    const recipeId = String(recipe._id || recipe.id || recipe.name);
    const hasCache = cacheMatches(recipeId, lines);
    const ingredients = hasCache ? state.normalizations[recipeId].ingredients : normalizeIngredientsLocal(lines);
    commitSelection(recipe, lines, ingredients);
    notify(`Added “${recipe.name}” to shopping list`);
    if (!hasCache) scheduleAudit(recipe, lines, cancellationGeneration);
    return true;
  }

  function addToCartHandler(sourceEvent = null) {
    const recipe = current && current.r;
    if (!recipe) return Promise.resolve(false);
    const target = document.getElementById('dm-add-all-btn');
    const interaction = feedback.contextFromEvent?.(sourceEvent, target);
    const cancellationGeneration = Number(state.cartCancellationGeneration) || 0;
    const added = performAddToCart(recipe, cancellationGeneration);
    feedback.emit(added ? 'success' : 'blocked', {
      target,
      interaction: interaction ? { ...interaction, deferred: true } : null,
    });
    return Promise.resolve(added);
  }

  function wireDetail() {
    document.getElementById('detail-modal')?.addEventListener('keydown', handleModalKey);
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
    if (allBtn) allBtn.addEventListener('click', (event) => { void addToCartHandler(event); });
    document.getElementById('dm-mark-cooked-btn')?.addEventListener('click', async (event) => {
      const target = document.getElementById('dm-mark-cooked-btn');
      const interaction = feedback.contextFromEvent?.(event, target);
      const completed = Boolean(current && await onMarkCooked(current.r));
      if (completed) renderHistory();
      feedback.emit(completed ? 'success' : 'blocked', {
        target,
        interaction: interaction ? { ...interaction, deferred: true } : null,
      });
    });
    document.getElementById('dm-cook-mode-btn')?.addEventListener('click', () => {
      if (current) onCookMode(current.r);
    });
    document.getElementById('dm-history')?.addEventListener('click', async (event) => {
      const card = event.target.closest('[data-event-id]');
      if (!card) return;
      const eventId = card.dataset.eventId;
      const star = event.target.closest('[data-rating][data-value]');
      if (star) {
        selectStar(star);
        return;
      }
      const actionTarget = event.target.closest('[data-action]');
      const action = actionTarget?.dataset.action;
      const interaction = feedback.contextFromEvent?.(event, actionTarget || card);
      const outcome = interaction ? { ...interaction, deferred: true } : null;
      if (action === 'save-review') {
        const taste = Number(card.querySelector('[data-rating="taste"]')?.dataset.selected) || null;
        const complexity = Number(card.querySelector('[data-rating="complexity"]')?.dataset.selected) || null;
        const review = card.querySelector('[data-review]')?.value || '';
        if (!taste && !complexity && !review.trim()) { notify('Add a rating or review'); feedback.emit('blocked', { target: card, interaction: outcome }); return; }
        const saved = await onReact(eventId, { taste, complexity, review });
        if (saved) renderHistory();
        feedback.emit(saved ? 'success' : 'blocked', { target: card, interaction: outcome });
      } else if (action === 'save-occasion') {
        const saved = await onCorrectHistory(eventId, { occasion: card.querySelector('[data-occasion]')?.value || '' });
        if (saved) renderHistory();
        feedback.emit(saved ? 'success' : 'blocked', { target: card, interaction: outcome });
      } else if (action === 'edit-history') {
        const existing = getHistory(String(current?.r?._id || current?.r?.id || '')).find((item) => item.id === eventId);
        const occasion = prompt?.('Edit this occasion', existing?.occasion || existing?.notes || '');
        if (occasion != null && await onCorrectHistory(eventId, { occasion })) renderHistory();
      } else if (action === 'delete-history') {
        if (!confirm?.('Delete this cooking history entry?')) return;
        feedback.emit('destructive', { target: actionTarget, sourceEvent: event, interaction });
        const removed = await onDeleteHistory(eventId);
        if (removed) renderHistory();
        feedback.emit(removed ? 'success' : 'blocked', { target: card, interaction: outcome });
      }
    });
    document.getElementById('dm-history')?.addEventListener('keydown', (event) => {
      const star = event.target.closest('[data-rating][data-value]');
      if (!star || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const stars = [...star.closest('[role="radiogroup"]').querySelectorAll('[data-value]')];
      const currentIndex = stars.indexOf(star);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? stars.length - 1
        : (currentIndex + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + stars.length) % stars.length;
      event.preventDefault();
      selectStar(stars[nextIndex], true);
    });
    // Pantry note "Add to cart" button (shown only when missing > 0) —
    // replaces the old section-label "Add missing to cart" button.
    const note = document.getElementById('dm-pantry-note');
    if (note) note.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="add-missing"]')) void addToCartHandler(e);
    });
    const ings = document.getElementById('dm-ingredients');
    if (ings) {
      ings.addEventListener('click', (e) => {
        const item = e.target.closest('.detail-ing-item');
        if (!item || !item.dataset.ing) return;
        const input = normalizePantryEntry(item.dataset.ing.toLowerCase(), { updatedAt: Date.now() });
        const { pantry, added, name, item: pantryItem } = togglePantry(state.pantry, input);
        state.pantry = pantry;
        if (mutate) void mutate(added ? 'pantry.add' : 'pantry.remove', added
          ? { item: pantryItem }
          : { id: pantryItem?.id });
        persist();
        renderIngredients();
        if (onChange) onChange();
        notify(added ? `Added "${name}" to pantry` : `Removed "${name}" from pantry`);
      });
      ings.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        const item = event.target.closest('.detail-ing-item');
        if (!item) return;
        event.preventDefault();
        item.click();
      });
    }


  }

  function restore() {
    let saved = null;
    try { saved = localStorage.getItem('cb_detail_id'); } catch { /* private mode */ }
    if (!saved) return;
    const r = state.recipes.find((x) => x._id === saved);
    if (!r) {
      try { localStorage.removeItem('cb_detail_id'); } catch { /* private mode */ }
      return;
    }
    const isAuthor = !r._author || !!(state.auth?.sub && r._author.sub === state.auth.sub);
    openRecipe(r, { source: 'local', author: r._author, isAuthor });
  }

  const initialModal = document.getElementById('detail-modal');
  if (initialModal && !initialModal.classList.contains('open')) {
    initialModal.setAttribute?.('inert', '');
    initialModal.setAttribute?.('aria-hidden', 'true');
    initialModal.removeAttribute?.('aria-modal');
    initialModal.hidden = true;
  }
  const initialOverlay = document.getElementById('detail-overlay');
  if (initialOverlay && !initialOverlay.classList.contains('open')) initialOverlay.hidden = true;
  wireDetail();
  return {
    open, close: closeSheet, restore, _renderIngredients: renderIngredients, _addToCart: addToCartHandler,
    _waitForAudits: () => Promise.allSettled([...pendingAudits]),
  };
}

function isAnyOpen(document) {
  return !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open');
}
