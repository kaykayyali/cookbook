// ════════════════════════════════════════════════════════
// controllers/detail.js — recipe detail sheet open/close + render
// ════════════════════════════════════════════════════════

import { toast } from '../lib/dom.js';
import { save as persist } from '../lib/store.js';
import { normalizePantryEntry, pantryRecordFingerprint, togglePantry } from '../lib/pantry.js';
import {
  addRecipeSelection,
  isNormalizedIngredient,
  normalizeIngredientsLocal,
  recipeSetSignature,
  NORMALIZATION_VERSION,
} from '../lib/cart.js';
import { normalizeRecipeIngredients } from '../lib/api.js';
import {
  AMOUNT_STATES,
  FAMILY_UNITS,
  applyReviewedIngredientCorrection,
  effectiveIngredientRecords,
  ingredientEditorProjection,
  validateIngredientCorrection,
} from '../lib/ingredient-corrections.js';
import { COUNT_LABELS } from '../lib/cart.js';
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
  mutateRecipe = null,
  normalizeIngredients = normalizeRecipeIngredients,
  notify = toast,
  getHistory = () => [],
  getReactions = () => [],
  onMarkCooked = async () => false,
  onCookMode = () => {},
  onReact = async () => false,
  onCorrectHistory = async () => false,
  onDeleteHistory = async () => false,
  onClose = null,
  prompt = globalThis.prompt,
  confirm = globalThis.confirm,
  feedback = defaultFeedback,
}) {
  let current = null;
  let opener = null;
  let correction = null;
  let correctionOpener = null;
  let correctionPending = false;
  let suspendedDetailState = null;
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

  const correctionIds = {
    modal: 'ingredient-correction-modal', overlay: 'ingredient-correction-overlay',
    form: 'ingredient-correction-form', name: 'ingredient-correction-name',
    state: 'ingredient-correction-state', amount: 'ingredient-correction-amount',
    family: 'ingredient-correction-family', unit: 'ingredient-correction-unit',
    countLabel: 'ingredient-correction-count-label', error: 'ingredient-correction-error',
    pending: 'ingredient-correction-pending', save: 'ingredient-correction-save',
    close: 'ingredient-correction-close', cancel: 'ingredient-correction-cancel',
  };

  function correctionElement(key) { return document.getElementById(correctionIds[key] || key); }

  function setSelectOptions(select, values, selected, labels = {}) {
    if (!select) return;
    select.innerHTML = values.map((value) => `<option value="${esc(value)}">${esc(labels[value] || value || 'None')}</option>`).join('');
    select.value = values.includes(selected) ? selected : values[0];
  }

  function renderCorrectionDependencies() {
    const amountState = correctionElement('state')?.value;
    const numeric = amountState === 'numeric';
    for (const id of ['ingredient-correction-amount-group', 'ingredient-correction-family-group', 'ingredient-correction-unit-group']) {
      const group = document.getElementById(id);
      if (group) group.hidden = !numeric;
    }
    const family = correctionElement('family')?.value || 'count';
    const units = FAMILY_UNITS[family] || FAMILY_UNITS.count;
    const unit = correctionElement('unit');
    setSelectOptions(unit, units, unit?.value, {
      count: 'Count', dozen: 'Dozen', tsp: 'Teaspoon', tbsp: 'Tablespoon', cup: 'Cup',
      'fl-oz': 'Fluid ounce', ml: 'Milliliter', l: 'Liter', oz: 'Ounce', lb: 'Pound', g: 'Gram', kg: 'Kilogram',
    });
    if (unit) unit.disabled = !numeric;
    const countGroup = document.getElementById('ingredient-correction-count-label-group');
    if (countGroup) countGroup.hidden = !numeric || family !== 'count';
    const countLabel = correctionElement('countLabel');
    if (countLabel) countLabel.disabled = !numeric || family !== 'count';
    const amount = correctionElement('amount');
    if (amount) amount.disabled = !numeric;
    const familySelect = correctionElement('family');
    if (familySelect) familySelect.disabled = !numeric;
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function renderProvenance(provenance) {
    const target = document.getElementById('ingredient-correction-provenance');
    if (!target) return;
    target.replaceChildren?.();
    const sourceUrl = safeSourceUrl(provenance?.sourceUrl);
    if (sourceUrl) {
      const link = document.createElement('a');
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.feedback = 'touch';
      link.textContent = 'Open import source';
      target.append(link);
    }
    const method = [provenance?.extractorMethod, provenance?.extractorVersion].filter(Boolean).join(' · ');
    if (method) {
      const detail = document.createElement('p');
      detail.textContent = method;
      target.append(detail);
    }
    if (!sourceUrl && !method) target.textContent = 'Manually entered recipe';
  }

  function correctionStatusText(record) {
    if (record.reviewStatus !== 'reviewed') return `Not reviewed · parser v${record.parserVersion}`;
    const reviewer = record.reviewedBy?.name || 'Household member';
    return `Reviewed by ${reviewer} · parser v${record.parserVersion}`;
  }

  function showCorrectionError(message, field = '') {
    const error = correctionElement('error');
    if (error) { error.textContent = message || ''; error.hidden = !message; }
    if (field) correctionElement(field)?.setAttribute?.('aria-invalid', 'true');
  }

  function clearCorrectionError() {
    showCorrectionError('');
    for (const key of ['name', 'state', 'amount', 'family', 'unit', 'countLabel']) correctionElement(key)?.removeAttribute?.('aria-invalid');
  }

  function openCorrection(ingredientId, sourceElement) {
    const recipe = current?.r;
    const record = effectiveIngredientRecords(recipe).find((item) => item.id === ingredientId);
    if (!recipe || !record) { notify('Ingredient evidence changed. Reload and try again.'); return false; }
    correction = { recipeId: String(recipe._id || recipe.id), ingredientId, record };
    correctionOpener = sourceElement || document.activeElement;
    correctionPending = false;
    const draft = ingredientEditorProjection(record);
    correctionElement('name').value = draft.name;
    correctionElement('state').value = draft.amountState;
    correctionElement('amount').value = draft.amount || '';
    correctionElement('family').value = draft.measurementFamily || 'count';
    setSelectOptions(correctionElement('countLabel'), COUNT_LABELS, draft.countLabel || '', { '': 'None', leaf: 'Leaf', bunch: 'Bunch' });
    renderCorrectionDependencies();
    correctionElement('unit').value = draft.sourceUnit || FAMILY_UNITS[correctionElement('family').value][0];
    const raw = document.getElementById('ingredient-correction-raw');
    if (raw) raw.textContent = record.raw;
    renderProvenance(recipe._provenance);
    const status = document.getElementById('ingredient-correction-review-status');
    if (status) status.textContent = correctionStatusText(record);
    clearCorrectionError();
    const pending = correctionElement('pending');
    if (pending) pending.textContent = '';
    const modal = correctionElement('modal');
    const overlay = correctionElement('overlay');
    const detailModal = document.getElementById('detail-modal');
    if (detailModal && detailModal !== modal) {
      suspendedDetailState = {
        inert: detailModal.hasAttribute?.('inert') === true,
        ariaHidden: detailModal.getAttribute?.('aria-hidden'),
        ariaModal: detailModal.getAttribute?.('aria-modal'),
      };
      detailModal.setAttribute?.('inert', '');
      detailModal.setAttribute?.('aria-hidden', 'true');
      detailModal.removeAttribute?.('aria-modal');
    }
    if (modal) {
      modal.hidden = false; modal.removeAttribute('inert'); modal.removeAttribute('aria-hidden'); modal.removeAttribute('aria-busy'); modal.setAttribute('aria-modal', 'true');
    }
    for (const key of ['close', 'cancel', 'save']) if (correctionElement(key)) correctionElement(key).disabled = false;
    if (overlay) overlay.hidden = false;
    correctionElement('name')?.focus?.();
    return true;
  }

  function closeCorrection({ restoreFocus = true } = {}) {
    if (correctionPending) return false;
    const modal = correctionElement('modal');
    const overlay = correctionElement('overlay');
    if (modal) {
      modal.setAttribute('inert', ''); modal.setAttribute('aria-hidden', 'true'); modal.removeAttribute('aria-modal'); modal.hidden = true;
    }
    if (overlay) overlay.hidden = true;
    const detailModal = document.getElementById('detail-modal');
    if (detailModal && suspendedDetailState) {
      if (suspendedDetailState.inert) detailModal.setAttribute?.('inert', '');
      else detailModal.removeAttribute?.('inert');
      if (suspendedDetailState.ariaHidden == null) detailModal.removeAttribute?.('aria-hidden');
      else detailModal.setAttribute?.('aria-hidden', suspendedDetailState.ariaHidden);
      if (suspendedDetailState.ariaModal == null) detailModal.removeAttribute?.('aria-modal');
      else detailModal.setAttribute?.('aria-modal', suspendedDetailState.ariaModal);
    }
    suspendedDetailState = null;
    const restore = correctionOpener;
    correction = null;
    correctionOpener = null;
    correctionPending = false;
    if (restoreFocus && restore?.isConnected !== false) restore?.focus?.();
  }

  function correctionFocusable() {
    return [...(correctionElement('modal')?.querySelectorAll?.('button, a[href], input, select, [tabindex]:not([tabindex="-1"])') || [])]
      .filter((element) => !element.disabled && !element.closest?.('[hidden]'));
  }

  function handleCorrectionKey(event) {
    if (correctionElement('modal')?.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
      if (!correctionPending) closeCorrection();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = correctionFocusable();
    if (!focusable.length) { event.preventDefault(); correctionElement('modal')?.focus?.(); return; }
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function correctionDraft() {
    return {
      name: correctionElement('name')?.value,
      amountState: correctionElement('state')?.value,
      amount: correctionElement('amount')?.value,
      measurementFamily: correctionElement('family')?.value,
      sourceUnit: correctionElement('unit')?.value,
      countLabel: correctionElement('countLabel')?.value,
    };
  }

  async function saveCorrection(event) {
    event?.preventDefault?.();
    if (!correction || correctionPending) return false;
    clearCorrectionError();
    const draft = correctionDraft();
    const validation = validateIngredientCorrection(draft);
    if (!validation.ok) {
      showCorrectionError(validation.error, validation.field);
      correctionElement(validation.field)?.focus?.();
      feedback.emit('blocked', { target: correctionElement('save'), interaction: feedback.contextFromEvent?.(event, correctionElement('save')) });
      return false;
    }
    if (!mutateRecipe) {
      showCorrectionError('Ingredient review is temporarily unavailable. Your recipe is unchanged.');
      return false;
    }
    const recipe = state.recipes.find((item) => String(item._id || item.id) === correction.recipeId);
    if (!recipe) { showCorrectionError('This recipe changed. Reload and try again.'); return false; }
    const interaction = feedback.contextFromEvent?.(event, correctionElement('save'));
    correctionPending = true;
    correctionElement('modal')?.setAttribute?.('aria-busy', 'true');
    for (const key of ['save', 'close', 'cancel']) if (correctionElement(key)) correctionElement(key).disabled = true;
    const pending = correctionElement('pending');
    if (pending) pending.textContent = 'Saving reviewed correction…';
    const payload = {
      id: correction.recipeId,
      ingredientId: correction.ingredientId,
      expectedUpdatedAt: Number(recipe._updatedAt) || 0,
      correction: validation.correction,
    };
    let accepted = false;
    try { accepted = await mutateRecipe('recipe.ingredient.review', payload); }
    catch { accepted = false; }
    for (const key of ['save', 'close', 'cancel']) if (correctionElement(key)) correctionElement(key).disabled = false;
    correctionElement('modal')?.removeAttribute?.('aria-busy');
    correctionPending = false;
    if (!accepted) {
      if (pending) pending.textContent = '';
      showCorrectionError('We could not save this review. Check sync status and try again.');
      feedback.emit('blocked', { target: correctionElement('save'), interaction: interaction ? { ...interaction, deferred: true } : null });
      return false;
    }
    const latest = state.recipes.find((item) => String(item._id || item.id) === correction.recipeId) || recipe;
    const pendingRecord = latest.ingredientNormalizations?.find?.((item) => item.id === correction.ingredientId);
    if (pendingRecord?.reviewedBy?.sub === 'pending') {
      pendingRecord.reviewedBy = {
        sub: state.auth?.sub || 'pending',
        name: state.household?.member?.displayName || state.auth?.name || 'You',
      };
    }
    if (!effectiveIngredientRecords(latest).some((item) => item.id === correction.ingredientId && item.reviewStatus === 'reviewed')) {
      const optimistic = applyReviewedIngredientCorrection(latest, {
        ingredientId: correction.ingredientId,
        correction: validation.correction,
        reviewer: { sub: state.auth?.sub || '', name: state.auth?.name || 'You' },
        reviewedAt: Date.now(),
      });
      if (optimistic.ok) Object.assign(latest, optimistic.recipe);
    }
    if (current?.r && String(current.r._id || current.r.id) === correction.recipeId) current.r = latest;
    const successTarget = correctionOpener || correctionElement('save');
    closeCorrection();
    renderIngredients();
    onChange?.();
    notify('Reviewed ingredient correction saved');
    feedback.emit('success', { target: successTarget, interaction: interaction ? { ...interaction, deferred: true } : null });
    return true;
  }

  function open(id) {
    const r = state.recipes.find((x) => x._id === id);
    if (!r) return false;
    const isAuthor = !r._author || !!(state.auth?.sub && r._author.sub === state.auth.sub);
    openRecipe(r, { source: 'local', author: r._author, isAuthor });
    try { localStorage.setItem('cb_detail_id', id); } catch { /* private mode */ }
    return true;
  }


  function renderIngredients() {
    const r = current && current.r;
    if (!r) return;
    const ingredients = effectiveIngredientRecords(r);
    const list = document.getElementById('dm-ingredients');
    if (list) list.innerHTML = ingredientListHTML(ingredients, state.pantry);
    const note = document.getElementById('dm-pantry-note');
    if (note) {
      const html = pantryNoteHTML(ingredients, state.pantry);
      note.style.display = html ? '' : 'none';
      if (html) note.innerHTML = html;
    }
    renderAddButtonState();
  }

  function reconcileRecipes(meta = {}) {
    if (!current?.r) return false;
    const id = String(current.r._id || current.r.id || '');
    const latest = (state.recipes || []).find((recipe) => String(recipe._id || recipe.id || '') === id);
    if (!latest) { closeSheet(); return true; }
    current.r = latest;
    if (correction && (meta.discarded || meta.refreshed || meta.authoritative)) {
      const latestRecord = effectiveIngredientRecords(latest).find((record) => record.id === correction.ingredientId);
      const changed = !latestRecord || JSON.stringify(latestRecord) !== JSON.stringify(correction.record);
      if (changed && !correctionPending) closeCorrection({ restoreFocus: false });
      else if (latestRecord) correction.record = latestRecord;
    }
    renderIngredients();
    return true;
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
    if (!correctionElement('modal')?.hidden) closeCorrection({ restoreFocus: false });
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
    let focusRestored = false;
    try { focusRestored = onClose?.() === true; } catch { /* Closing detail remains fail-safe. */ }
    if (!isAnyOpen(document)) document.body.style.overflow = '';
    state.detailId = null;
    current = null;
    try { localStorage.removeItem('cb_detail_id'); } catch { /* private mode */ }
    const restore = opener;
    opener = null;
    if (!focusRestored && restore?.isConnected !== false) {
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
      event.stopPropagation();
      event.stopImmediatePropagation?.();
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
    const reviewedIngredients = effectiveIngredientRecords(recipe);
    const lines = reviewedIngredients.map((ingredient) => ingredient.raw).filter((line) => typeof line === 'string' && line.trim());
    if (!lines.length) { notify('This recipe has no ingredients'); return false; }
    state.normalizations ||= {};
    state.normalizationAudit ||= {};
    const recipeId = String(recipe._id || recipe.id || recipe.name);
    const hasCache = cacheMatches(recipeId, lines);
    const hasReviewedCorrection = reviewedIngredients.some((ingredient) => ingredient.reviewStatus === 'reviewed');
    const ingredients = hasCache && !hasReviewedCorrection ? state.normalizations[recipeId].ingredients : reviewedIngredients;
    commitSelection(recipe, lines, ingredients);
    notify(`Added “${recipe.name}” to shopping list`);
    if (!hasCache && !hasReviewedCorrection) scheduleAudit(recipe, lines, cancellationGeneration);
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
    correctionElement('modal')?.addEventListener('keydown', handleCorrectionKey);
    correctionElement('form')?.addEventListener('submit', (event) => { void saveCorrection(event); });
    document.getElementById('ingredient-correction-close')?.addEventListener('click', () => closeCorrection());
    document.getElementById('ingredient-correction-cancel')?.addEventListener('click', () => closeCorrection());
    correctionElement('overlay')?.addEventListener('click', () => { if (!correctionPending) closeCorrection(); });
    correctionElement('state')?.addEventListener('change', renderCorrectionDependencies);
    correctionElement('family')?.addEventListener('change', renderCorrectionDependencies);
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
        const correctionAction = e.target.closest('[data-action="correct-ingredient"]');
        if (correctionAction) {
          e.preventDefault();
          e.stopPropagation();
          openCorrection(correctionAction.dataset.ingredientId, correctionAction);
          return;
        }
        const item = e.target.closest('.detail-ing-item');
        const pantryAction = e.target.closest('[data-action="toggle-ingredient-pantry"]');
        if (!item || (!pantryAction && e.target !== item) || !item.dataset.ing) return;
        const ingredient = effectiveIngredientRecords(current?.r)
          .find((record) => record.id === item.dataset.ingredientId);
        const input = normalizePantryEntry(ingredient || item.dataset.ing.toLowerCase(), { updatedAt: Date.now() });
        const { pantry, added, name, item: pantryItem } = togglePantry(state.pantry, input);
        state.pantry = pantry;
        if (mutate) void mutate(added ? 'pantry.add' : 'pantry.remove', added
          ? { item: pantryItem }
          : { id: pantryItem?.id, expectedFingerprint: pantryRecordFingerprint(pantryItem) });
        persist();
        renderIngredients();
        if (onChange) onChange();
        notify(added ? `Added "${name}" to pantry` : `Removed "${name}" from pantry`);
      });
      ings.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        if (event.target.closest?.('button, a[href], input, select, textarea, [role="button"], [role="switch"]')) return;
        const item = event.target.closest('.detail-ing-item');
        if (!item || event.target !== item) return;
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

  const initialCorrectionModal = correctionElement('modal');
  if (initialCorrectionModal) {
    initialCorrectionModal.setAttribute?.('inert', '');
    initialCorrectionModal.setAttribute?.('aria-hidden', 'true');
    initialCorrectionModal.removeAttribute?.('aria-modal');
    initialCorrectionModal.hidden = true;
  }
  const initialCorrectionOverlay = correctionElement('overlay');
  if (initialCorrectionOverlay) initialCorrectionOverlay.hidden = true;
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
    openCorrection, closeCorrection, reconcileRecipes,
    _waitForAudits: () => Promise.allSettled([...pendingAudits]),
  };
}

function isAnyOpen(document) {
  return !!document.getElementById('recipe-drawer')?.classList.contains('open')
    || !!document.getElementById('url-overlay')?.classList.contains('open')
    || !!(document.getElementById('pantry-item-modal') && !document.getElementById('pantry-item-modal').hidden);
}
