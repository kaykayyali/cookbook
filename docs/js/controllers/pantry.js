// ════════════════════════════════════════════════════════
// controllers/pantry.js — pantry add/remove + render
// ════════════════════════════════════════════════════════

import { esc } from '../lib/format.js';
import { addToPantry, removeFromPantry, normalizePantry } from '../lib/pantry.js';

/**
 * Pantry controller. Owns the pantry grid, add/remove handlers, and the
 * suggestions datalist refresh. Pure logic delegates to lib/pantry.js;
 * this file is just DOM + state wiring.
 *
 * @param {object} deps
 * @param {object} deps.state - { pantry: string[], recipes: object[] }
 * @param {Document} [deps.document]
 * @param {(pantry: string[]) => void} [deps.onChange] - called after add/remove so other panels can re-render
 * @returns {{ render: () => void, add: (raw: string) => string|null, remove: (item: string) => void }}
 */
export function initPantry({ state, document = globalThis.document, onChange = null }) {
  function render() {
    const grid = document.getElementById('pantry-grid');
    if (!grid) return;
    if (!state.pantry.length) {
      grid.innerHTML =
        '<p style="color:var(--ink-light);font-size:.85rem">Your pantry is empty. Add ingredients above to see which recipes you can make.</p>';
      return;
    }
    grid.innerHTML = [...state.pantry]
      .sort()
      .map((item) => pantryTagHTML(item))
      .join('');
  }

  function add(raw) {
    const { pantry, added, name } = addToPantry(state.pantry, raw);
    if (!name) return null;
    if (!added) return null;
    state.pantry = pantry;
    if (onChange) onChange(state.pantry);
    return name;
  }

  function remove(item) {
    state.pantry = removeFromPantry(state.pantry, item);
    if (onChange) onChange(state.pantry);
  }

  return { render, add, remove };
}

function pantryTagHTML(item) {
  return `<span class="pantry-tag">${esc(item)}
       <button class="pantry-remove" data-item="${esc(item)}" aria-label="Remove ${esc(item)}">${'<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'}</button>
     </span>`;
}
