// ════════════════════════════════════════════════════════
// controllers/community.js — Community feed panel
// ════════════════════════════════════════════════════════
import { toast } from '../lib/dom.js';
import { getToken, initGoogleSignIn } from '../lib/auth.js';
import { fetchCommunity, communityState, toLocalCopy, saveCommunityRecipe, deleteCommunityRecipe, shareRecipe as shareToCommunity } from '../lib/community.js';
import { communityCardHTML, communityEmptyHTML } from '../components/communityCard.js';
import { save as persist } from '../lib/store.js';
import { createRecipe } from '../lib/api.js';
import { esc } from '../lib/format.js';

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
 * @param {() => void} [deps.onRefreshLibrary] - fired after Save to my library so the Recipes panel re-renders
 * @param {Document} [deps.document]
 * @returns {{ render, loadFirst, loadMore, refresh, saveToLocal, deleteShared, share }}
 */
export function initCommunity({ state, panels, onOpenCommunityDetail = null, onSignedOut = null, onRefreshLibrary = null, document = globalThis.document }) {
  state.community = state.community || communityState;

  function render() {
    const grid = document.getElementById('community-grid');
    if (!grid) return;
    if (!getToken()) {
      grid.innerHTML = `<div class="empty-state"><strong>Sign in to see the Community</strong><p>Shared recipes from everyone in your group appear here.</p><div id="g-signin-btn"></div></div>`;
      initGoogleSignIn({
        buttonEl: document.getElementById('g-signin-btn'),
        clientId: typeof window !== 'undefined' ? window.COOKBOOK_GOOGLE_CLIENT_ID : undefined,
        onSignedIn: (email) => { state.auth = { sub: state.auth?.sub || null, email }; loadFirst(); },
        onError: (msg) => toast(`Sign-in failed: ${msg}`),
      });
      return;
    }
    if (state.community.error) {
      grid.innerHTML = `<div class="empty-state"><strong>Community needs a connection</strong><p>${esc(state.community.error)}</p></div>`;
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
    state.community.loaded = true;
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

  async function saveToLocal(ctx) {
    // ctx = { id } — fetch the canonical recipe, copy into the user's personal recipes.
    const getRes = await saveCommunityRecipe(ctx.id, { onUnauthorized: () => onSignedOut && onSignedOut() });
    if (!getRes.ok) { toast(getRes.error || 'Could not save'); return { ok: false, error: getRes.error }; }
    const copy = toLocalCopy(getRes.recipe);
    // Create on the server
    const res = await createRecipe(copy);
    if (!res.ok) { toast(res.error || 'Could not save to library'); return { ok: false, error: res.error }; }
    copy._id = res.id;
    state.recipes.unshift(copy);
    persist();
    if (onRefreshLibrary) onRefreshLibrary();
    toast('Saved to your library');
    return { ok: true };
  }

  async function deleteShared(ctx) {
    const res = await deleteCommunityRecipe(ctx.id, { onUnauthorized: () => onSignedOut && onSignedOut() });
    if (!res.ok) { toast(res.error || 'Could not delete'); return { ok: false, error: res.error }; }
    state.community.recipes = state.community.recipes.filter((x) => x.id !== ctx.id);
    render();
    toast('Shared recipe deleted');
    return { ok: true };
  }

  async function share(recipe) {
    if (!state.auth || !state.auth.sub) { toast('Sign in to share to Community'); return { ok: false, error: 'not_signed_in' }; }
    const res = await shareToCommunity(recipe, { onUnauthorized: () => onSignedOut && onSignedOut() });
    if (!res.ok) { toast(res.error || 'Could not share'); return { ok: false, error: res.error }; }
    await loadFirst(); // refresh the feed so the new card appears
    toast('Shared to Community');
    return { ok: true };
  }

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

  panels.register('community', () => {
    // First show (signed in) fetches the feed; subsequent shows render from
    // state. Signed-out shows the sign-in empty state via render() which also
    // mounts the GIS button (re-render on each show so it reappears if the
    // user signs out and comes back).
    if (!state.community.loaded && getToken()) loadFirst();
    else render();
  });
  wireGrid();
  return { render, loadFirst, loadMore, refresh, saveToLocal, deleteShared, share };
}