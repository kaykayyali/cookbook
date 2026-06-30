// ════════════════════════════════════════════════════════
// controllers/community.js — Community feed panel
// ════════════════════════════════════════════════════════
import { toast } from '../lib/dom.js';
import { getToken } from '../lib/auth.js';
import { fetchCommunity, communityState } from '../lib/community.js';
import { communityCardHTML, communityEmptyHTML } from '../components/communityCard.js';

/**
 * Community panel controller. Owns #community-grid: lists shared recipes with
 * author badges, loads more on demand, and routes card clicks to the detail
 * controller's openCommunity(item). Requires sign-in.
 *
 * @param {object} deps
 * @param {object} deps.state
 * @param {object} deps.panels - { register(id, fn) } from controllers/panels.js
 * @param {(item: object) => void} [deps.onOpenCommunityDetail]
 * @param {() => void} [deps.onSignedOut] - fired when the server returns 401
 * @param {Document} [deps.document]
 * @returns {{ render, loadFirst, loadMore, refresh }}
 */
export function initCommunity({ state, panels, onOpenCommunityDetail = null, onSignedOut = null, document = globalThis.document }) {
  state.community = state.community || communityState;

  function render() {
    const grid = document.getElementById('community-grid');
    if (!grid) return;
    if (!getToken()) {
      grid.innerHTML = `<div class="empty-state"><strong>Sign in to see the Community</strong><p>Shared recipes from everyone in your group appear here.</p></div>`;
      return;
    }
    if (state.community.error) {
      grid.innerHTML = `<div class="empty-state"><strong>Community needs a connection</strong><p>${state.community.error}</p></div>`;
      return;
    }
    if (!state.community.recipes.length && !state.community.loading) {
      grid.innerHTML = communityEmptyHTML();
      return;
    }
    grid.innerHTML = state.community.recipes.map(communityCardHTML).join('');
    const more = document.getElementById('community-load-more');
    if (more) more.style.display = state.community.hasMore ? '' : 'none';
  }

  async function loadFirst() {
    if (!getToken()) { render(); return; }
    state.community.loading = true; state.community.error = null;
    render();
    const res = await fetchCommunity({ onUnauthorized: () => { state.community.error = 'Please sign in again.'; if (onSignedOut) onSignedOut(); } });
    state.community.loading = false;
    if (!res.ok) { state.community.error = res.error || 'Could not load the Community.'; render(); return; }
    state.community.recipes = res.recipes;
    state.community.nextCursor = res.nextCursor;
    state.community.hasMore = !!res.nextCursor;
    render();
  }

  async function loadMore() {
    if (!state.community.hasMore || state.community.loading) return;
    state.community.loading = true; render();
    const res = await fetchCommunity({ cursor: state.community.nextCursor, onUnauthorized: () => onSignedOut && onSignedOut() });
    state.community.loading = false;
    if (!res.ok) { state.community.error = res.error || 'Could not load more.'; render(); return; }
    state.community.recipes = state.community.recipes.concat(res.recipes);
    state.community.nextCursor = res.nextCursor;
    state.community.hasMore = !!res.nextCursor;
    render();
  }

  function refresh() { return loadFirst(); }

  function wireGrid() {
    const grid = document.getElementById('community-grid');
    if (grid) grid.addEventListener('click', (e) => {
      const card = e.target.closest('.community-card');
      if (card && onOpenCommunityDetail) {
        const item = state.community.recipes.find((x) => x.id === card.dataset.id);
        if (item) onOpenCommunityDetail(item);
      }
    });
    const more = document.getElementById('community-load-more');
    if (more) more.addEventListener('click', loadMore);
  }

  panels.register('community', render);
  wireGrid();
  return { render, loadFirst, loadMore, refresh };
}