// ════════════════════════════════════════════════════════
// controllers/search.js — search input, category chips, eligible-only
// ════════════════════════════════════════════════════════

/**
 * Search controller. Wires the search input, category chip bar, and
 * "ready to make" toggle. All three write to `state` and call onChange
 * so the recipe panel re-renders. Public methods (setQuery, setCategory,
 * setEligibleOnly) let other controllers (e.g. URL extract prefill) seed
 * the filters programmatically.
 *
 * @param {object} deps
 * @param {object} deps.state - { searchTerm, categoryFilter, eligibleOnly }
 * @param {Document} [deps.document]
 * @param {() => void} [deps.onChange] - fires when any filter changes
 * @returns {{
 *   setQuery: (q: string) => void,
 *   setCategory: (cat: string|null) => void,
 *   setEligibleOnly: (v: boolean) => void,
 *   _onSearchInput: (e: {target: {value: string}}) => void,
 *   _onEligibleChange: (e: {target: {checked: boolean}}) => void,
 *   _onCategoryClick: (e: {target: any}) => void,
 * }}
 */
export function initSearch({
  state,
  document = globalThis.document,
  onChange = null,
} = {}) {
  const fire = () => { if (onChange) onChange(); };

  function setQuery(q) {
    const input = document.getElementById('search-input');
    if (input) input.value = q;
    state.searchTerm = q;
    const clear = document.getElementById('search-clear');
    if (clear) clear.classList.toggle('show', !!q);
    fire();
  }

  function setCategory(cat) {
    state.categoryFilter = cat;
    const chipsContainer = document.getElementById('category-chips');
    if (chipsContainer?.querySelectorAll) {
      const chips = chipsContainer.querySelectorAll('.chip');
      chips.forEach((c) => {
        const active = c.dataset.cat === cat;
        c.classList.toggle('is-active', active);
        c.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    fire();
  }

  function setEligibleOnly(v) {
    const cb = document.getElementById('eligible-only');
    if (cb) cb.checked = v;
    state.eligibleOnly = v;
    fire();
  }

  function _onSearchInput(e) {
    const v = e?.target?.value ?? '';
    state.searchTerm = v;
    const clear = document.getElementById('search-clear');
    if (clear) clear.classList.toggle('show', !!v);
    fire();
  }

  function _onEligibleChange(e) {
    state.eligibleOnly = !!(e?.target?.checked);
    fire();
  }

  function _onCategoryClick(e) {
    const chip = e?.target?.closest?.('.chip');
    if (!chip) return;
    const chipsContainer = document.getElementById('category-chips');
    if (chipsContainer?.querySelectorAll) {
      const chips = chipsContainer.querySelectorAll('.chip');
      chips.forEach((c) => {
        const active = c === chip;
        c.classList.toggle('is-active', active);
        c.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    state.categoryFilter = chip.dataset.cat;
    fire();
  }

  return {
    setQuery, setCategory, setEligibleOnly,
    _onSearchInput, _onEligibleChange, _onCategoryClick,
  };
}
