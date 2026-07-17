import { parseLLMRecipe } from './extract.js';
import { boundedJsonValue, utf8ByteLength } from './bounded-json.js';

export const IMAGE_EXTRACTOR_METHOD = 'workers-ai-vision';
export const IMAGE_EXTRACTOR_VERSION = 'image-extractor-v1';
const EVIDENCE_CAP = 16_384;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function utf8Prefix(value, maxBytes) {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  return decoder.decode(bytes.slice(0, maxBytes));
}

function pageEvidence(pageTexts) {
  const pages = pageTexts.map((text, index) => ({ page: index + 1, text }));
  const pageText = pageTexts.map((text, index) => `Page ${index + 1}:\n${text}`).join('\n\n');
  const complete = { pageText, pages };
  if (utf8ByteLength(JSON.stringify(complete)) <= EVIDENCE_CAP) return complete;

  const originals = pageTexts.map((text) => ({ text, originalBytes: utf8ByteLength(text) }));
  const candidateFor = (quota) => ({
    truncated: true,
    pages: originals.map((original, index) => {
      const text = utf8Prefix(original.text, quota);
      return {
        page: index + 1,
        text,
        truncated: utf8ByteLength(text) < original.originalBytes,
        originalBytes: original.originalBytes,
      };
    }),
  });
  let low = 0;
  let high = Math.max(0, ...originals.map(({ originalBytes }) => originalBytes));
  let bounded = candidateFor(0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = candidateFor(middle);
    if (utf8ByteLength(JSON.stringify(candidate)) <= EVIDENCE_CAP) {
      bounded = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return boundedJsonValue(bounded, EVIDENCE_CAP);
}

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
      const text = String(await runVision(bytes, index + 1) || '').trim();
      pages.push(text);
    }
    const pageText = pages.map((text, index) => `Page ${index + 1}:\n${text}`).join('\n\n');
    const raw = await runText(pageText);
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
      evidence: pageEvidence(pages),
    };
  } catch (error) {
    return {
      recipe: null,
      confidence: { uncertainFields: ['name', 'recipeIngredient', 'recipeInstructions'], source: 'workers-ai-vision' },
      provenance: { pages: imageRefs.map((_, index) => index + 1), preservedImages: true },
      extractorMethod: IMAGE_EXTRACTOR_METHOD,
      extractorVersion: IMAGE_EXTRACTOR_VERSION,
      evidence: pageEvidence(pages),
      error: error?.message || 'image_extraction_failed',
    };
  }
}
