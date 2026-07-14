import { esc } from '../lib/format.js';

/** Compact two-person household attribution.
 * The full name remains available to assistive technology while the visual
 * surface uses the member photo or a warm K/G monogram.
 */
export function householdIdentityHTML(author, { action = 'Added by' } = {}) {
  if (!author) return '';
  const name = String(author.name || 'Household member').trim();
  const initial = (name[0] || '?').toUpperCase();
  const identity = author.picture
    ? `<img class="household-avatar" src="${esc(author.picture)}" alt="" referrerpolicy="no-referrer" crossorigin="anonymous">`
    : `<span class="household-avatar household-initial" aria-hidden="true">${esc(initial)}</span>`;
  return `<span class="household-attribution" role="img" aria-label="${esc(action)} ${esc(name)}" title="${esc(name)}">${identity}</span>`;
}
