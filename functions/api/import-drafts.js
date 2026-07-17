// ════════════════════════════════════════════════════════
// import-drafts.js — API routes for recipe import drafts (image capture)
// ════════════════════════════════════════════════════════
import { json, misconfigured } from '../_lib/http.js';
import {
  ensureImportDraftsSchema,
  normalizeDraftInput,
  createDraft,
  listDrafts,
  getDraft,
  updateDraftRecipe,
  updateDraftExtraction,
  confirmDraft,
  rejectDraft,
  detectDuplicates,
} from '../_lib/import-drafts.js';
import { extractRecipeFromImages } from '../_lib/image-extraction.js';
import { authorFrom } from '../_lib/community.js';

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const IMAGE_RECOVERY_PROVENANCE = {
  extractorMethod: 'manual-image-recovery',
  extractorVersion: 'manual-image-recovery-v1',
  evidence: {
    outcome: 'ai_binding_unavailable',
    ocrPagesCompleted: 0,
    recovery: 'manual_recipe_review',
  },
};
const URL_RECOVERY_PROVENANCE = {
  extractorMethod: 'manual-url-recovery',
  extractorVersion: 'manual-url-recovery-v1',
  evidence: { outcome: 'direct_draft_without_extraction', recovery: 'manual_recipe_review' },
};

function prepare(context) {
  const householdId = context?.data?.household?.household?.id;
  const actor = authorFrom(context);
  if (!householdId) return { response: json(403, { error: 'household_required' }) };
  if (!actor) return { response: json(401, { error: 'invalid_token' }) };
  if (!context?.env?.DB?.prepare) return { response: misconfigured('db_binding') };
  return { householdId, actorSub: actor.sub, actor, db: context.env.DB };
}

async function ensureSchema(db) {
  await ensureImportDraftsSchema(db);
}

async function bodyOf(request) {
  const body = await request.json();
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 8_500_000) throw new Error('invalid_request');
  return body;
}

function errorResponse(error) {
  const code = error?.message || 'import_draft_unavailable';
  if (/^(invalid_|draft_not_found|draft_terminal)/.test(code)) return json(code.includes('not_found') ? 404 : 400, { error: code });
  console.error('[ImportDrafts] Request failed:', error);
  return json(500, { error: 'import_draft_unavailable' });
}

export async function onRequestGet(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    await ensureSchema(ready.db);
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    if (id) {
      const result = await getDraft(ready.db, { id, householdId: ready.householdId });
      return json(result.status, result.body);
    }
    const status = url.searchParams.get('status') || null;
    const result = await listDrafts(ready.db, { householdId: ready.householdId, status });
    return json(result.status, result.body);
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPost(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    await ensureSchema(ready.db);
    const body = await bodyOf(context.request);
    const normalizedInput = normalizeDraftInput(body);
    let extraction = null;
    let serverProvenance = normalizedInput.sourceType === 'url'
      ? URL_RECOVERY_PROVENANCE
      : IMAGE_RECOVERY_PROVENANCE;

    if (normalizedInput.sourceType === 'image' && context.env.AI?.run) {
      extraction = await extractRecipeFromImages({
        imageRefs: normalizedInput.imageRefs,
        runVision: async (bytes, page) => {
          const output = await context.env.AI.run(VISION_MODEL, {
            image: Array.from(bytes),
            prompt: `Transcribe recipe page ${page} exactly. Preserve headings, ingredients, quantities, and step order. Do not invent missing text.`,
          });
          return output?.response || output?.description || '';
        },
        runText: async (pages) => {
          const output = await context.env.AI.run(TEXT_MODEL, { messages: [
            { role: 'system', content: 'Return only JSON for one schema.org Recipe. Include name, recipeIngredient string array, recipeInstructions string array, and other fields only when supported by the page text. Never invent quantities.' },
            { role: 'user', content: pages },
          ] });
          return output?.response || '';
        },
      });
      serverProvenance = {
        extractorMethod: extraction.extractorMethod,
        extractorVersion: extraction.extractorVersion,
        evidence: {
          ...extraction.evidence,
          outcome: extraction.error ? 'image_extraction_recoverable_failure' : 'image_extraction_completed',
          error: extraction.error || undefined,
        },
      };
    }

    const result = await createDraft(ready.db, {
      householdId: ready.householdId,
      actorSub: ready.actorSub,
      input: extraction ? {
        ...normalizedInput,
        extracted: { recipe: extraction.recipe },
        confidence: extraction.confidence,
      } : normalizedInput,
      serverProvenance,
      now: Date.now(),
    });
    if (result.status === 201 && extraction) {
      const updated = await updateDraftExtraction(ready.db, {
        id: result.body.id, householdId: ready.householdId,
        extracted: { recipe: extraction.recipe },
        confidence: extraction.confidence, duplicateIds: [], now: Date.now(),
      });
      return json(result.status, { ...result.body, ...updated.body });
    }
    return json(result.status, result.body);
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPatch(context) {
  try {
    const ready = prepare(context);
    if (ready.response) return ready.response;
    await ensureSchema(ready.db);
    const body = await bodyOf(context.request);
    const { action, id, recipe, extracted, confidence, duplicateIds } = body;
    if (!id) return json(400, { error: 'invalid_request' });

    if (action === 'update-recipe') {
      const result = await updateDraftRecipe(ready.db, {
        id, householdId: ready.householdId, actorSub: ready.actorSub, recipe, now: Date.now(),
      });
      return json(result.status, result.body);
    }
    if (action === 'update-extraction') {
      const result = await updateDraftExtraction(ready.db, {
        id, householdId: ready.householdId, extracted, confidence, duplicateIds, now: Date.now(),
      });
      return json(result.status, result.body);
    }
    if (action === 'confirm') {
      const dupes = await detectDuplicates(ready.db, { householdId: ready.householdId, recipeName: recipe?.name });
      if (dupes.length && body.allowDuplicate !== true) {
        return json(409, { error: 'duplicate_confirmation_required', duplicates: dupes });
      }
      const result = await confirmDraft(ready.db, {
        id, householdId: ready.householdId, actorSub: ready.actor.sub,
        actorName: ready.actor.name, actorPicture: ready.actor.picture,
        recipe, now: Date.now(),
      });
      return json(result.status, result.body);
    }
    if (action === 'reject') {
      const result = await rejectDraft(ready.db, {
        id, householdId: ready.householdId, actorSub: ready.actorSub, now: Date.now(),
      });
      return json(result.status, result.body);
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) { return errorResponse(error); }
}