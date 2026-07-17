const plural = (count, noun) => `${noun}${count === 1 ? '' : 's'}`;

export function createSyncStatusPresenter({
  banner,
  messageSelector,
  retrySelector,
  discardSelector,
  delayMs = 2_000,
  noun = 'change',
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
} = {}) {
  let timer = null;
  let latest = { status: 'synced', pending: 0 };

  const message = () => banner?.querySelector?.(messageSelector);
  const recoveryControls = (visible, discardable = visible) => {
    banner?.querySelector?.(retrySelector)?.toggleAttribute('hidden', !visible);
    banner?.querySelector?.(discardSelector)?.toggleAttribute('hidden', !visible || !discardable);
  };
  const hide = () => {
    if (banner) banner.hidden = true;
    recoveryControls(false);
  };
  const clearTimer = () => {
    if (timer != null) cancel(timer);
    timer = null;
  };
  const showDelayed = () => {
    timer = null;
    const count = Number(latest.pending) || 0;
    if (!count || latest.status === 'synced') return hide();
    if (banner) banner.hidden = false;
    const target = message();
    if (target) target.textContent = latest.status === 'offline'
      ? `Offline — ${count} saved ${plural(count, noun)} waiting.`
      : `Still syncing ${count} saved ${plural(count, noun)}…`;
    recoveryControls(Boolean(latest.sequence), latest.discardable !== false);
  };
  const scheduleDelayed = () => {
    if (timer == null) timer = schedule(showDelayed, delayMs);
  };

  return {
    update(value = {}) {
      latest = { ...value, status: value.status || value.state || 'synced' };
      const count = Number(latest.pending) || 0;
      if (latest.status === 'synced' || !count) {
        clearTimer();
        hide();
        return;
      }
      if (latest.status === 'failed' || latest.status === 'blocked') {
        clearTimer();
        if (banner) banner.hidden = false;
        const target = message();
        if (target) target.textContent = `A saved ${noun} needs attention (${count} pending).`;
        recoveryControls(true, latest.discardable !== false);
        return;
      }
      scheduleDelayed();
    },
    destroy() {
      clearTimer();
      hide();
    },
  };
}
