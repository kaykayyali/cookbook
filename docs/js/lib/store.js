// ════════════════════════════════════════════════════════
// store.js — app state + persistence
//
// Shared recipes and workspace state are authoritative in D1 and cached in IndexedDB.
// localStorage is used only for derived ingredient-normalization data.
// ════════════════════════════════════════════════════════

import { STORAGE_KEYS } from './constants.js';
import { ensureHouseholdMembership, fetchRecipes, fetchWorkspace } from './api.js';
import { normalizePantry, normalizePantryEntry } from './pantry.js';
import { publishRecipeAuthority } from './recipe-authority.js';

export const state = {
  household: null,
  householdEligible: false,
  recipes: [],
  recipeAuthorityVersion: 0,
  pantry: [],
  cart: [],
  normalizations: {},
  normalizationAudit: {},
  shoppingChecked: {},
  plan: [],
  manualItems: [],
  cookEvents: [],
  cookReactions: [],
  workspaceRevision: 0,
  workspaceLoaded: false,
  editingId: null,
  detailId: null,
  searchTerm: '',
  categoryFilter: '',
  eligibleOnly: false,
  recipesLoaded: false,
  authChecked: false,
};

/** Resolve or accept the signed-in user's private household membership. */
export async function loadHousehold({ onUnauthorized, resolve = ensureHouseholdMembership } = {}) {
  const result = await resolve({ onUnauthorized });
  if (!result.ok || !result.membership) {
    state.household = null;
    state.householdEligible = false;
    return false;
  }
  state.household = result.membership;
  state.householdEligible = result.eligible === true;
  return true;
}

/** Persist device-local derived normalization data. */
export function save() {
  localStorage.setItem(STORAGE_KEYS.normalizations, JSON.stringify(state.normalizations));
  localStorage.setItem(STORAGE_KEYS.normalizationAudit, JSON.stringify(state.normalizationAudit));
}

/** Load device-local derived normalization data. */
export function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.normalizations) || '{}');
    state.normalizations = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    state.normalizations = {};
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.normalizationAudit) || '{}');
    state.normalizationAudit = typeof parsed?.signature === 'string' ? { signature: parsed.signature } : {};
  } catch {
    state.normalizationAudit = {};
  }

}

/**
 * Load recipes from the server. Called after auth is confirmed.
 * @param {{ onUnauthorized?: () => void }} opts
 * @returns {Promise<boolean>} true if recipes loaded (may be empty, including seeded)
 */
export async function loadRecipes({ onUnauthorized } = {}) {
  const res = await fetchRecipes({ onUnauthorized });
  if (!res.ok) {
    state.recipesLoaded = false;
    return false;
  }
  publishRecipeAuthority(state, res.recipes || []);
  state.recipesLoaded = true;
  return true;
}

export function applyWorkspace(workspace, target = state) {
  if (!workspace || workspace.revision < target.workspaceRevision) return false;
  target.workspaceRevision = workspace.revision;
  target.plan = workspace.plan;
  target.cart = workspace.cart;
  target.pantry = normalizePantry(workspace.pantry, { updatedAt: Number(workspace.updatedAt) || 0 });
  target.shoppingChecked = workspace.shoppingChecked;
  target.manualItems = (Array.isArray(workspace.manualItems) ? workspace.manualItems : []).flatMap((item) => {
    const normalized = normalizePantryEntry(item);
    return item?.id && normalized ? [{ ...normalized, id: String(item.id), checked: item.checked === true }] : [];
  });
  target.workspaceLoaded = true;
  return true;
}

export async function loadWorkspace({ onUnauthorized, fetch = fetchWorkspace } = {}) {
  const result = await fetch({ onUnauthorized });
  if (!result.ok || !result.workspace) {
    state.workspaceLoaded = false;
    return false;
  }
  return applyWorkspace(result.workspace);
}

/** Initialize device-local derived data. Shared state loads from D1/IndexedDB later. */
export function init() {
  load();
}
