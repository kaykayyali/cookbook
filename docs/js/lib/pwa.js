const GUIDE_KEY = 'cookbook_pwa_guide_seen_v1';

export function initPwa({
  navigator = globalThis.navigator,
  window = globalThis.window,
  document = globalThis.document,
  storage = globalThis.localStorage,
} = {}) {
  const update = document?.getElementById('pwa-update');
  const guide = document?.getElementById('pwa-install-guide');
  const standalone = window?.matchMedia?.('(display-mode: standalone)').matches || navigator?.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator?.userAgent || '');
  const seen = (() => { try { return storage?.getItem(GUIDE_KEY) === '1'; } catch { return true; } })();
  if (guide && ios && !standalone && !seen) {
    guide.hidden = false;
    guide.innerHTML = '<span>Install our cookbook: tap Share, then <strong>Add to Home Screen</strong>.</span><button class="btn btn-ghost btn-sm" type="button">Got it</button>';
    guide.querySelector('button')?.addEventListener('click', () => {
      guide.hidden = true;
      try { storage?.setItem(GUIDE_KEY, '1'); } catch { /* storage can be unavailable */ }
    });
  }
  if (!navigator?.serviceWorker) return Promise.resolve(null);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  const showUpdate = (registration) => {
    if (!update || !registration.waiting) return;
    update.hidden = false;
    update.querySelector('button')?.addEventListener('click', () => registration.waiting.postMessage({ type: 'SKIP_WAITING' }), { once: true });
  };
  return navigator.serviceWorker.register('./sw.js').then((registration) => {
    showUpdate(registration);
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', () => {
        if (registration.installing?.state === 'installed' && navigator.serviceWorker.controller) showUpdate(registration);
      });
    });
    return registration;
  }).catch(() => null);
}
