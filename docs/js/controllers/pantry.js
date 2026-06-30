// ════════════════════════════════════════════════════════
// controllers/pantry.js — pantry add/remove + render
// ════════════════════════════════════════════════════════

import { esc } from '../lib/format.js';
import { addToPantry, removeFromPantry } from '../lib/pantry.js';
import { save as persist } from '../lib/store.js';
import { toast } from '../lib/dom.js';

/**
 * Pantry controller. Owns the pantry grid, add/remove handlers, and the
 * suggestions datalist refresh.
 *
 * @param {object} deps
 * @param {object} deps.state - { pantry, recipes }
 * @param {Document} [deps.document]
 * @param {() => void} [deps.onChange] - called after add/remove
 * @returns {{ render: () => void, add: (raw) => string|null, remove: (item) => void }}
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
    persist();
    render();
    if (onChange) onChange();
    toast(`Added "${name}"`);
    return name;
  }

  function addFromInput() {
    const inp = document.getElementById('pantry-input');
    if (!inp) return;
    add(inp.value);
    inp.value = '';
    inp.focus();
  }

  function remove(item) {
    state.pantry = removeFromPantry(state.pantry, item);
    persist();
    render();
    if (onChange) onChange();
    toast(`Removed "${item}"`);
  }

  function wireGrid() {
    const grid = document.getElementById('pantry-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.pantry-remove');
        if (!btn) return;
        remove(btn.dataset.item);
      });
    }
    const addBtn = document.getElementById('pantry-add-btn');
    if (addBtn) addBtn.addEventListener('click', addFromInput);
    const inp = document.getElementById('pantry-input');
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
      });
    }
  }

  wireGrid();
  return { render, add, addFromInput, remove };
}

function pantryTagHTML(item) {
  return `<span class="pantry-tag">${esc(item)}
       <button class="pantry-remove" data-item="${esc(item)}" aria-label="Remove ${esc(item)}">${'<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'}</button>
     </span>`;
}
