// ════════════════════════════════════════════════════════
// theme.js — theme storage + <html data-theme> applier
// ════════════════════════════════════════════════════════

import { STORAGE_KEYS } from './constants.js';

const VALID = new Set(['light', 'dark', 'sepia', 'forest', 'ocean']);

/**
 * Build a theme helper bound to a storage + document pair. Testable without
 * a DOM. The default `storage` is `localStorage`, the default `document` is
 * the global one. Either being undefined is a safe no-op.
 *
 * @param {{ storage?: Storage, document?: { documentElement: { setAttribute(k: string, v: string): void, getAttribute(k: string): string | null } } }} [opts]
 */
export function createTheme(opts = {}) {
  // ponytail: shadowing the global `document` with a local trips Node's TDZ when the
  // singleton at the bottom of this file runs at module load with no args. Aliasing
  // to `doc` keeps the brief's intent (a document-like object) without the collision.
  const storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  const doc = opts.document ?? (typeof document !== 'undefined' ? document : undefined);

  function normalize(v) {
    return VALID.has(v) ? v : null;
  }

  return {
    /** @returns {'light' | 'dark' | null} */
    getStored() {
      if (!storage) return null;
      try {
        return normalize(storage.getItem(STORAGE_KEYS.theme));
      } catch {
        return null;
      }
    },
    /** @param {'light' | 'dark'} name */
    apply(name) {
      const v = normalize(name);
      if (!v || !doc) return;
      try { doc.documentElement.setAttribute('data-theme', v); } catch { /* ignore */ }
    },
    /** @param {'light' | 'dark'} name */
    set(name) {
      const v = normalize(name);
      if (!v || !storage) return;
      try { storage.setItem(STORAGE_KEYS.theme, v); } catch { /* ignore */ }
    },
  };
}

/** Default singleton — `app.js` and the inline head script both use this. */
export const theme = createTheme();