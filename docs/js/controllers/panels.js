// ════════════════════════════════════════════════════════
// controllers/panels.js — showPanel + render dispatch
// ════════════════════════════════════════════════════════

/**
 * Panel router. Toggles `.active` on the matching `.panel` + nav-item,
 * mirrors the active panel on `body.dataset.panel` (so CSS can hide
 * topbar controls that only make sense on the recipes panel), and dispatches
 * to the registered renderer for that panel.
 *
 * @param {object} deps
 * @param {object} deps.state - shared app state
 * @param {Document} [deps.document=globalThis.document] - DOM root
 * @returns {{ showPanel: (id: string) => void, register: (id: string, fn: () => void) => void, renderActive: () => void }}
 */
export function initPanels({ state, document = globalThis.document }) {
  const renderers = new Map();
  let current = null;

  function showPanel(id) {
    current = id;
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === `panel-${id}`);
      p.classList.remove('is-active');
    });
    document.querySelectorAll('.nav-item[data-panel]').forEach((n) => {
      n.classList.toggle('active', n.dataset.panel === id);
    });
    document.body.dataset.panel = id;
    const render = renderers.get(id);
    if (render) render();
  }

  function register(id, fn) {
    renderers.set(id, fn);
  }

  function renderActive() {
    if (current && renderers.has(current)) renderers.get(current)();
  }

  return { showPanel, register, renderActive, _current: () => current };
}
