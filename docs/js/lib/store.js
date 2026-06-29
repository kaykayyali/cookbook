// ════════════════════════════════════════════════════════
// store.js — app state + localStorage persistence
// ════════════════════════════════════════════════════════

import { STORAGE_KEYS, SEED_RECIPES, SEED_PANTRY } from './constants.js';
import { fromSchema } from './schema.js';
import { normalizePantry } from './pantry.js';

export const state = {
  recipes: [],
  pantry: [],
  cart: [],
  editingId: null,
  detailId: null,
  searchTerm: '',
  categoryFilter: '',
  eligibleOnly: false,
};

export function save() {
  localStorage.setItem(STORAGE_KEYS.recipes, JSON.stringify(state.recipes));
  localStorage.setItem(STORAGE_KEYS.pantry, JSON.stringify(state.pantry));
  localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(state.cart));
}

export function load() {
  try {
    state.recipes = JSON.parse(localStorage.getItem(STORAGE_KEYS.recipes) || '[]');
  } catch {
    state.recipes = [];
  }
  try {
    state.pantry = normalizePantry(JSON.parse(localStorage.getItem(STORAGE_KEYS.pantry) || '[]'));
  } catch {
    state.pantry = [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cart);
    const parsed = raw ? JSON.parse(raw) : [];
    state.cart = Array.isArray(parsed) ? parsed : [];
  } catch {
    state.cart = [];
  }
}

export function seed() {
  state.recipes = SEED_RECIPES.map(fromSchema);
  state.pantry = [...SEED_PANTRY];
  save();
}

/** Load persisted data, seeding first-run defaults if the library is empty. */
export function init() {
  load();
  if (!state.recipes.length) seed();
}
