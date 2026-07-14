import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shopping CSS provides compact mobile grid, safe padding, desktop max width, and hides FAB', async () => {
  const [components, app] = await Promise.all([
    readFile(new URL('../docs/css/components.css', import.meta.url), 'utf8'),
    readFile(new URL('../docs/css/app.css', import.meta.url), 'utf8'),
  ]);
  assert.match(components, /grid-template-columns:\s*3[2-6]px\s+minmax\(0,\s*1fr\)\s+auto\s+3[2-6]px/);
  assert.match(components, /min-height:\s*44px/);
  assert.match(components, /padding-bottom:\s*calc\([^;]*safe-area-inset-bottom/);
  assert.match(components, /max-width:\s*\d+px/);
  assert.match(components, /\.cart-recipe-name\s*\{[^}]*white-space:\s*normal[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(components, /\.cart-row\.is-completing\s*\{[^}]*animation:/s);
  assert.match(components, /@keyframes\s+cart-row-complete/);
  assert.match(components, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.cart-row\.is-completing/);
  assert.match(app, /body\[data-panel=["']?cart["']?\]\s+\.fab-stack\s*\{[^}]*display:\s*none/s);
});
