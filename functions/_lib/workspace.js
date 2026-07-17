import {
  aggregateCart,
  canonicalName,
  normalizeIngredientsLocal,
  parseServings,
  removeShoppingItem,
  setTargetServings,
} from '../../docs/js/lib/cart.js';
import { addToPantry, normalizePantry, normalizePantryEntry, removeFromPantry } from '../../docs/js/lib/pantry.js';

const PLAN_TYPES = new Set(['recipe', 'leftovers', 'dining-out', 'open']);
const PLAN_STATUSES = new Set(['active', 'skipped', 'cooked']);
const PLAN_SLOTS = new Set(['breakfast', 'lunch', 'dinner']);
const MAX_RECENT_MUTATIONS = 64;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRANSFER_PREFIX = 'pantry-transfer:';

const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function normalizeManualItems(raw) {
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    const normalized = normalizePantryEntry(item);
    const id = text(item?.id, 100);
    return id && normalized ? [{ id, ...normalized, checked: item.checked === true }] : [];
  });
}

function pruneTransferMarkers(workspace) {
  const valid = new Set([
    ...aggregateCart(workspace.cart).map((item) => item.name),
    ...workspace.manualItems.map((item) => `manual:${item.id}`),
  ]);
  Object.keys(workspace.shoppingChecked).forEach((key) => {
    if (key.startsWith(TRANSFER_PREFIX) && !valid.has(key.slice(TRANSFER_PREFIX.length))) {
      delete workspace.shoppingChecked[key];
    }
  });
}

export function emptyWorkspace(householdId) {
  return {
    householdId,
    revision: 0,
    plan: [],
    cart: [],
    pantry: [],
    shoppingChecked: {},
    manualItems: [],
    recentMutations: [],
    updatedAt: 0,
  };
}

function normalizedPlanEntry(payload) {
  const id = text(payload?.id, 100);
  const date = text(payload?.date, 10);
  const type = text(payload?.type, 20);
  const status = text(payload?.status, 20);
  const slot = text(payload?.slot, 20) || 'dinner';
  const recipeId = payload?.recipeId == null ? null : text(payload.recipeId, 100);
  if (!id || !DATE_RE.test(date) || !PLAN_TYPES.has(type) || !PLAN_STATUSES.has(status) || !PLAN_SLOTS.has(slot)) {
    throw new Error('invalid_plan_entry');
  }
  if (type === 'recipe' && !recipeId) throw new Error('recipe_required');
  return {
    id,
    date,
    slot,
    type,
    recipeId: type === 'recipe' ? recipeId : null,
    targetServings: payload.targetServings == null
      ? 2 : Math.min(50, Math.max(1, Math.round(Number(payload.targetServings) || 1))),
    plannedBySub: text(payload.plannedBySub, 200),
    cookSub: payload.cookSub == null ? null : text(payload.cookSub, 200),
    note: text(payload.note, 500),
    status,
  };
}

function planSelection(recipe, entries, rangeStart, rangeEnd, previous) {
  const sourceRecipeId = String(recipe._id || recipe.id || recipe.recipeId || '');
  const sourceServings = parseServings(recipe.recipeYield);
  const targetServings = entries.reduce((sum, entry) => sum + entry.targetServings, 0);
  const signature = JSON.stringify(entries
    .map(({ id, date, status, targetServings: servings }) => ({ id, date, status, servings }))
    .sort((a, b) => a.id.localeCompare(b.id)));
  return {
    recipeId: `plan:${rangeStart}:${rangeEnd}:${sourceRecipeId}`,
    sourceRecipeId,
    recipeName: String(recipe.name || 'Recipe'),
    sourceServings,
    targetServings,
    normalizationVersion: 2,
    ingredients: normalizeIngredientsLocal(recipe.recipeIngredient),
    removedIngredientNames: Array.isArray(previous?.removedIngredientNames)
      ? [...previous.removedIngredientNames] : [],
    origin: {
      kind: 'plan',
      rangeStart,
      rangeEnd,
      signature,
      planEntryIds: entries.map((entry) => entry.id).sort(),
    },
  };
}

function regeneratePlanRange(workspace, payload, recipes) {
  const rangeStart = text(payload?.rangeStart, 10);
  const rangeEnd = text(payload?.rangeEnd, 10);
  if (!DATE_RE.test(rangeStart) || !DATE_RE.test(rangeEnd) || rangeStart > rangeEnd) {
    throw new Error('invalid_plan_range');
  }
  const grouped = new Map();
  for (const entry of workspace.plan) {
    if (entry.type !== 'recipe' || entry.status !== 'active'
        || entry.date < rangeStart || entry.date > rangeEnd) continue;
    const rows = grouped.get(entry.recipeId) || [];
    rows.push(entry);
    grouped.set(entry.recipeId, rows);
  }
  const recipeMap = new Map((Array.isArray(recipes) ? recipes : []).map((recipe) => [
    String(recipe._id || recipe.id || recipe.recipeId || ''), recipe,
  ]));
  const direct = workspace.cart.filter((selection) => selection?.origin?.kind !== 'plan'
    || selection.origin.rangeStart !== rangeStart || selection.origin.rangeEnd !== rangeEnd);
  const previous = new Map(workspace.cart
    .filter((selection) => selection?.origin?.kind === 'plan'
      && selection.origin.rangeStart === rangeStart && selection.origin.rangeEnd === rangeEnd)
    .map((selection) => [selection.sourceRecipeId, selection]));
  const generated = [];
  for (const [recipeId, entries] of grouped) {
    const recipe = recipeMap.get(recipeId);
    if (recipe) generated.push(planSelection(recipe, entries, rangeStart, rangeEnd, previous.get(recipeId)));
  }
  workspace.cart = [...direct, ...generated];
}

function applyOperation(workspace, operation, context) {
  const payload = operation.payload || {};
  switch (operation.op) {
    case 'plan.upsert': {
      const entry = normalizedPlanEntry(payload);
      const index = workspace.plan.findIndex((item) => item.id === entry.id);
      entry.plannedBySub = index >= 0
        ? workspace.plan[index].plannedBySub
        : text(context.actorSub, 200) || entry.plannedBySub;
      if (index >= 0) workspace.plan[index] = entry;
      else workspace.plan.push(entry);
      workspace.plan.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      break;
    }
    case 'plan.remove':
      workspace.plan = workspace.plan.filter((entry) => entry.id !== text(payload.id, 100));
      break;
    case 'pantry.add': {
      const sourceKey = text(payload.sourceKey, 300);
      const marker = sourceKey ? `${TRANSFER_PREFIX}${sourceKey}` : '';
      if (marker && workspace.shoppingChecked[marker] === true) break;
      const result = addToPantry(workspace.pantry, payload.item || payload.name);
      if (!result.item) throw new Error('invalid_pantry_item');
      workspace.pantry = result.pantry;
      if (marker) workspace.shoppingChecked[marker] = true;
      break;
    }
    case 'pantry.remove': {
      const name = canonicalName(payload.name);
      const identity = payload.unit ? { name, unit: payload.unit } : name;
      if (payload.unit && Object.prototype.hasOwnProperty.call(payload, 'countLabel')) {
        identity.countLabel = payload.countLabel;
      }
      workspace.pantry = removeFromPantry(workspace.pantry, identity);
      break;
    }
    case 'cart.upsertSelection': {
      const selection = clone(payload.selection);
      if (!selection?.recipeId || !Array.isArray(selection.ingredients)) throw new Error('invalid_selection');
      const index = workspace.cart.findIndex((item) => item.recipeId === selection.recipeId);
      if (index >= 0) workspace.cart[index] = selection;
      else workspace.cart.push(selection);
      pruneTransferMarkers(workspace);
      break;
    }
    case 'cart.setTargetServings':
      workspace.cart = setTargetServings(workspace.cart, text(payload.recipeId, 200), payload.targetServings);
      break;
    case 'cart.removeSelection':
      workspace.cart = workspace.cart.filter((item) => item.recipeId !== text(payload.recipeId, 200));
      pruneTransferMarkers(workspace);
      break;
    case 'shopping.removeIngredient': {
      workspace.cart = removeShoppingItem(workspace.cart, payload.name);
      delete workspace.shoppingChecked[canonicalName(payload.name)];
      pruneTransferMarkers(workspace);
      break;
    }
    case 'shopping.setChecked': {
      const key = text(payload.key, 300);
      if (!key) throw new Error('invalid_shopping_key');
      if (payload.checked === true) workspace.shoppingChecked[key] = true;
      else delete workspace.shoppingChecked[key];
      break;
    }
    case 'shopping.addManual': {
      const id = text(payload.id, 100);
      const normalized = normalizePantryEntry({ ...payload, name: text(payload.name, 200) });
      if (!id || !normalized) throw new Error('invalid_manual_item');
      const item = { id, ...normalized, checked: payload.checked === true };
      const index = workspace.manualItems.findIndex((current) => current.id === item.id);
      if (index >= 0) workspace.manualItems[index] = item;
      else workspace.manualItems.push(item);
      break;
    }
    case 'shopping.removeManual': {
      const itemId = text(payload.id, 100);
      workspace.manualItems = workspace.manualItems.filter((item) => item.id !== itemId);
      delete workspace.shoppingChecked[`manual:${itemId}`];
      pruneTransferMarkers(workspace);
      break;
    }
    case 'shopping.clear':
      workspace.cart = [];
      workspace.shoppingChecked = {};
      workspace.manualItems = [];
      break;
    case 'shopping.regeneratePlanRange':
      regeneratePlanRange(workspace, payload, context.recipes);
      pruneTransferMarkers(workspace);
      break;
    default:
      throw new Error('unsupported_workspace_operation');
  }
}

export function applyWorkspaceMutation(current, operation, context = {}) {
  const mutationId = text(operation?.mutationId, 200);
  if (!mutationId || !text(operation?.op, 100)) throw new Error('invalid_workspace_mutation');
  const normalized = {
    ...clone(current),
    pantry: normalizePantry(current.pantry),
    manualItems: normalizeManualItems(current.manualItems),
  };
  if (normalized.recentMutations.includes(mutationId)) {
    return { workspace: normalized, duplicate: true };
  }
  const workspace = normalized;
  applyOperation(workspace, operation, context);
  workspace.revision += 1;
  workspace.updatedAt = Number(context.now) || Date.now();
  workspace.recentMutations = [...workspace.recentMutations, mutationId].slice(-MAX_RECENT_MUTATIONS);
  return { workspace, duplicate: false };
}

export const WORKSPACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS household_workspace (
  household_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  plan_json TEXT NOT NULL DEFAULT '[]',
  cart_json TEXT NOT NULL DEFAULT '[]',
  pantry_json TEXT NOT NULL DEFAULT '[]',
  shopping_checked_json TEXT NOT NULL DEFAULT '{}',
  manual_items_json TEXT NOT NULL DEFAULT '[]',
  recent_mutations_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);`;

export const WORKSPACE_MUTATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS household_workspace_mutations (
  household_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, mutation_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);`;

const workspaceSchemaPromises = new WeakMap();

export function ensureWorkspaceSchemaOnce(db, householdId) {
  if (!workspaceSchemaPromises.has(db)) {
    const promise = db.batch([
      db.prepare(WORKSPACE_SCHEMA),
      db.prepare(WORKSPACE_MUTATIONS_SCHEMA),
      db.prepare(`INSERT INTO household_workspace (household_id, updated_at)
        VALUES (?, ?) ON CONFLICT(household_id) DO NOTHING`).bind(householdId, Date.now()),
    ]).catch((error) => {
      workspaceSchemaPromises.delete(db);
      throw error;
    });
    workspaceSchemaPromises.set(db, promise);
  }
  return workspaceSchemaPromises.get(db);
}

function jsonField(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function workspaceFromRow(row, householdId) {
  if (!row) return emptyWorkspace(householdId);
  const plan = jsonField(row.plan_json, []);
  const cart = jsonField(row.cart_json, []);
  const pantry = jsonField(row.pantry_json, []);
  const manualItems = jsonField(row.manual_items_json, []);
  const recentMutations = jsonField(row.recent_mutations_json, []);
  return {
    householdId: row.household_id,
    revision: Number(row.revision) || 0,
    plan: Array.isArray(plan) ? plan : [],
    cart: Array.isArray(cart) ? cart : [],
    pantry: normalizePantry(pantry),
    shoppingChecked: jsonField(row.shopping_checked_json, {}),
    manualItems: normalizeManualItems(manualItems),
    recentMutations: Array.isArray(recentMutations) ? recentMutations : [],
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function readWorkspace(db, householdId) {
  await ensureWorkspaceSchemaOnce(db, householdId);
  const row = await db.prepare('SELECT * FROM household_workspace WHERE household_id = ?')
    .bind(householdId).first();
  return workspaceFromRow(row, householdId);
}

async function recipesForGeneration(db, householdId) {
  const result = await db.prepare(`SELECT id, recipe_json, updated_at FROM household_recipes
    WHERE household_id = ?`).bind(householdId).all();
  return (result?.results || []).flatMap((row) => {
    try { return [{ ...JSON.parse(row.recipe_json), _id: row.id, updatedAt: row.updated_at }]; }
    catch { return []; }
  });
}

export async function mutateWorkspace(db, householdId, request, context = {}) {
  const current = await readWorkspace(db, householdId);
  const recorded = await db.prepare(`SELECT mutation_id FROM household_workspace_mutations
    WHERE household_id = ? AND mutation_id = ?`).bind(householdId, request.mutationId).first();
  if (recorded) return { status: 200, workspace: current };
  if (current.recentMutations.includes(request.mutationId)) {
    await db.prepare(`INSERT INTO household_workspace_mutations
      (household_id, mutation_id, operation, committed_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(household_id, mutation_id) DO NOTHING`)
      .bind(householdId, request.mutationId, request.op, Date.now()).run();
    return { status: 200, workspace: current };
  }
  if (!Number.isInteger(request.baseRevision) || request.baseRevision !== current.revision) {
    return { status: 409, error: 'revision_conflict', workspace: current };
  }
  const recipes = request.op === 'shopping.regeneratePlanRange'
    ? await recipesForGeneration(db, householdId) : [];
  const next = applyWorkspaceMutation(current, request, { recipes, actorSub: context.actorSub }).workspace;
  const [result] = await db.batch([
    db.prepare(`UPDATE household_workspace SET
        revision = revision + 1, plan_json = ?, cart_json = ?, pantry_json = ?,
        shopping_checked_json = ?, manual_items_json = ?, recent_mutations_json = ?, updated_at = ?
      WHERE household_id = ? AND revision = ?`).bind(
      JSON.stringify(next.plan), JSON.stringify(next.cart), JSON.stringify(next.pantry),
      JSON.stringify(next.shoppingChecked), JSON.stringify(next.manualItems),
      JSON.stringify(next.recentMutations), next.updatedAt, householdId, current.revision,
    ),
    db.prepare(`INSERT INTO household_workspace_mutations
      (household_id, mutation_id, operation, committed_at)
      SELECT ?, ?, ?, ? WHERE changes() = 1
      ON CONFLICT(household_id, mutation_id) DO NOTHING`)
      .bind(householdId, request.mutationId, request.op, next.updatedAt),
  ]);
  if (Number(result?.meta?.changes || 0) < 1) {
    const latest = await readWorkspace(db, householdId);
    if (latest.recentMutations.includes(request.mutationId)) return { status: 200, workspace: latest };
    return { status: 409, error: 'revision_conflict', workspace: latest };
  }
  return { status: 200, workspace: next };
}
