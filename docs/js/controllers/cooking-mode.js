// ════════════════════════════════════════════════════════
// controllers/cooking-mode.js — focused step-by-step cooking surface
// ════════════════════════════════════════════════════════
import { esc } from '../lib/format.js';
import { toast } from '../lib/dom.js';
import { effectiveIngredientLines } from '../lib/ingredient-corrections.js';

/**
 * Cooking mode: large-type step display, ingredient context, optional wake lock.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {function} [deps.requestWakeLock] - async, returns { release: () => {} } or null
 * @param {function} [deps.toastFn]
 */
export function initCookingMode({
  state,
  document = globalThis.document,
  requestWakeLock = defaultWakeLock,
  toastFn = toast,
} = {}) {
  let stepIndex = 0;
  let steps = [];
  let ingredients = [];
  let recipeName = '';
  let wakeLockHandle = null;
  let wakeLockEnabled = false;

  const overlay = () => document.getElementById('cooking-mode-overlay');
  const stepEl = () => document.getElementById('cooking-mode-step');
  const ingredientsEl = () => document.getElementById('cooking-mode-ingredients');
  const countEl = () => document.getElementById('cook-step-count');
  const wakeToggle = () => document.getElementById('cook-wake-toggle');

  function open(recipe) {
    stepIndex = 0;
    steps = normalizeSteps(recipe);
    ingredients = effectiveIngredientLines(recipe);
    recipeName = recipe?.name || '';
    const el = overlay();
    if (el) el.classList.add('open');
    document.body.style.overflow = 'hidden';
    render();
  }

  function close() {
    const el = overlay();
    if (el) el.classList.remove('open');
    document.body.style.overflow = '';
    releaseWakeLock();
  }

  function normalizeSteps(recipe) {
    const raw = Array.isArray(recipe?.recipeInstructions) ? recipe.recipeInstructions : [];
    const text = raw.map((step) => typeof step === 'string' ? step
      : step?.text || step?.HowToStep?.text || ''
    ).filter(Boolean);
    return text.length ? text : [];
  }

  function render() {
    const se = stepEl();
    if (se) {
      se.innerHTML = steps.length
        ? `<div class="cook-step-text" style="font-size:1.5rem;line-height:1.5">${esc(steps[stepIndex] || '')}</div>`
        : `<p class="empty-state">No steps available.</p>`;
    }
    const ie = ingredientsEl();
    if (ie) {
      ie.innerHTML = ingredients.length
        ? `<details><summary>Ingredients</summary><ul>${ingredients.map((ing) => `<li>${esc(ing)}</li>`).join('')}</ul></details>`
        : '';
    }
    const ce = countEl();
    if (ce) {
      ce.textContent = steps.length ? `${stepIndex + 1} / ${steps.length}` : '';
    }
    const wt = wakeToggle();
    if (wt) {
      wt.setAttribute('aria-pressed', String(wakeLockEnabled));
      wt.textContent = wakeLockEnabled ? 'Stay awake ✓' : 'Keep awake';
      if (wt.dataset) setTimeout(() => { wt.dataset.feedback = wakeLockEnabled ? 'toggle-off' : 'toggle-on'; }, 0);
    }
  }

  function next() {
    if (stepIndex < steps.length - 1) { stepIndex++; render(); }
  }

  function prev() {
    if (stepIndex > 0) { stepIndex--; render(); }
  }

  function stepIndexVal() { return stepIndex; }

  async function toggleWakeLock() {
    if (wakeLockEnabled) {
      releaseWakeLock();
    } else {
      try {
        wakeLockHandle = await requestWakeLock();
        wakeLockEnabled = !!wakeLockHandle;
        if (!wakeLockEnabled) toastFn('Wake lock not available on this device');
      } catch { toastFn('Wake lock not available'); }
    }
    render();
    return wakeLockEnabled;
  }

  function releaseWakeLock() {
    if (wakeLockHandle?.release) { try { wakeLockHandle.release(); } catch { /* ignore */ } }
    wakeLockHandle = null;
    wakeLockEnabled = false;
  }

  function wireControls() {
    const root = overlay();
    if (!root) return;
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'next') next();
      else if (action === 'prev') prev();
      else if (action === 'close') close();
      else if (action === 'toggle-wake') toggleWakeLock();
    });
  }

  wireControls();
  return { open, close, next, prev, stepIndex: stepIndexVal, toggleWakeLock, render };
}

function defaultWakeLock() {
  if (typeof navigator !== 'undefined' && navigator.wakeLock?.request) {
    return navigator.wakeLock.request('screen').catch(() => null);
  }
  return Promise.resolve(null);
}