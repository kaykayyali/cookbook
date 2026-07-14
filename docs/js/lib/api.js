// ════════════════════════════════════════════════════════
// api.js — Primary cookbook API (community D1 only)
// ════════════════════════════════════════════════════════
import {
  fetchCommunity,
  shareRecipe,
  editCommunityRecipe,
  deleteCommunityRecipe,
  mapCommunityItem,
} from './community.js';
import { authFetch } from './auth.js';
import { isNormalizedIngredient } from './cart.js';
import { isWorkspace } from './workspace-sync.js';

function isHouseholdMembership(value) {
  return typeof value?.household?.id === 'string'
    && typeof value.household.name === 'string'
    && typeof value?.member?.id === 'string'
    && typeof value.member.displayName === 'string'
    && (value.member.role === 'owner' || value.member.role === 'member');
}

/** Resolve the signed-in user's household, accepting their private invite once. */
export async function ensureHouseholdMembership({ onUnauthorized, request = authFetch } = {}) {
  try {
    const statusResponse = await request('/household', {}, { onUnauthorized });
    if (!statusResponse.ok) return { ok: false, error: 'household_unavailable' };
    const status = await statusResponse.json().catch(() => null);
    if (isHouseholdMembership(status)) {
      return { ok: true, membership: status, eligible: true };
    }
    const onboarding = status?.household === null && status?.member === null
      && typeof status?.eligible === 'boolean';
    if (!onboarding) return { ok: false, error: 'invalid_household' };
    if (!status.eligible) return { ok: false, error: 'household_not_invited' };

    const joinResponse = await request('/household', { method: 'POST' }, { onUnauthorized });
    if (!joinResponse.ok) return { ok: false, error: 'household_join_failed' };
    const membership = await joinResponse.json().catch(() => null);
    if (!isHouseholdMembership(membership)) return { ok: false, error: 'invalid_household' };
    return { ok: true, membership, eligible: true };
  } catch {
    return { ok: false, error: 'household_unavailable' };
  }
}

/** Ask Workers AI to review one complete recipe set in a single interpretation call. */
export async function normalizeRecipeIngredients(recipes, { onUnauthorized } = {}) {
  const input = Array.isArray(recipes) ? recipes : [];
  const totalLines = input.reduce((sum, recipe) => sum + (Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0), 0);
  if (!input.length || totalLines > 100 || JSON.stringify(input).length > 30_000) throw new Error('normalization_input_too_large');
  const res = await authFetch('/normalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: input }),
  }, { onUnauthorized });
  if (!res.ok) throw new Error('normalization_unavailable');
  const data = await res.json();
  if (data.version !== 2 || !Array.isArray(data.recipes) || data.recipes.length !== input.length) throw new Error('invalid_normalization');
  data.recipes.forEach((result, recipeIndex) => {
    const source = input[recipeIndex];
    if (result.recipeId !== source.recipeId || !Array.isArray(result.ingredients)
        || result.ingredients.length !== source.ingredients.length
        || result.ingredients.some((item, ingredientIndex) => !isNormalizedIngredient(item)
          || typeof item.displayName !== 'string' || typeof item.countLabel !== 'string' || typeof item.category !== 'string'
          || !Number.isFinite(item.confidence) || item.raw !== source.ingredients[ingredientIndex])) {
      throw new Error('invalid_normalization');
    }
  });
  return data.recipes;
}

/** Fetch the complete shared cookbook and map D1 rows to the internal model. */
export async function fetchRecipes({ onUnauthorized } = {}) {
  const recipes = [];
  let cursor = null;
  do {
    const res = await fetchCommunity({ cursor, limit: 100, onUnauthorized });
    if (!res.ok) return { ok: false, error: res.error || 'fetch_failed' };
    recipes.push(...res.recipes.map(mapCommunityItem));
    cursor = res.nextCursor;
  } while (cursor);
  return { ok: true, recipes };
}

/** Create a recipe directly in the shared cookbook. */
export async function createRecipe(recipe, { onUnauthorized } = {}) {
  const res = await shareRecipe(recipe, { onUnauthorized });
  return res.ok ? { ok: true, item: res.recipe } : res;
}

/** Update a shared recipe; the server enforces author ownership. */
export async function updateRecipe(id, recipe, { onUnauthorized } = {}) {
  const res = await editCommunityRecipe(id, recipe, { onUnauthorized });
  return res.ok ? { ok: true, item: res.recipe } : res;
}

/** Delete a shared recipe; the server enforces author ownership. */
export function deleteRecipeById(id, { onUnauthorized } = {}) {
  return deleteCommunityRecipe(id, { onUnauthorized });
}

export async function fetchCookHistory({ onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/cooks', {}, { onUnauthorized });
    if (!response.ok) return { ok: false, error: 'cook_history_unavailable' };
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.events) || !Array.isArray(data?.reactions)) return { ok: false, error: 'invalid_cook_history' };
    return { ok: true, events: data.events, reactions: data.reactions };
  } catch { return { ok: false, error: 'cook_history_unavailable' }; }
}

export async function markCooked(event, { onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/cooks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
    }, { onUnauthorized });
    const data = await response.json().catch(() => null);
    return response.ok && data?.event ? { ok: true, event: data.event } : { ok: false, error: data?.error || 'cook_history_unavailable' };
  } catch { return { ok: false, error: 'cook_history_unavailable' }; }
}

export async function saveCookReaction(eventId, reaction, { onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/cooks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, reaction }),
    }, { onUnauthorized });
    const data = await response.json().catch(() => null);
    return response.ok && data?.reaction ? { ok: true, reaction: data.reaction } : { ok: false, error: data?.error || 'reaction_unavailable' };
  } catch { return { ok: false, error: 'reaction_unavailable' }; }
}

async function changeCookHistory(method, payload, { onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/cooks', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }, { onUnauthorized });
    const data = await response.json().catch(() => null);
    return response.ok && data?.event ? { ok: true, event: data.event } : { ok: false, status: response.status, error: data?.error || 'cook_history_unavailable' };
  } catch { return { ok: false, error: 'cook_history_unavailable' }; }
}

export function correctCookHistory(change, options = {}) {
  return changeCookHistory('PATCH', { ...change, action: 'correct' }, options);
}

export function deleteCookHistory(eventId, eventRevision, options = {}) {
  return changeCookHistory('DELETE', { eventId, eventRevision }, options);
}

/** Import canonical JSON-LD recipes into the shared cookbook. */
export async function importRecipes(recipes, { onUnauthorized } = {}) {
  let imported = 0;
  for (const recipe of recipes) {
    const res = await shareRecipe(recipe, { onUnauthorized });
    if (res.ok) imported++;
  }
  return { ok: true, imported };
}

export async function fetchWorkspace({ onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/workspace', {}, { onUnauthorized });
    if (!response.ok) return { ok: false, status: response.status, error: 'workspace_unavailable' };
    const workspace = await response.json().catch(() => null);
    return isWorkspace(workspace)
      ? { ok: true, workspace }
      : { ok: false, error: 'invalid_workspace' };
  } catch {
    return { ok: false, error: 'workspace_unavailable' };
  }
}

export async function mutateWorkspace(mutation, { onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/workspace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mutation),
    }, { onUnauthorized });
    const body = await response.json().catch(() => null);
    if (response.ok && isWorkspace(body)) return { ok: true, workspace: body };
    if (response.status === 409 && isWorkspace(body?.workspace)) {
      return { ok: false, status: 409, error: 'revision_conflict', workspace: body.workspace };
    }
    return { ok: false, status: response.status, error: body?.error || 'workspace_unavailable' };
  } catch {
    return { ok: false, error: 'workspace_unavailable' };
  }
}

export async function sendRecipeMutation(mutation, { onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/recipe-mutations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation),
    }, { onUnauthorized });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.recipes)) {
      return { ok: false, status: response.status, error: body.error || 'recipe_mutation_failed' };
    }
    return { ok: true, recipes: body.recipes.map(mapCommunityItem) };
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }
}

// ── Recipe import drafts (image capture) ──

export async function fetchImportDrafts({ onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/import-drafts', {}, { onUnauthorized });
    if (!response.ok) return { ok: false, error: 'import_draft_unavailable' };
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.drafts)) return { ok: false, error: 'invalid_import_drafts' };
    return { ok: true, drafts: data.drafts };
  } catch { return { ok: false, error: 'import_draft_unavailable' }; }
}

export async function createImportDraft(input, { onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/import-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }, { onUnauthorized });
    const data = await response.json().catch(() => null);
    return response.ok ? { ok: true, draft: data } : { ok: false, error: data?.error || 'import_draft_unavailable' };
  } catch { return { ok: false, error: 'import_draft_unavailable' }; }
}

export async function patchImportDraft(id, action, payload = {}, { onUnauthorized, request = authFetch } = {}) {
  try {
    const response = await request('/import-drafts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, ...payload }),
    }, { onUnauthorized });
    const data = await response.json().catch(() => null);
    return response.ok ? { ok: true, ...data } : { ok: false, ...(data || {}), error: data?.error || 'import_draft_unavailable' };
  } catch { return { ok: false, error: 'import_draft_unavailable' }; }
}
