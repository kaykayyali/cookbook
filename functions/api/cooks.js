import { json, misconfigured } from '../_lib/http.js';
import {
  correctCookEvent, createD1CookStore, deleteCookEvent, recordCookEvent, saveMemberReaction,
} from '../_lib/cooks.js';

function prepare(context) {
  const householdId = context?.data?.household?.household?.id;
  const actorSub = context?.data?.auth?.sub;
  if (!householdId) return { response: json(403, { error: 'household_required' }) };
  if (!actorSub) return { response: json(401, { error: 'invalid_token' }) };
  if (!context?.data?.cookStore && !context?.env?.DB?.prepare) return { response: misconfigured('db_binding') };
  return { householdId, actorSub };
}
async function storeFor(context) {
  return context.data?.cookStore || createD1CookStore(context.env.DB);
}
async function bodyOf(request) {
  const body = await request.json();
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 20_000) throw new Error('invalid_request');
  return body;
}
function errorResponse(error) {
  const code = error?.message || 'cook_history_unavailable';
  if (code === 'event_revision_conflict') return json(409, { error: code });
  if (/^(invalid_|recipe_not_found|cook_event_not_found)/.test(code)) return json(code.endsWith('not_found') ? 404 : 400, { error: code });
  console.error('[Cooks] Request failed:', error);
  return json(500, { error: 'cook_history_unavailable' });
}

export async function onRequestGet(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    const store = await storeFor(context);
    const [events, reactions] = await Promise.all([
      store.listEvents(ready.householdId), store.listReactions(ready.householdId),
    ]);
    return json(200, { events, reactions });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPost(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    const store = await storeFor(context);
    const body = await bodyOf(context.request);
    const prior = await store.getEvent(body.eventId, ready.householdId);
    const event = await recordCookEvent(store, {
      householdId: ready.householdId, actorSub: ready.actorSub, input: body,
    });
    return json(prior ? 200 : 201, { event });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPatch(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    const store = await storeFor(context);
    const body = await bodyOf(context.request);
    if (body.action === 'correct') {
      const event = await correctCookEvent(store, {
        householdId: ready.householdId, actorSub: ready.actorSub, input: body,
      });
      return json(200, { event });
    }
    if (!body.eventId || !body.reaction) return json(400, { error: 'invalid_reaction' });
    const reaction = await saveMemberReaction(store, {
      householdId: ready.householdId, actorSub: ready.actorSub,
      eventId: body.eventId, input: body.reaction,
    });
    return json(200, { reaction });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestDelete(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    const event = await deleteCookEvent(await storeFor(context), {
      householdId: ready.householdId, actorSub: ready.actorSub, input: await bodyOf(context.request),
    });
    return json(200, { event });
  } catch (error) { return errorResponse(error); }
}
