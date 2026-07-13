// ════════════════════════════════════════════════════════
// store.js — app state + persistence
//
// Recipes are stored only in the shared community D1 cookbook.
// Pantry and cart remain local (localStorage) — they're device-specific.
// ════════════════════════════════════════════════════════

import { STORAGE_KEYS } from './constants.js';
import { normalizePantry } from './pantry.js';
import { normalizeCart } from './cart.js';
import { fetchRecipes } from './api.js';

export const state = {
  recipes: [],
  pantry: [],
  cart: [],
  normalizations: {},
  editingId: null,
  detailId: null,
  searchTerm: '',
  categoryFilter: '',
  eligibleOnly: false,
  recipesLoaded: false,
  authChecked: false,
};

/** Persist pantry + cart to localStorage (recipes are server-side). */
export function save() {
  localStorage.setItem(STORAGE_KEYS.pantry, JSON.stringify(state.pantry));
  localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(state.cart));
  localStorage.setItem(STORAGE_KEYS.normalizations, JSON.stringify(state.normalizations));
}

/** Load pantry + cart from localStorage. */
export function load() {
  try {
    state.pantry = normalizePantry(JSON.parse(localStorage.getItem(STORAGE_KEYS.pantry) || '[]'));
  } catch {
    state.pantry = [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cart);
    const parsed = raw ? JSON.parse(raw) : [];
    state.cart = normalizeCart(parsed);
  } catch {
    state.cart = [];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.normalizations) || '{}');
    state.normalizations = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    state.normalizations = {};
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
  state.recipes = res.recipes || [];
  state.recipesLoaded = true;
  return true;
}

/** Initialize localStorage data (pantry + cart). Recipes loaded later via loadRecipes(). */
export function init() {
  load();
}
