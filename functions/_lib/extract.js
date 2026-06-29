// ════════════════════════════════════════════════════════
// extract.js — recipe extraction pipeline (pure, deps injected)
// ════════════════════════════════════════════════════════

const LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function isRecipeType(t) {
  if (!t) return false;
  if (Array.isArray(t)) return t.includes('Recipe');
  return t === 'Recipe';
}

/**
 * Find the first schema.org/Recipe object in a page's ld+json blocks.
 * Tolerant of broken blocks; unwraps @graph. Returns the raw object or null.
 * @param {string} html
 * @returns {object|null}
 */
export function findRecipeInHtml(html) {
  if (typeof html !== 'string') return null;
  const blocks = html.match(LD_BLOCK) || [];
  for (const block of blocks) {
    const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    let data;
    try { data = JSON.parse(inner); } catch { continue; }
    const candidates = Array.isArray(data) ? data : [data];
    for (const cand of candidates) {
      if (!cand) continue;
      if (isRecipeType(cand['@type']) && cand.name) return cand;
      const graph = cand['@graph'];
      if (Array.isArray(graph)) {
        const hit = graph.find((g) => g && isRecipeType(g['@type']) && g.name);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * True if obj looks like a usable recipe (name + non-empty ingredients + instructions).
 * @param {object} obj
 * @returns {boolean}
 */
export function hasRequiredFields(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!obj.name || typeof obj.name !== 'string') return false;
  if (!Array.isArray(obj.recipeIngredient) || !obj.recipeIngredient.length) return false;
  const instr = obj.recipeInstructions;
  const okInstr = Array.isArray(instr) ? instr.length > 0 : typeof instr === 'string' && instr.length > 0;
  return okInstr;
}