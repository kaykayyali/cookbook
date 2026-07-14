import { json, misconfigured } from '../_lib/http.js';
import { mutateWorkspace, readWorkspace } from '../_lib/workspace.js';

function householdIdFrom(context) {
  const id = context?.data?.household?.household?.id;
  return typeof id === 'string' && id ? id : null;
}

function prepare(context) {
  if (!context?.env?.DB?.prepare) return { response: misconfigured('db_binding') };
  const householdId = householdIdFrom(context);
  if (!householdId) return { response: json(403, { error: 'household_required' }) };
  return { db: context.env.DB, householdId };
}

export async function onRequestGet(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    return json(200, await readWorkspace(ready.db, ready.householdId));
  } catch (error) {
    console.error('[Workspace] Failed to load:', error);
    return json(500, { error: 'workspace_unavailable' });
  }
}

export async function onRequestPatch(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    let body;
    try { body = await context.request.json(); }
    catch { return json(400, { error: 'bad_json' }); }
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 50_000) {
      return json(400, { error: 'invalid_workspace_mutation' });
    }
    const result = await mutateWorkspace(ready.db, ready.householdId, body, {
      actorSub: context.data?.auth?.sub,
    });
    if (result.status === 409) {
      return json(409, { error: result.error, workspace: result.workspace });
    }
    return json(200, result.workspace);
  } catch (error) {
    if (/^(invalid_|unsupported_|recipe_required)/.test(error?.message || '')) {
      return json(400, { error: error.message });
    }
    console.error('[Workspace] Failed to mutate:', error);
    return json(500, { error: 'workspace_unavailable' });
  }
}
