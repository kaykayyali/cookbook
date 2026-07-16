import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const appCss = await readFile(new URL('../docs/css/app.css', import.meta.url), 'utf8');

test('final mobile shell override keeps the bottom navigation compact and safe-area aware', () => {
  const finalMobile = appCss.slice(appCss.lastIndexOf('@media (max-width: 760px)'));
  assert.match(finalMobile, /\.sidebar\s*\{[^}]*padding:\s*2px 4px[^}]*padding-bottom:\s*max\(2px,\s*env\(safe-area-inset-bottom,\s*0px\)\)/s);
  assert.match(finalMobile, /\.nav-item\s*\{[^}]*min-height:\s*44px[^}]*padding:\s*3px 2px/s);
  assert.match(finalMobile, /\.sidebar-nav\s*\{[^}]*padding:\s*0/s);
});

test('mobile shell protects the iPhone top safe area without double-padding the recipe topbar', () => {
  assert.match(appCss, /\.main\s*\{[^}]*padding-top:\s*env\(safe-area-inset-top,\s*0px\)/s);
  const finalMobile = appCss.slice(appCss.lastIndexOf('@media (max-width: 760px)'));
  assert.match(finalMobile, /\.topbar\s*\{[^}]*top:\s*env\(safe-area-inset-top,\s*0px\)[^}]*padding-top:\s*10px/s);
});
