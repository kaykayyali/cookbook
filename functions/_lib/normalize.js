// Pure Workers AI ingredient-normalization interpretation and validation.
const UNITS = new Set(['count', 'ounce', 'qualitative']);
const KINDS = new Set(['indivisible', 'divisible', 'qualitative']);

function canonicalName(value) {
  let name = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name === 'eggs') return 'egg';
  if (name === 'tomatoes') return 'tomato';
  if (/^[a-z]+s$/.test(name) && !/(ss|us)$/.test(name)) name = name.slice(0, -1);
  return name;
}

export function buildNormalizationPrompt(ingredients, { recipeName = '', recipeYield = '' } = {}) {
  return [
    {
      role: 'system',
      content: 'Interpret ingredient lines only. Return one JSON array item per input, in order, with name, quantity, unit, kind, and confidence from 0 to 1. Use a lowercase singular canonical grocery name so equivalent ingredients merge across recipes. Remove size and preparation descriptors such as large, chopped, diced, or divided unless they change the product identity; preserve meaningful names such as olive oil or brown sugar. Never scale, aggregate, round, add a safety buffer, or change serving sizes. Canonical unit must be count, ounce, or qualitative. Use ounce for both mass and volume with cooking water-equivalence (1 mL≈1 g, 1 fl oz≈1 oz, 1 cup=8 oz, tbsp=.5 oz, tsp=1/6 oz, lb=16 oz, kg=35.274 oz). kind must be indivisible, divisible, or qualitative. Use null quantity for uncertain qualitative amounts. Return JSON only.',
    },
    { role: 'user', content: JSON.stringify({ recipeName, recipeYield, ingredients }) },
  ];
}

export function parseNormalizedIngredients(output, rawIngredients) {
  if (typeof output !== 'string' || !Array.isArray(rawIngredients)) return null;
  let text = output.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== rawIngredients.length) return null;
  const normalized = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== 'object') return null;
    const name = canonicalName(item.name);
    if (!name || !UNITS.has(item.unit) || !KINDS.has(item.kind)) return null;
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) return null;
    if (item.unit === 'qualitative') {
      if (item.quantity != null || item.kind !== 'qualitative') return null;
    } else if (!Number.isFinite(item.quantity) || item.quantity < 0) return null;
    if (item.unit === 'count' && item.kind !== 'indivisible') return null;
    if (item.unit === 'ounce' && item.kind !== 'divisible') return null;
    normalized.push({ raw: rawIngredients[i], name, quantity: item.quantity, unit: item.unit, kind: item.kind, confidence: item.confidence });
  }
  return normalized;
}

export async function handleNormalize(body, deps) {
  const ingredients = body?.ingredients;
  if (!Array.isArray(ingredients) || !ingredients.length || ingredients.length > 100
      || ingredients.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)) {
    return { status: 400, body: { error: 'invalid_ingredients' } };
  }
  let output;
  const recipeName = typeof body?.recipeName === 'string' ? body.recipeName.slice(0, 200) : '';
  const recipeYield = typeof body?.recipeYield === 'string' || typeof body?.recipeYield === 'number'
    ? String(body.recipeYield).slice(0, 100) : '';
  try { output = await deps.runLLM(buildNormalizationPrompt(ingredients, { recipeName, recipeYield })); }
  catch { return { status: 503, body: { error: 'normalization_unavailable' } }; }
  const normalized = parseNormalizedIngredients(output, ingredients);
  if (!normalized) return { status: 422, body: { error: 'invalid_normalization' } };
  return { status: 200, body: { ingredients: normalized } };
}
