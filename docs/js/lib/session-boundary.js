export function requiresSessionReload(bootedSub, nextSub) {
  return typeof bootedSub === 'string' && bootedSub.length > 0 && bootedSub !== nextSub;
}
