// ════════════════════════════════════════════════════════
// community.js — Community feed client (pure helpers + thin authFetch wrappers)
// ════════════════════════════════════════════════════════
import { authFetch } from './auth.js';
import { toSchema, fromSchema, uuid } from './schema.js';

export const communityState = { recipes: [], nextCursor: null, loading: false, hasMore: true, error: null };

/** Internal recipe -> canonical JSON-LD for the wire (POST/PUT body). */
export function toShareable(recipe) {
  return toSchema(recipe);
}

/** Canonical JSON-LD -> a local library recipe with a fresh _id (Save to my library). */
export function toLocalCopy(canonicalRecipe) {
  const internal = fromSchema(canonicalRecipe);
  internal._id = uuid();
  return internal;
}

async function readError(res) {
  try { return (await res.json()).error; } catch { return undefined; }
}

/** GET /api/community — list one page. */
export async function fetchCommunity({ cursor, limit, onUnauthorized } = {}) {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', String(limit));
  const path = `/community${qs.toString() ? '?' + qs.toString() : ''}`;
  const res = await authFetch(path, {}, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  const data = await res.json();
  return { ok: true, recipes: data.recipes || [], nextCursor: data.nextCursor || null };
}

/** POST /api/community — share a local recipe. */
export async function shareRecipe(recipe, { onUnauthorized } = {}) {
  const res = await authFetch('/community', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: toShareable(recipe) }),
  }, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  return { ok: true, recipe: await res.json() };
}

/** GET /api/community/:id — fetch one (for Save to my library). */
export async function saveCommunityRecipe(id, { onUnauthorized } = {}) {
  const res = await authFetch(`/community/${encodeURIComponent(id)}`, {}, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  const data = await res.json();
  return { ok: true, recipe: data.recipe };
}

/** PUT /api/community/:id — author edit. */
export async function editCommunityRecipe(id, recipe, { onUnauthorized } = {}) {
  const res = await authFetch(`/community/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: toShareable(recipe) }),
  }, { onUnauthorized });
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  return { ok: true, recipe: await res.json() };
}

/** DELETE /api/community/:id — author delete. */
export async function deleteCommunityRecipe(id, { onUnauthorized } = {}) {
  const res = await authFetch(`/community/${encodeURIComponent(id)}`, { method: 'DELETE' }, { onUnauthorized });
  if (res.status === 204) return { ok: true, status: 204 };
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  return { ok: true, status: res.status };
}