import { esc } from '../lib/format.js';
import {
  correctCookHistory, deleteCookHistory, fetchCookHistory, markCooked, saveCookReaction,
} from '../lib/api.js';
import { pickForUs } from '../lib/suggestions.js';
import { toast } from '../lib/dom.js';

const laneLabel = { reliable: 'Reliable favorite', different: 'Something different', quick: 'Quick option' };
const uid = () => globalThis.crypto?.randomUUID?.() || `cook-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function suggestionsHTML(picks) {
  if (!picks.length) return '<p class="empty-state">Add a few recipes and memories, then we’ll pick together.</p>';
  return picks.map((pick) => `<article class="suggestion-card" data-recipe-id="${esc(pick.recipe._id || pick.recipe.id)}">
    <small>${laneLabel[pick.lane]}</small><strong>${esc(pick.recipe.name)}</strong><p>${esc(pick.reason)}</p>
    <button class="btn btn-ghost btn-sm" data-action="open-suggestion">View recipe</button>
  </article>`).join('');
}

export function initEngagement({
  state,
  document = globalThis.document,
  fetchHistory = (options) => fetchCookHistory(options),
  sendCook = (payload) => markCooked(payload),
  sendReaction = (eventId, reaction) => saveCookReaction(eventId, reaction),
  sendCorrection = (change) => correctCookHistory(change),
  sendDeletion = (eventId, revision) => deleteCookHistory(eventId, revision),
  refreshWorkspace = async () => {},
  onOpenRecipe = () => {},
  onCooked = () => {},
  notify = toast,
  now = () => Date.now(),
} = {}) {
  state.cookEvents ||= [];
  state.cookReactions ||= [];
  const root = document?.getElementById?.('pick-for-us');
  const picks = () => pickForUs({
    recipes: state.recipes || [], events: state.cookEvents, reactions: state.cookReactions, now: now(),
    preferences: state.suggestionPreferences || {},
  });
  const render = () => { if (root) root.innerHTML = suggestionsHTML(picks()); };
  async function load() {
    const result = await fetchHistory();
    if (!result.ok) { render(); return false; }
    state.cookEvents = result.events;
    state.cookReactions = result.reactions;
    render();
    return true;
  }
  async function record(recipeId, { planEntryId = null, servings = 2 } = {}) {
    if (state.offlineCache) { notify('Cooking memories need a connection'); return false; }
    const actorSub = state.auth?.sub;
    if (!actorSub || !recipeId) return false;
    const result = await sendCook({
      eventId: uid(), recipeId, planEntryId, cookedAt: now(), participants: [actorSub],
      cookSub: actorSub, servings: Number(servings) || 2, notes: '', photoRef: null,
    });
    if (!result.ok) { notify(result.error || 'Could not save this cooking memory'); return false; }
    state.cookEvents = [result.event, ...state.cookEvents.filter((event) => event.id !== result.event.id)];
    await refreshWorkspace();
    render();
    onCooked(state.recipes.find((recipe) => String(recipe._id || recipe.id) === recipeId)?.name || 'dinner');
    notify('Dinner remembered ❤️');
    return true;
  }
  async function react(eventId, reaction, extras = {}) {
    const result = await sendReaction(eventId, { reaction, ...extras });
    if (!result.ok) { notify(result.error || 'Could not save your reaction'); return false; }
    state.cookReactions = [
      ...state.cookReactions.filter((item) => !(item.cookEventId === eventId && item.memberSub === result.reaction.memberSub)),
      result.reaction,
    ];
    render();
    return true;
  }
  async function correct(eventId, changes = {}) {
    const current = state.cookEvents.find((event) => event.id === eventId);
    if (!current) return false;
    const result = await sendCorrection({
      eventId, eventRevision: current.revision, cookedAt: current.cookedAt,
      participants: current.participants, cookSub: current.cookSub, servings: current.servings,
      notes: current.notes || '', photoRef: current.photoRef || null, ...changes,
    });
    if (!result.ok) { notify(result.error || 'Could not update this cooking memory'); return false; }
    state.cookEvents = state.cookEvents.map((event) => event.id === eventId ? result.event : event);
    render();
    return true;
  }
  async function remove(eventId) {
    const current = state.cookEvents.find((event) => event.id === eventId);
    if (!current) return false;
    const result = await sendDeletion(eventId, current.revision);
    if (!result.ok) { notify(result.error || 'Could not remove this cooking memory'); return false; }
    state.cookEvents = state.cookEvents.filter((event) => event.id !== eventId);
    state.cookReactions = state.cookReactions.filter((reaction) => reaction.cookEventId !== eventId);
    await refreshWorkspace();
    render();
    return true;
  }
  root?.addEventListener?.('click', (event) => {
    const button = event.target.closest('[data-action="open-suggestion"]');
    const id = button?.closest('[data-recipe-id]')?.dataset.recipeId;
    if (id) onOpenRecipe(id);
  });
  render();
  return {
    load, render, picks, react, correct, remove,
    markPlan: (entry) => record(entry.recipeId, { planEntryId: entry.id, servings: entry.targetServings }),
    markRecipe: (recipe) => record(String(recipe?._id || recipe?.id || ''), { servings: Number.parseFloat(recipe?.recipeYield) || 2 }),
    history: (recipeId) => state.cookEvents.filter((event) => event.recipeId === recipeId && !event.deletedAt),
  };
}
