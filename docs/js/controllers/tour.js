function storageKey(tour, subject) {
  return `cb_tour_${tour.id}_v${tour.version || 1}_${subject || 'member'}`;
}

function safeGet(storage, key) {
  try { return storage?.getItem(key); } catch { return 'complete'; }
}

function safeSet(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* private mode / blocked storage */ }
}

function buildLayer(document) {
  const layer = document.createElement('div');
  layer.className = 'tour-layer';
  layer.hidden = true;
  layer.innerHTML = `
    <div class="tour-scrim" aria-hidden="true"></div>
    <div class="tour-spotlight" aria-hidden="true" hidden></div>
    <section class="tour-dialog" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabindex="-1">
      <div class="tour-topline">
        <span class="tour-progress"></span>
        <button class="tour-skip" type="button">Skip tour</button>
      </div>
      <div class="tour-copy" aria-live="polite" aria-atomic="true">
        <h2 id="tour-title" class="tour-title"></h2>
        <p id="tour-body" class="tour-body"></p>
      </div>
      <div class="tour-actions">
        <button class="btn btn-ghost tour-back" type="button">Back</button>
        <button class="btn btn-primary tour-next" type="button">Next</button>
      </div>
    </section>`;
  document.body.append(layer);
  return layer;
}

/**
 * Generic, dependency-injected product-tour controller.
 * Tours are data registries; navigation and persistence stay framework-level.
 */
export function initTour({
  tours = [], document = globalThis.document, window = globalThis.window,
  storage = globalThis.localStorage, subject = 'member', navigate = () => {},
  getCurrentPanel = () => null,
} = {}) {
  const registry = new Map(tours.map((tour) => [tour.id, tour]));
  const layer = buildLayer(document);
  const dialog = layer.querySelector('.tour-dialog');
  const spotlight = layer.querySelector('.tour-spotlight');
  const title = layer.querySelector('.tour-title');
  const body = layer.querySelector('.tour-body');
  const progress = layer.querySelector('.tour-progress');
  const back = layer.querySelector('.tour-back');
  const nextButton = layer.querySelector('.tour-next');
  const skip = layer.querySelector('.tour-skip');
  let activeTour = null;
  let index = 0;
  let target = null;
  let targetSelector = null;
  let previousFocus = null;
  let previousPanel = null;
  let inertSiblings = [];
  const mutationObserver = window?.MutationObserver ? new window.MutationObserver(() => {
    if (!activeTour) return;
    if (window?.requestAnimationFrame) window.requestAnimationFrame(positionDialog);
    else positionDialog();
  }) : null;

  function refreshTarget() {
    const resolved = targetSelector ? document.querySelector(targetSelector) : null;
    if (resolved === target) return target;
    target?.classList?.remove('tour-target');
    target = resolved;
    target?.classList?.add('tour-target');
    return target;
  }

  function setBackgroundInert(inert) {
    if (inert) {
      inertSiblings = [...document.body.children]
        .filter((node) => node !== layer)
        .map((node) => ({ node, wasInert: Boolean(node.inert) }));
      inertSiblings.forEach(({ node }) => { node.inert = true; });
      return;
    }
    inertSiblings.forEach(({ node, wasInert }) => { node.inert = wasInert; });
    inertSiblings = [];
  }

  function positionDialog() {
    if (!activeTour || layer.hidden) return;
    refreshTarget();
    const rect = target?.getBoundingClientRect?.();
    const width = window?.innerWidth || 1024;
    const height = window?.innerHeight || 768;
    dialog.style.removeProperty('left');
    dialog.style.removeProperty('right');
    dialog.style.removeProperty('top');
    dialog.style.removeProperty('bottom');
    dialog.dataset.placement = 'center';
    const dialogRect = dialog.getBoundingClientRect();
    const unobscuredBottom = width <= 720 && dialogRect.top > 8
      ? Math.min(height - 8, dialogRect.top - 8)
      : height - 8;

    spotlight.hidden = true;
    layer.classList.remove('has-spotlight');
    if (rect?.width && rect?.height) {
      const padding = 6;
      const viewportPadding = 8;
      const left = Math.max(viewportPadding, rect.left - padding);
      const top = Math.max(viewportPadding, rect.top - padding);
      const right = Math.min(width - viewportPadding, rect.right + padding);
      const bottom = Math.min(unobscuredBottom, rect.bottom + padding);
      if (right > left && bottom > top) {
        spotlight.style.left = `${Math.round(left)}px`;
        spotlight.style.top = `${Math.round(top)}px`;
        spotlight.style.width = `${Math.round(right - left)}px`;
        spotlight.style.height = `${Math.round(bottom - top)}px`;
        spotlight.hidden = false;
        layer.classList.add('has-spotlight');
      }
    }
    if (!rect?.width || width <= 720) return;

    const gap = 18;
    const dialogWidth = dialogRect.width;
    const dialogHeight = dialogRect.height;
    if (!dialogWidth || !dialogHeight) return;
    const top = Math.max(16, Math.min(rect.top, height - dialogHeight - 16));
    if (rect.right + gap + dialogWidth <= width - 16) {
      dialog.style.left = `${Math.round(rect.right + gap)}px`;
      dialog.style.top = `${Math.round(top)}px`;
      dialog.dataset.placement = 'right';
    } else if (rect.left - gap - dialogWidth >= 16) {
      dialog.style.left = `${Math.round(rect.left - gap - dialogWidth)}px`;
      dialog.style.top = `${Math.round(top)}px`;
      dialog.dataset.placement = 'left';
    } else if (rect.bottom + gap + dialogHeight <= height - 16) {
      dialog.style.left = `${Math.round(Math.max(16, Math.min(rect.left, width - dialogWidth - 16)))}px`;
      dialog.style.top = `${Math.round(rect.bottom + gap)}px`;
      dialog.dataset.placement = 'bottom';
    } else if (rect.top - gap - dialogHeight >= 16) {
      dialog.style.left = `${Math.round(Math.max(16, Math.min(rect.left, width - dialogWidth - 16)))}px`;
      dialog.style.top = `${Math.round(rect.top - gap - dialogHeight)}px`;
      dialog.dataset.placement = 'top';
    }
  }

  function scrollTargetIntoView(reduceMotion) {
    if (!target) return;
    const behavior = reduceMotion ? 'auto' : 'smooth';
    const width = window?.innerWidth || 1024;
    if (width > 720) {
      target.scrollIntoView?.({ behavior, block: 'center' });
      return;
    }
    target.scrollIntoView?.({ behavior: 'auto', block: 'start' });
  }

  function showStep() {
    const step = activeTour.steps[index];
    navigate(step.panel);
    targetSelector = step.target || null;
    refreshTarget();
    title.textContent = step.title;
    body.textContent = step.body;
    dialog.scrollTop = 0;
    progress.textContent = `${index + 1} of ${activeTour.steps.length}`;
    back.disabled = index === 0;
    nextButton.textContent = index === activeTour.steps.length - 1 ? 'Done' : 'Next';
    positionDialog();
    const reduceMotion = window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    scrollTargetIntoView(reduceMotion);
    window?.requestAnimationFrame?.(positionDialog);
    dialog.focus();
  }

  function finish({ remember = true } = {}) {
    if (!activeTour) return;
    if (remember) safeSet(storage, storageKey(activeTour, subject), 'complete');
    target?.classList?.remove('tour-target');
    target = null;
    targetSelector = null;
    mutationObserver?.disconnect();
    spotlight.hidden = true;
    layer.classList.remove('has-spotlight');
    layer.hidden = true;
    document.body.classList.remove('tour-open');
    activeTour = null;
    setBackgroundInert(false);
    if (previousPanel) navigate(previousPanel);
    previousFocus?.focus?.();
    previousFocus = null;
    previousPanel = null;
  }

  function start(id) {
    const tour = registry.get(id);
    if (!tour?.steps?.length) return false;
    if (activeTour) finish({ remember: false });
    activeTour = tour;
    index = 0;
    previousFocus = document.activeElement;
    previousPanel = getCurrentPanel?.() || null;
    layer.hidden = false;
    document.body.classList.add('tour-open');
    setBackgroundInert(true);
    mutationObserver?.observe(document.body, { childList: true, subtree: true });
    showStep();
    return true;
  }

  function maybeStart(id) {
    const tour = registry.get(id);
    if (!tour || safeGet(storage, storageKey(tour, subject)) === 'complete') return false;
    return start(id);
  }

  function next() {
    if (!activeTour) return;
    if (index >= activeTour.steps.length - 1) { finish(); return; }
    index += 1;
    showStep();
  }

  function previous() {
    if (!activeTour || index === 0) return;
    index -= 1;
    showStep();
  }

  function onKeydown(event) {
    if (!activeTour) return;
    if (event.key === 'Escape') { event.preventDefault(); finish(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not([disabled])')];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  back.addEventListener('click', previous);
  nextButton.addEventListener('click', next);
  skip.addEventListener('click', () => finish());
  document.addEventListener('keydown', onKeydown);
  window?.addEventListener?.('resize', positionDialog);
  window?.addEventListener?.('scroll', positionDialog, true);

  return {
    start, maybeStart, next, back: previous, close: finish,
    isOpen: () => Boolean(activeTour),
    currentStep: () => activeTour?.steps[index] || null,
  };
}
