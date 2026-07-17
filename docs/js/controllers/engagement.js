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
  cookRuntime = null,
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
    const mutationVersion = cookRuntime?.version?.();
    const result = await fetchHistory();
    if (!result.ok) { render(); return false; }
    if (cookRuntime) await cookRuntime.setAuthority(
      { events: result.events, reactions: result.reactions },
      { mutationVersion },
    );
    else {
      state.cookEvents = result.events;
      state.cookReactions = result.reactions;
    }
    render();
    return true;
  }
  async function record(recipeId, { planEntryId = null, servings = 2 } = {}) {
    if (!cookRuntime && state.offlineCache) { notify('Cooking memories need a connection'); return false; }
    const actorSub = state.auth?.sub;
    if (!actorSub || !recipeId) return false;
    const request = {
      eventId: uid(), recipeId, planEntryId, cookedAt: now(), participants: [actorSub],
      cookSub: actorSub, servings: Number(servings) || 2, occasion: '', notes: '', photoRef: null,
    };
    if (cookRuntime) {
      const timestamp = now();
      const priorPlanStatus = planEntryId
        ? state.plan?.find((entry) => entry.id === planEntryId)?.status || 'active'
        : null;
      const event = {
        id: request.eventId, recipeId, planEntryId, cookedAt: request.cookedAt,
        participants: request.participants, cookSub: actorSub, servings: request.servings,
        occasion: '', notes: '', photoUrl: '', createdBySub: actorSub,
        createdAt: timestamp, updatedAt: timestamp, deletedAt: null, revision: 1, priorPlanStatus,
      };
      const queued = await cookRuntime.mutate('cook.record', { event, request });
      if (!queued) { notify('Could not save this cooking memory'); return false; }
      render();
      onCooked(state.recipes.find((recipe) => String(recipe._id || recipe.id) === recipeId)?.name || 'dinner');
      notify('Dinner remembered ❤️');
      return true;
    }
    const result = await sendCook(request);
    if (!result.ok) { notify(result.error || 'Could not save this cooking memory'); return false; }
    state.cookEvents = [result.event, ...state.cookEvents.filter((event) => event.id !== result.event.id)];
    await refreshWorkspace();
    render();
    onCooked(state.recipes.find((recipe) => String(recipe._id || recipe.id) === recipeId)?.name || 'dinner');
    notify('Dinner remembered ❤️');
    return true;
  }
  async function react(eventId, reaction, extras = {}) {
    const input = reaction && typeof reaction === 'object' ? reaction : { reaction, ...extras };
    if (cookRuntime) {
      const event = state.cookEvents.find((item) => item.id === eventId);
      const actorSub = state.auth?.sub;
      if (!event || !actorSub) return false;
      const optimistic = {
        cookEventId: eventId, recipeId: event.recipeId, memberSub: actorSub,
        taste: input.taste ?? null, complexity: input.complexity ?? null,
        review: input.review || '', reaction: input.reaction || null,
        wouldMakeAgain: input.wouldMakeAgain ?? null, note: input.note || '',
        dismissed: input.dismissed === true, updatedAt: now(),
      };
      const queued = await cookRuntime.mutate('cook.react', { eventId, reaction: optimistic });
      if (!queued) { notify('Could not save your review'); return false; }
      render();
      return true;
    }
    const result = await sendReaction(eventId, input);
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
    const change = {
      eventId, eventRevision: current.revision, cookedAt: current.cookedAt,
      participants: current.participants, cookSub: current.cookSub, servings: current.servings,
      occasion: current.occasion || '', notes: current.notes || '', photoRef: current.photoRef || null, ...changes,
    };
    if (cookRuntime) {
      const event = { ...current, ...changes, revision: current.revision + 1, updatedAt: now() };
      const queued = await cookRuntime.mutate('cook.correct', { event, change });
      if (!queued) { notify('Could not update this cooking memory'); return false; }
      render();
      return true;
    }
    const result = await sendCorrection(change);
    if (!result.ok) { notify(result.error || 'Could not update this cooking memory'); return false; }
    state.cookEvents = state.cookEvents.map((event) => event.id === eventId ? result.event : event);
    render();
    return true;
  }
  async function remove(eventId) {
    const current = state.cookEvents.find((event) => event.id === eventId);
    if (!current) return false;
    if (cookRuntime) {
      const queued = await cookRuntime.mutate('cook.delete', {
        eventId, eventRevision: current.revision, event: current,
      });
      if (!queued) { notify('Could not remove this cooking memory'); return false; }
      render();
      return true;
    }
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
