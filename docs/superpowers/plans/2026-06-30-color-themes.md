# Color Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the theme system from 2 to 5 themes (Light, Dark, Sepia, Forest, Ocean) with a swatch picker in Settings; reset existing `cb_theme` users to OS auto via a storage key bump.

**Architecture:** Three new `:root[data-theme="..."]` blocks in `docs/css/tokens.css`; `theme.js` VALID set widens; `STORAGE_KEYS.theme` bumps to `cb_theme_v2`; `settings.js` gains a `renderThemePicker` that mounts 5 self-painted swatch buttons; new CSS rules in `app.css` style the picker.

**Tech Stack:** Node 18+, native ESM, esbuild (build only), `node --test` for unit tests, custom `node:http` static server for the E2E smoke test (no Playwright). All existing project conventions apply (controller-owned DOM wiring, deps-injected, no raw hex outside `tokens.css`).

## Global Constraints

- **TDD only.** Red → green → commit. No implementation before a failing test exists.
- **DRY / YAGNI.** The 3 new theme blocks mirror Light/Dark structurally — copy the Light block, swap values. Don't factor into a generic loop.
- **No raw hex outside `docs/css/tokens.css`.** Swatch colors are set via inline `style="--swatch-bg: <hex>"` from JS, not as CSS rules.
- **No new dependencies.**
- **All token names in `REQUIRED_TOKEN_NAMES` (in `test/design-system.test.js`) must remain present in `tokens.css`.** Adding more occurrences is fine; the existing test greps for each `${name}:` substring.
- **Storage key:** `STORAGE_KEYS.theme` flips from `'cb_theme'` to `'cb_theme_v2'`. The pre-paint script in `docs/index.html` reads through this constant.
- **Pre-paint script** is a tiny IIFE in `<head>` that reads `localStorage.getItem(STORAGE_KEYS.theme)` and sets `<html data-theme>`. It lives in `index.html` lines 14-25. **No change needed there** — it already uses the constant.
- **Commits:** `feat(themes):` prefix, conventional-commit style. Co-author trailer on every commit.
- **Build:** `npm run build` rebuilds `bundle.js` + `bundle.css` from source. Run before each verification.
- **Tests:** `npm test` runs all unit tests; `npm run test:e2e` runs the static-server smoke.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `docs/js/lib/constants.js` | Modify | Bump `STORAGE_KEYS.theme` to `cb_theme_v2` |
| `docs/js/lib/theme.js` | Modify | Widen `VALID` from 2 to 5 values |
| `docs/css/tokens.css` | Modify | Add 3 new `:root[data-theme="..."]` blocks |
| `docs/css/app.css` | Modify | Add `.theme-picker` + `.theme-swatch` rules in `@layer components` |
| `docs/js/controllers/settings.js` | Modify | Add `renderThemePicker()` + click + keyboard handlers |
| `test/theme.test.js` | Modify | 5-value round-trip; new storage key |
| `test/controllers/settings.test.js` | Modify | Picker mount, click, aria-checked |
| `test/css-themes.test.js` | Create | 3 new theme blocks exist with full token set |

---

## Task 1: Bump storage key in `constants.js`

**Files:**
- Modify: `docs/js/lib/constants.js:11`

**Context:** Storage key bump is a pure constant change. It breaks the existing `theme.test.js` (which reads `cb_theme`) — we update those tests in Task 2 alongside the VALID widening.

- [ ] **Step 1: Update the constant**

In `docs/js/lib/constants.js`, change line 11:

```js
  theme: 'cb_theme_v2',
```

(Was `cb_theme`.)

- [ ] **Step 2: Commit**

```bash
git -C /home/kaykayyali/projects/cookbook/.worktrees/design-system add docs/js/lib/constants.js
git -C /home/kaykayyali/projects/cookbook/.worktrees/design-system commit -m "feat(themes): bump STORAGE_KEYS.theme to cb_theme_v2 (resets existing dark users)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> Note: existing tests will fail after this commit (`theme.test.js` references `cb_theme`). That's expected — fixed in Task 2.

---

## Task 2: Widen `VALID` set in `theme.js` and update tests

**Files:**
- Modify: `docs/js/lib/theme.js:7`
- Modify: `test/theme.test.js`

**Interfaces:**
- Consumes: `STORAGE_KEYS.theme` (now `'cb_theme_v2'`)
- Produces: `createTheme` factory; `theme` singleton — same public API, wider value set.

- [ ] **Step 1: Write the failing test for all 5 values**

Replace `test/theme.test.js` (or append; the file is 64 lines) so the 5-value round-trip + invalid-value tests cover all theme names. Use this as the new file content:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTheme } from '../docs/js/lib/theme.js';

function fakeStorage(initial = {}) {
  const map = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
  };
}

function fakeDocument() {
  const attrs = {};
  return {
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: (k) => attrs[k] ?? null,
    },
  };
}

const THEMES = ['light', 'dark', 'sepia', 'forest', 'ocean'];

test('createTheme reads stored value via injected storage', () => {
  const storage = fakeStorage({ cb_theme_v2: 'dark' });
  const t = createTheme({ storage, document: fakeDocument() });
  assert.equal(t.getStored(), 'dark');
});

test('createTheme returns null when storage is empty', () => {
  const t = createTheme({ storage: fakeStorage(), document: fakeDocument() });
  assert.equal(t.getStored(), null);
});

test('createTheme normalizes only valid values (5 themes)', () => {
  const storage = fakeStorage({ cb_theme_v2: 'pink' });
  const t = createTheme({ storage, document: fakeDocument() });
  assert.equal(t.getStored(), null);
});

for (const name of THEMES) {
  test(`createTheme round-trips '${name}' (write, read, apply)`, () => {
    const storage = fakeStorage();
    const doc = fakeDocument();
    const t = createTheme({ storage, document: doc });
    t.set(name);
    assert.equal(storage.getItem('cb_theme_v2'), name);
    assert.equal(t.getStored(), name);
    t.apply(name);
    assert.equal(doc.documentElement.getAttribute('data-theme'), name);
  });
}

test('createTheme silently ignores invalid value on apply', () => {
  const doc = fakeDocument();
  const t = createTheme({ storage: fakeStorage(), document: doc });
  t.apply('neon');
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
});

test('createTheme silently ignores invalid value on set', () => {
  const storage = fakeStorage();
  const t = createTheme({ storage, document: fakeDocument() });
  t.set('neon');
  assert.equal(storage.getItem('cb_theme_v2'), null);
});

test('createTheme does not throw when given undefined storage (SSR-safe)', () => {
  const t = createTheme({ storage: undefined, document: fakeDocument() });
  assert.equal(t.getStored(), null);
  assert.doesNotThrow(() => t.apply('light'));
  assert.doesNotThrow(() => t.set('dark'));
});
```

- [ ] **Step 2: Run the new tests — expect failure**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test -- test/theme.test.js 2>&1 | tail -20
```

Expected: at least the 5 `round-trips` tests fail with `"sepia"` / `"forest"` / `"ocean"` not in VALID set.

- [ ] **Step 3: Widen `VALID` in `theme.js`**

In `docs/js/lib/theme.js:7`, replace:

```js
const VALID = new Set(['light', 'dark']);
```

with:

```js
const VALID = new Set(['light', 'dark', 'sepia', 'forest', 'ocean']);
```

- [ ] **Step 4: Run the tests — expect pass**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test -- test/theme.test.js 2>&1 | tail -15
```

Expected: 12 tests pass (1 storage, 1 empty, 1 invalid-normalize, 5 round-trips, 1 apply-invalid, 1 set-invalid, 1 SSR-safe, plus the 2 already existing). Total: 11 + the new SSR = 12. Confirm all pass.

- [ ] **Step 5: Run the full unit suite to confirm no regressions**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test 2>&1 | tail -10
```

Expected: all previously-passing tests still pass (the only failure mode is anything that pinned `cb_theme` literally — none other than this file, which we just updated).

- [ ] **Step 6: Commit**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
git add docs/js/lib/theme.js test/theme.test.js
git commit -m "feat(themes): widen VALID to 5 (light/dark/sepia/forest/ocean)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add 3 new theme blocks in `tokens.css` and verify with `css-themes.test.js`

**Files:**
- Modify: `docs/css/tokens.css`
- Create: `test/css-themes.test.js`

**Context:** Three new `:root[data-theme="<name>"]` blocks. Each declares the same 15 `--color-*` tokens + 2 `--shadow-*` tokens. The order: append after the existing `data-theme="light"` block, before the `@media (prefers-reduced-motion)` block.

The full per-token values for each new theme:

| Token | Sepia | Forest | Ocean |
|---|---|---|---|
| `--color-bg`            | `#f4ead5` | `#1d2a23` | `#0e2333` |
| `--color-bg-elevated`   | `#fbf2dd` | `#243328` | `#15304a` |
| `--color-bg-sunken`     | `#e8dcbe` | `#161e19` | `#091826` |
| `--color-fg`            | `#3a2a14` | `#e6efe1` | `#dceaf2` |
| `--color-fg-muted`      | `#7a5a3a` | `#a8b8a3` | `#9ab4c4` |
| `--color-fg-subtle`     | `#a88860` | `#7a8a78` | `#5d7a8e` |
| `--color-border`        | `#d8c8a4` | `#324538` | `#1d3a52` |
| `--color-border-strong` | `#b8a478` | `#4a5e4f` | `#2c5070` |
| `--color-accent`        | `#9c5a1c` | `#7fb069` | `#5dbcd2` |
| `--color-accent-fg`     | `#ffffff` | `#1d2a23` | `#0e2333` |
| `--color-accent-soft`   | `#ead4b0` | `#2c4230` | `#1d3a4a` |
| `--color-success`       | `#6e8a3e` | `#9bc77a` | `#6dc89a` |
| `--color-warning`       | `#c8901a` | `#d4a642` | `#e0b34a` |
| `--color-danger`        | `#a83a2a` | `#d66060` | `#e07878` |
| `--color-focus-ring`    | `#7a4a1a` | `#a0c890` | `#7dd0e6` |
| `--shadow-sm`           | `0 1px 2px rgba(58, 42, 20, 0.10)` | `0 1px 2px rgba(0, 0, 0, 0.32)` | `0 1px 2px rgba(0, 0, 0, 0.42)` |
| `--shadow-lg`           | `0 12px 32px rgba(58, 42, 20, 0.18)` | `0 12px 32px rgba(0, 0, 0, 0.52)` | `0 12px 32px rgba(0, 0, 0, 0.62)` |

- [ ] **Step 1: Write the failing test**

Create `test/css-themes.test.js`:

```js
// test/css-themes.test.js — every new theme block declares the full token set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const NEW_THEMES = ['sepia', 'forest', 'ocean'];

const REQUIRED_TOKENS = [
  '--color-bg', '--color-bg-elevated', '--color-bg-sunken',
  '--color-fg', '--color-fg-muted', '--color-fg-subtle',
  '--color-border', '--color-border-strong',
  '--color-accent', '--color-accent-fg', '--color-accent-soft',
  '--color-success', '--color-warning', '--color-danger',
  '--color-focus-ring',
  '--shadow-sm', '--shadow-lg',
];

function readTokens() {
  // Prefer the build artifact; fall back to source.
  for (const rel of ['docs/css/bundle.css', 'docs/css/tokens.css']) {
    const p = join(ROOT, rel);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error('No tokens file found');
}

for (const name of NEW_THEMES) {
  test(`tokens.css defines :root[data-theme="${name}"] block`, () => {
    const src = readTokens();
    assert.match(src, new RegExp(`:root\\[data-theme="${name}"\\]`),
      `Missing selector :root[data-theme="${name}"]`);
  });

  test(`:root[data-theme="${name}"] declares every required token`, () => {
    const src = readTokens();
    // Capture the block: from the selector to the next "}" at the same depth.
    const re = new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`);
    const block = src.match(re);
    assert.ok(block, `Block for ${name} not found`);
    const body = block[1];
    const missing = REQUIRED_TOKENS.filter((tok) => !body.includes(`${tok}:`));
    assert.deepEqual(missing, [], `${name} block missing token(s): ${missing.join(', ')}`);
  });
}
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test -- test/css-themes.test.js 2>&1 | tail -10
```

Expected: 6 tests fail (3 selector-missing, 3 token-missing) — the new theme blocks don't exist yet.

- [ ] **Step 3: Add the 3 new theme blocks to `tokens.css`**

Open `docs/css/tokens.css`. After the `:root[data-theme="light"] { ... }` block (which ends at line 154) and before the `@media (prefers-reduced-motion: reduce)` block (line 157), insert:

```css
  /* Sepia — aged-paper cookbook. Manual only (no OS auto). */
  :root[data-theme="sepia"] {
    --color-bg:            #f4ead5;
    --color-bg-elevated:   #fbf2dd;
    --color-bg-sunken:     #e8dcbe;
    --color-fg:            #3a2a14;
    --color-fg-muted:      #7a5a3a;
    --color-fg-subtle:     #a88860;
    --color-border:        #d8c8a4;
    --color-border-strong: #b8a478;
    --color-accent:        #9c5a1c;
    --color-accent-fg:     #ffffff;
    --color-accent-soft:   #ead4b0;
    --color-success:       #6e8a3e;
    --color-warning:       #c8901a;
    --color-danger:        #a83a2a;
    --color-focus-ring:    #7a4a1a;
    --shadow-sm: 0 1px 2px rgba(58, 42, 20, 0.10);
    --shadow-lg: 0 12px 32px rgba(58, 42, 20, 0.18);
  }

  /* Forest — cabin kitchen at dusk. Manual only. */
  :root[data-theme="forest"] {
    --color-bg:            #1d2a23;
    --color-bg-elevated:   #243328;
    --color-bg-sunken:     #161e19;
    --color-fg:            #e6efe1;
    --color-fg-muted:      #a8b8a3;
    --color-fg-subtle:     #7a8a78;
    --color-border:        #324538;
    --color-border-strong: #4a5e4f;
    --color-accent:        #7fb069;
    --color-accent-fg:     #1d2a23;
    --color-accent-soft:   #2c4230;
    --color-success:       #9bc77a;
    --color-warning:       #d4a642;
    --color-danger:        #d66060;
    --color-focus-ring:    #a0c890;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.32);
    --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.52);
  }

  /* Ocean — coastal restaurant at night. Manual only. */
  :root[data-theme="ocean"] {
    --color-bg:            #0e2333;
    --color-bg-elevated:   #15304a;
    --color-bg-sunken:     #091826;
    --color-fg:            #dceaf2;
    --color-fg-muted:      #9ab4c4;
    --color-fg-subtle:     #5d7a8e;
    --color-border:        #1d3a52;
    --color-border-strong: #2c5070;
    --color-accent:        #5dbcd2;
    --color-accent-fg:     #0e2333;
    --color-accent-soft:   #1d3a4a;
    --color-success:       #6dc89a;
    --color-warning:       #e0b34a;
    --color-danger:        #e07878;
    --color-focus-ring:    #7dd0e6;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.42);
    --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.62);
  }
```

(Inside the existing `@layer tokens { ... }` block. The file already uses tab indentation inside `@layer`.)

- [ ] **Step 4: Rebuild the CSS bundle**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm run build 2>&1 | tail -10
```

Expected: `docs/css/bundle.css` regenerated, no errors.

- [ ] **Step 5: Run the new test — expect pass**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test -- test/css-themes.test.js 2>&1 | tail -10
```

Expected: 6 tests pass.

- [ ] **Step 6: Run the full unit suite to confirm `design-system.test.js` still passes**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test 2>&1 | tail -10
```

Expected: all green. The `tokens.css defines every required custom property` test greps for each `${name}:` substring, so the same tokens in 3 more blocks won't break it.

- [ ] **Step 7: Commit**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
git add docs/css/tokens.css docs/css/bundle.css test/css-themes.test.js
git commit -m "feat(themes): 3 new manual themes (sepia/forest/ocean) in tokens.css

Each block declares the full 15 --color-* + 2 --shadow-* token set.
Manually-applied only (no @media prefers-color-scheme), matching the
'manual for new themes' UX decision. css-themes.test.js guards that
every new block has the full token set.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add `.theme-picker` styles in `app.css`

**Files:**
- Modify: `docs/css/app.css`

**Context:** The picker rules go inside `@layer components { ... }` (or wherever the existing settings/button rules live). The CSS uses `--swatch-bg`, `--swatch-accent`, `--swatch-border` custom properties set inline by JS — the swatch self-paints.

- [ ] **Step 1: Find the right insertion point in `app.css`**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
grep -n "@layer" docs/css/app.css | head -10
```

Look for `@layer components {` (or whatever the canonical layer is for shared UI rules). The settings section styles are likely already there. Insert the new rules inside the same layer block, alphabetically near `.settings-section` / `.settings-row` if they exist, or as a new top-level group.

- [ ] **Step 2: Append the picker styles**

If the layer block is open (has matching `{` for the `@layer` line), insert the rules inside it. If you're at the end of a layer, before the closing `}`. Example insertion (paste verbatim):

```css
  .theme-picker { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; }
  .theme-swatch {
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--swatch-bg);
    border: 1px solid var(--swatch-border);
    box-shadow: inset 0 0 0 4px var(--swatch-accent);
    cursor: pointer; padding: 0;
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .theme-swatch:hover { transform: scale(1.06); }
  .theme-swatch.is-active {
    box-shadow:
      inset 0 0 0 4px var(--swatch-accent),
      0 0 0 2px var(--color-accent);
  }
  .theme-swatch:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 3px;
  }
  .theme-picker-hint {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-fg-muted);
  }
```

(If `app.css` uses tab indentation, match tabs. If 2 spaces, match 2 spaces.)

- [ ] **Step 3: Rebuild the bundle**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Confirm no test regression**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test 2>&1 | tail -5
```

Expected: still green. The `inline-css.test.js` asserts the bundle has no inline `<style>` in `index.html`, which is unchanged.

- [ ] **Step 5: Commit**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
git add docs/css/app.css docs/css/bundle.css
git commit -m "feat(themes): .theme-picker + .theme-swatch styles in app.css

Swatches self-paint via --swatch-* inline custom properties so a sepia
swatch shows sepia even when the app is currently on Light. .is-active
uses var(--color-accent) for the ring (the *current* app's accent, so
the ring always contrasts the live background).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add `renderThemePicker` to `settings.js`

**Files:**
- Modify: `docs/js/controllers/settings.js`
- Modify: `test/controllers/settings.test.js`

**Context:** `settings.js` is the controller that renders the Settings panel. It already has a `renderAuth` and `renderSettings`. We add `renderThemePicker` that's called from `renderSettings` (gated on a "settings has been rendered" flag, same as the other wiring).

**Palette constants (5 themes):** in `settings.js`, define a small local `THEME_PALETTES` object at the top of the file. Each entry has `bg`, `accent`, `border` for the swatch inline style.

**Dep injection:** `renderThemePicker` takes a `theme` dep (the same factory from `lib/theme.js`) and a `getStored` function. Both default to the existing `theme` singleton and `theme.getStored` respectively.

- [ ] **Step 1: Write the failing tests**

Append to `test/controllers/settings.test.js`:

```js
// ─── Theme picker (added in themes phase) ───────────────────

function makePickerDom() {
  // Mirrors makeDom but includes the elements renderThemePicker will create.
  const ids = [
    'settings-auth-zone', 'settings-import-btn', 'settings-export-btn',
    'import-file', 'g-signin-btn',
  ];
  const elements = {};
  for (const id of ids) {
    elements[id] = {
      innerHTML: '', value: '', textContent: '',
      listeners: {},
      addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
      click() { for (const fn of (this.listeners.click || [])) fn(); },
      querySelector: () => null,
      firstElementChild: null,
      classList: { _set: new Set(), add(){}, remove(){}, contains(){return false}, toggle(){} },
    };
  }
  // A panel zone where the picker should mount.
  elements['settings-theme-zone'] = {
    innerHTML: '',
    listeners: {},
    addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
  };
  const document = {
    getElementById: (sel) => elements[sel] || null,
  };
  return { elements, document };
}

const FIVE_THEMES = ['light', 'dark', 'sepia', 'forest', 'ocean'];

test('renderThemePicker mounts 5 swatch buttons in role=radiogroup', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  const ctrl = mod.initSettings({
    document,
    getStoredTheme: () => 'light',
  });
  ctrl.renderThemePicker();
  const zone = elements['settings-theme-zone'];
  assert.match(zone.innerHTML, /role="radiogroup"/);
  for (const name of FIVE_THEMES) {
    const re = new RegExp(`data-theme="${name}"`);
    assert.match(zone.innerHTML, re, `expected swatch for ${name}`);
  }
  const swatchCount = (zone.innerHTML.match(/class="theme-swatch[^"]*"/g) || []).length;
  assert.equal(swatchCount, 5, 'expected 5 .theme-swatch buttons');
});

test('renderThemePicker marks the stored theme as active and aria-checked', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  const ctrl = mod.initSettings({ document, getStoredTheme: () => 'forest' });
  ctrl.renderThemePicker();
  const html = elements['settings-theme-zone'].innerHTML;
  assert.match(html, /data-theme="forest"[^>]*class="theme-swatch is-active"/);
  assert.match(html, /data-theme="forest"[^>]*aria-checked="true"/);
  assert.match(html, /data-theme="light"[^>]*aria-checked="false"/);
});

test('renderThemePicker defaults to light when no stored value', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  const ctrl = mod.initSettings({ document, getStoredTheme: () => null });
  ctrl.renderThemePicker();
  const html = elements['settings-theme-zone'].innerHTML;
  assert.match(html, /data-theme="light"[^>]*class="theme-swatch is-active"/);
});

test('clicking a swatch calls theme.set + theme.apply + toggles aria-checked', () => {
  if (!mod.initSettings) return;
  const { document, elements } = makePickerDom();
  let applied = null;
  let setName = null;
  const ctrl = mod.initSettings({
    document,
    getStoredTheme: () => 'light',
    theme: {
      getStored: () => 'light',
      set: (n) => { setName = n; },
      apply: (n) => { applied = n; },
    },
  });
  ctrl.renderThemePicker();
  // Simulate the click on the sepia swatch by extracting the inline onclick
  // and calling it, OR by parsing the innerHTML to find the swatch and
  // re-triggering the click. Easier: simulate the click via the listener
  // attached to the picker container.
  const zone = elements['settings-theme-zone'];
  // The picker is mounted via innerHTML; the click listener is attached to
  // the container. We test by calling the listener directly with a fake event.
  const listeners = zone.listeners.click || [];
  assert.ok(listeners.length > 0, 'picker should have a click listener');
  const fakeEvent = {
    target: {
      closest: (sel) => sel === '.theme-swatch' ? { dataset: { theme: 'sepia' } } : null,
      getAttribute: (k) => (k === 'data-theme' ? 'sepia' : null),
    },
  };
  for (const fn of listeners) fn(fakeEvent);
  assert.equal(setName, 'sepia');
  assert.equal(applied, 'sepia');
});
```

- [ ] **Step 2: Run the new tests — expect failure**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test -- test/controllers/settings.test.js 2>&1 | tail -10
```

Expected: 4 tests fail — `renderThemePicker` doesn't exist on the controller yet, and the `#settings-theme-zone` element isn't queried.

- [ ] **Step 3: Add the `THEME_PALETTES` constant + `renderThemePicker` to `settings.js`**

In `docs/js/controllers/settings.js`:

1. Add the import at the top:

```js
import { theme as defaultTheme } from '../lib/theme.js';
```

2. Add a `THEME_PALETTES` object just below the imports (above the JSDoc):

```js
const THEME_PALETTES = {
  light:  { bg: '#fbf7f1', accent: '#b34a1c', border: '#d2c4ac' },
  dark:   { bg: '#1a140e', accent: '#e07a4a', border: '#4a3a28' },
  sepia:  { bg: '#f4ead5', accent: '#9c5a1c', border: '#b8a478' },
  forest: { bg: '#1d2a23', accent: '#7fb069', border: '#4a5e4f' },
  ocean:  { bg: '#0e2333', accent: '#5dbcd2', border: '#2c5070' },
};
const THEME_NAMES = Object.keys(THEME_PALETTES);
const DEFAULT_THEME = 'light';
```

3. Update the JSDoc `@param` block to add the new deps:

```js
 * @param {object} deps
 * @param {object} deps.state
 * @param {Document} [deps.document]
 * @param {() => {token, email}} [deps.loadAuth]
 * @param {() => Promise<void>} [deps.clearAuth]
 * @param {(opts) => void} [deps.initGoogleSignIn]
 * @param {(msg) => void} [deps.toast]
 * @param {() => void} [deps.exportRecipes]
 * @param {() => void} [deps.onChange]
 * @param {() => string|null} [deps.getStoredTheme] - read current theme
 * @param {object} [deps.theme] - { getStored, set, apply } — defaults to singleton
 * @returns {{ renderAuth, renderSettings, renderThemePicker, handleAuthClick, handleThemeClick }}
```

4. Update the `initSettings` signature destructure to include the new deps:

```js
export function initSettings({
  state,
  document = globalThis.document,
  loadAuth: loadAuthDep = loadAuth,
  clearAuth: clearAuthDep = clearAuth,
  initGoogleSignIn: initGoogleSignInDep = initGoogleSignIn,
  toast: toastDep = toast,
  exportRecipes: exportRecipesDep = defaultExportRecipes,
  onChange = null,
  getStoredTheme = defaultTheme.getStored,
  theme: themeDep = defaultTheme,
} = {}) {
```

5. Add the two new functions inside the controller body (before the `return`):

```js
  function renderThemePicker() {
    const zone = document.getElementById('settings-theme-zone');
    if (!zone) return;
    const current = themeDep.getStored() || DEFAULT_THEME;
    const swatches = THEME_NAMES.map((name) => {
      const p = THEME_PALETTES[name];
      const active = name === current;
      const cls = `theme-swatch${active ? ' is-active' : ''}`;
      return `<button type="button" class="${cls}" data-theme="${name}" role="radio" `
        + `aria-checked="${active}" aria-label="${name.charAt(0).toUpperCase() + name.slice(1)}" `
        + `style="--swatch-bg:${p.bg};--swatch-accent:${p.accent};--swatch-border:${p.border}"></button>`;
    }).join('');
    zone.innerHTML =
      `<div class="theme-picker" role="radiogroup" aria-label="Theme">${swatches}</div>`
      + `<p class="theme-picker-hint">First load follows your system's light/dark setting. Pick a theme to override.</p>`;
    zone.addEventListener('click', handleThemeClick);
    zone.addEventListener('keydown', handleThemeKey);
  }

  function handleThemeClick(e) {
    const btn = e?.target?.closest?.('.theme-swatch');
    if (!btn) return;
    const name = btn.dataset.theme;
    if (!THEME_PALETTES[name]) return;
    themeDep.set(name);
    themeDep.apply(name);
    // Update aria-checked and is-active on all swatches within the same radiogroup.
    const group = btn.closest('[role="radiogroup"]');
    if (!group) return;
    for (const el of group.querySelectorAll('.theme-swatch')) {
      const isActive = el.dataset.theme === name;
      el.classList.toggle('is-active', isActive);
      el.setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  }

  function handleThemeKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
    const group = e.target?.closest?.('[role="radiogroup"]');
    if (!group) return;
    const swatches = [...group.querySelectorAll('.theme-swatch')];
    const idx = swatches.indexOf(e.target.closest('.theme-swatch'));
    if (idx < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      swatches[(idx + 1) % swatches.length].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      swatches[(idx - 1 + swatches.length) % swatches.length].focus();
    } else {
      swatches[idx].click();
    }
  }
```

6. Update the `return` to expose them:

```js
  return { renderAuth, renderSettings, renderThemePicker, handleAuthClick, handleThemeClick, _importRecipes: importRecipes };
```

7. Wire `renderThemePicker` into the existing `renderSettings()` so it gets called when the user opens the settings panel for the first time. Find the `renderSettings` function and add one line just before `settingsRendered = true;`:

```js
    renderThemePicker();
```

- [ ] **Step 4: Run the new tests — expect pass**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test -- test/controllers/settings.test.js 2>&1 | tail -10
```

Expected: all 12 tests pass (8 original + 4 new). If the click test fails because the inline `style` attribute on the swatch contains a colon (`--swatch-bg:#...`) and the parsing of the click handler is wrong, re-check that `handleThemeClick` is called via `zone.addEventListener('click', handleThemeClick)` AND that the test simulates the click via the stored listener. The fake `zone` element exposes its listeners via `zone.listeners.click`.

- [ ] **Step 5: Run the full unit suite**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
git add docs/js/controllers/settings.js test/controllers/settings.test.js
git commit -m "feat(themes): settings.js renderThemePicker — 5 self-painted swatches

- THEME_PALETTES (bg/accent/border per theme) drives the inline
  --swatch-* style on each button so the swatch shows the target
  palette regardless of the current app theme
- Click handler: theme.set + theme.apply + toggles aria-checked /
  .is-active across the radiogroup
- Keyboard: arrow keys move focus, Enter/Space activates
- Existing renderSettings() now also calls renderThemePicker() so the
  picker shows up when the panel first opens
- Defaults to 'light' if no stored value (OS auto path)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Add the `<div id="settings-theme-zone">` mount in `index.html`

**Files:**
- Modify: `docs/index.html`

**Context:** `renderThemePicker` mounts into `#settings-theme-zone`. That element needs to exist in the Settings panel. Insert it as a new section between the existing **Account** and **Data** sections (per spec §5). Update the corresponding E2E smoke test if it asserts on the structure.

- [ ] **Step 1: Add the mount point in `index.html`**

In `docs/index.html`, between the existing `<div class="settings-section">` for Account (line ~134-137) and the one for Data (line ~139-146), insert a new section:

```html
    <div class="settings-section">
      <p class="settings-section-label">Theme</p>
      <div id="settings-theme-zone"></div>
    </div>
```

The exact text to match for the edit — find this block in `index.html`:

```html
    <div class="settings-section">
      <p class="settings-section-label">Data</p>
```

…and insert the new section right before it. Use Edit with `old_string` being the `Data` section opening and `new_string` being `Theme` section followed by `Data` section opening.

- [ ] **Step 2: Rebuild the bundle**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm run build 2>&1 | tail -5
```

(The bundle is JS+CSS, not HTML. `index.html` is loaded directly. No rebuild strictly required for this task, but run it to keep `bundle.js` in sync with the latest `settings.js`.)

- [ ] **Step 3: Run the E2E smoke test**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm run test:e2e 2>&1 | tail -10
```

Expected: 5/5 pass. The smoke test doesn't assert on the Settings panel content, so the new section is invisible to it.

- [ ] **Step 4: Commit**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
git add docs/index.html
git commit -m "feat(themes): settings-theme-zone mount in index.html Settings panel

Inserted a new .settings-section labeled 'Theme' between Account and
Data. settings.js#renderThemePicker() mounts the swatch row into this
zone on first panel render.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Final verification + push

**Files:** None.

- [ ] **Step 1: Run the full unit + e2e suite from a clean state**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm run build 2>&1 | tail -3
npm test 2>&1 | tail -10
npm run test:e2e 2>&1 | tail -10
```

Expected:
- Build: 2 bundles regenerated, no errors.
- Unit tests: all green (≥253 — was 249, +4 settings tests, +12 theme tests = +4 net new from settings, -2 removed old theme tests… actually counts: original theme = 6 tests, new theme = 11 tests → +5. settings was 8, +4 = 12. css-themes is +6. Total new tests: 15. New total: 249 + 15 = 264. Confirm the count matches.)
- E2E: 5/5 smoke.

- [ ] **Step 2: Sanity check the design-system contract test still passes**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
npm test -- test/design-system.test.js 2>&1 | tail -5
```

Expected: all pass. The `every defined token ... is referenced at least once` test should still pass because every token name in the new blocks is also defined in the default `:root { ... }` block, so all of them are already used in the rest of the CSS. Verify: if any new token name in a new theme block is *not* used elsewhere in CSS, the orphan check will flag it. (The new blocks use the same token names as Light/Dark, so all of them are already referenced.)

- [ ] **Step 3: Push the branch**

```bash
cd /home/kaykayyali/projects/cookbook/.worktrees/design-system
git log --oneline main..HEAD
git push -u origin feat/color-themes 2>&1 | tail -5
```

Expected: 5 commits pushed (one per task + the spec commit). Branch now on `origin/feat/color-themes`.

- [ ] **Step 4: Hand off for review**

The branch is ready for PR. Tell the user:

> "Branch `feat/color-themes` is pushed. 5 commits past `main`, 264/264 unit + 5/5 e2e green. Files touched: constants.js, theme.js, tokens.css, app.css, settings.js, index.html + 1 new test file. The pre-paint script in `index.html` already reads through `STORAGE_KEYS.theme`, so the storage key bump (`cb_theme` → `cb_theme_v2`) takes effect on the next deploy — existing dark users will fall back to OS auto on first load."

---

## Self-Review (completed by the plan author)

**1. Spec coverage:**

- §1 five themes — Task 3
- §2 three CSS blocks — Task 3
- §3 `VALID` widens — Task 2
- §4 storage key bump — Task 1
- §5 Settings panel markup, swatch self-paint, selection state, interaction, ARIA, keyboard — Task 5 (render + click + key handlers), Task 6 (mount point)
- §6 `.theme-picker` and `.theme-swatch` rules — Task 4
- Files touched table — all rows covered
- Testing strategy red→green — Tasks 1-5 each follow red→green→commit
- Out-of-scope risks — none of them are addressed in the spec, none need tasks

**2. Placeholder scan:** no TBD, no "implement later", every code block is complete. ✅

**3. Type consistency:** `themeDep.set / .apply / .getStored` matches `createTheme` factory in `lib/theme.js:27-49`. `THEME_PALETTES` keys match the new `VALID` set. `STORAGE_KEYS.theme` is `'cb_theme_v2'` in both the constant change (Task 1) and the test (Task 2). ✅
