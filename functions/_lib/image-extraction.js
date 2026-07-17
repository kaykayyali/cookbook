import { parseLLMRecipe } from './extract.js';
import { boundedJsonValue } from './bounded-json.js';

export const IMAGE_EXTRACTOR_METHOD = 'workers-ai-vision';
export const IMAGE_EXTRACTOR_VERSION = 'image-extractor-v1';
const EVIDENCE_CAP = 16_384;

function decodeImage(ref) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(ref || '');
  if (!match) throw new Error('invalid_image_reference');
  const raw = atob(match[1]);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function extractRecipeFromImages({ imageRefs, runVision, runText }) {
  const pages = [];
  try {
    for (let index = 0; index < imageRefs.length; index += 1) {
      const bytes = decodeImage(imageRefs[index]);
      const text = await runVision(bytes, index + 1);
      pages.push(`Page ${index + 1}:\n${String(text || '').trim()}`);
    }
    const raw = await runText(pages.join('\n\n'));
    const recipe = parseLLMRecipe(typeof raw === 'string' ? raw : raw?.response);
    if (!recipe) throw new Error('uncertain_extraction');
    const required = ['name', 'recipeIngredient', 'recipeInstructions'];
    const uncertainFields = required.filter((field) => !recipe[field] || (Array.isArray(recipe[field]) && !recipe[field].length));
    return {
      recipe,
      confidence: { uncertainFields, source: 'workers-ai-vision' },
      provenance: { pages: imageRefs.map((_, index) => index + 1), preservedImages: true },
      extractorMethod: IMAGE_EXTRACTOR_METHOD,
      extractorVersion: IMAGE_EXTRACTOR_VERSION,
      evidence: boundedJsonValue({ pageText: pages.join('\n\n') }, EVIDENCE_CAP),
    };
  } catch (error) {
    return {
      recipe: null,
      confidence: { uncertainFields: ['name', 'recipeIngredient', 'recipeInstructions'], source: 'workers-ai-vision' },
      provenance: { pages: imageRefs.map((_, index) => index + 1), preservedImages: true },
      extractorMethod: IMAGE_EXTRACTOR_METHOD,
      extractorVersion: IMAGE_EXTRACTOR_VERSION,
      evidence: boundedJsonValue({ pageText: pages.join('\n\n') }, EVIDENCE_CAP),
      error: error?.message || 'image_extraction_failed',
    };
  }
}
