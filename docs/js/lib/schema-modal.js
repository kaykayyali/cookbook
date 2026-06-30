// lib/schema-modal.js — tiny helper for the JSON-LD modal + export.

import { $ } from './dom.js';
import { toast } from './dom.js';
import { toSchema } from './schema.js';
import { pluralize } from './format.js';

export function showRecipeSchema(id, state) {
  const r = id ? state.recipes.find((x) => x._id === id) : null;
  if (!r) return;
  $('schema-preview').textContent = JSON.stringify(toSchema(r), null, 2);
  $('schema-overlay').classList.add('open');
}

export function closeSchemaModal() {
  $('schema-overlay').classList.remove('open');
}

export function wireSchemaModal() {
  $('schema-close-btn')?.addEventListener('click', closeSchemaModal);
  $('schema-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'schema-overlay') closeSchemaModal(); });
  $('schema-copy-btn')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('schema-preview').textContent); toast('Copied JSON-LD'); }
    catch { toast('Copy failed'); }
  });
}

export function exportRecipesToFile(state) {
  const data = state.recipes.map(toSchema);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'recipes.json' }).click();
  toast(`Exported ${pluralize(data.length, 'recipe')}`);
}
