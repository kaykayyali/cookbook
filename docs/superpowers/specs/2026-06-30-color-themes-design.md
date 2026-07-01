# Color Themes — Design

**Date:** 2026-06-30
**Branch:** TBD (new from `main`)
**Status:** Draft

## Context

The app ships with two color themes — Light and Dark — both stored under the
`cb_theme` localStorage key. The picker doesn't exist; the user only gets a
default based on `prefers-color-scheme`, with the dark variant selectable via
the same OS-level toggle. The user has asked for **3 additional themes** in the
Settings page, and to **reset all existing users to OS auto on first load** so
that the choice is conscious rather than carried over from a two-theme world.

The current `tokens.css` is the single source of color truth — every visual
decision in the app references one of the `--color-*` tokens it defines. The
theme system therefore extends to a per-`data-theme` block, not a per-element
override.

The change is **frontend-only**. No backend, no schema change, no sync.

## Goals

1. Ship 5 themes total: **Light**, **Dark**, **Sepia**, **Forest**, **Ocean**.
2. Add a **swatch picker** to the Settings page so the user can pick any of
   the five.
3. **OS auto** for Light/Dark on first load is preserved. The new themes are
   always manual choices.
4. Existing `cb_theme=dark` users **migrate to OS auto** on first load after
   this ships — implementation is a storage-key bump.

## Non-goals

- Per-section theming (sidebar vs body). One theme, whole page.
- User-defined custom themes. Pre-defined only.
- Cloud-synced theme choice. localStorage only.
- High-contrast / accessibility-themed variants. Could be a future theme.
- A "Reset to default" button in the picker. The default = "no stored value"
  is reachable by clearing site data; the picker doesn't need an explicit
  Default button.

## Design

### 1. Five themes

| Theme | `--color-bg` | `--color-accent` | Mood |
|---|---|---|---|
| **Light**  | `#fbf7f1` (existing) | `#b34a1c` (existing) | Default warm-paper cookbook |
| **Dark**   | `#1a140e` (existing) | `#e07a4a` (existing) | Default dark mode |
| **Sepia**  | `#f4ead5` (aged paper)  | `#9c5a1c` (warm tan) | 1970s cookbook. Yellowed pages, brown ink, easier on the eyes than white |
| **Forest** | `#1d2a23` (deep pine)   | `#7fb069` (moss green) | Cabin kitchen at dusk. Dark green, sage accent |
| **Ocean**  | `#0e2333` (midnight blue) | `#5dbcd2` (sea-foam) | Coastal restaurant at night. The dark theme that doesn't feel like every other dark theme |

The remaining ~13 tokens per new theme (border, fg, fg-muted, success,
warning, danger, focus-ring, plus the two shadows) are filled in to be a
coherent palette — same warm/cool logic as existing Light/Dark, three new
moods.

### 2. CSS — three new `:root[data-theme="..."]` blocks in `tokens.css`

The file's current shape:

```css
:root { /* light defaults */ }
@media (prefers-color-scheme: dark) { :root { /* dark via OS */ } }
:root[data-theme="dark"]  { /* dark via manual */ }
:root[data-theme="light"] { /* light via manual */ }
```

Additions, all **manual-only** (no `prefers-color-scheme` media query — these
are deliberate picks, not OS preferences):

```css
:root[data-theme="sepia"]  { /* full token set */ }
:root[data-theme="forest"] { /* full token set */ }
:root[data-theme="ocean"]  { /* full token set */ }
```

Each block declares the same 15 `--color-*` tokens and the 2 `--shadow-*`
tokens. Typography / spacing / radii / motion are theme-agnostic and stay
as-is.

### 3. `theme.js` — widen the value space

- `VALID` widens from `Set(['light', 'dark'])` to
  `Set(['light', 'dark', 'sepia', 'forest', 'ocean'])`.
- The `createTheme` API (`getStored / apply / set`) is unchanged. Only the
  set of valid values widens.
- The default `theme` singleton behavior is unchanged for invalid values —
  they are silently ignored.

### 4. Storage key bump — `cb_theme` → `cb_theme_v2`

- `STORAGE_KEYS.theme` changes from `'cb_theme'` to `'cb_theme_v2'`.
- The pre-paint script in `docs/index.html` reads through this constant, so
  it picks up the new key automatically.
- Effect: any stored `cb_theme=dark` value becomes a dead value on disk.
  Existing users fall back to OS auto on first load after this ships. This
  matches the "reset all users to OS auto" decision.
- Small leak (one orphan localStorage entry per user). Acceptable; not worth
  a cleanup pass.

### 5. Settings panel — Theme picker

A new `<section class="settings-section">` between the existing **Account**
and **Data** sections.

**Markup (rendered by `settings.js`):**

```html
<p class="settings-section-label">Theme</p>
<div class="theme-picker" role="radiogroup" aria-label="Theme">
  <button class="theme-swatch is-active" data-theme="light"  role="radio" aria-checked="true"  aria-label="Light"></button>
  <button class="theme-swatch"           data-theme="dark"   role="radio" aria-checked="false" aria-label="Dark"></button>
  <button class="theme-swatch"           data-theme="sepia"  role="radio" aria-checked="false" aria-label="Sepia"></button>
  <button class="theme-swatch"           data-theme="forest" role="radio" aria-checked="false" aria-label="Forest"></button>
  <button class="theme-swatch"           data-theme="ocean"  role="radio" aria-checked="false" aria-label="Ocean"></button>
</div>
<p class="theme-picker-hint">First load follows your system's light/dark setting. Pick a theme to override.</p>
```

**Swatch rendering — self-painted with target theme tokens:**

Each swatch paints itself using the *target* theme's palette (a sepia swatch
shows sepia even when the app is currently on Light). Implementation: each
button gets an inline `style="--swatch-bg: <bg>; --swatch-accent: <accent>;
--swatch-border: <border>"` set from a small theme-palette object in
`settings.js`. CSS rules read those custom properties to paint the swatch.
The user sees what they're choosing.

**Selection state:**

- The selected swatch has a 2px outer ring in `var(--color-accent)` (the
  currently active theme's accent — so the ring contrasts the live app
  background) and the `.is-active` class.
- The current value is read on render and used to set `is-active` and
  `aria-checked` on the right swatch.
- If the stored value is missing (OS auto path), the rendered active swatch
  is `light` (the default) — even when the actual applied theme is dark
  via OS preference. Showing the wrong swatch is worse than showing the
  default; the hint text explains OS auto behavior.

**Interaction:**

- Click a swatch → `theme.set(name)` + `theme.apply(name)` + toggle
  `aria-checked` and `is-active` on the swatches.
- No "Apply" / "Save" button. Clicking is the action.
- Keyboard: arrow keys move selection within the radiogroup; Enter applies
  the focused swatch.
- ARIA: `role="radiogroup"` on the container, `role="radio"` on each
  swatch, `aria-checked` reflects state.

### 6. CSS — new rules in `app.css` @layer components

```css
@layer components {
  .theme-picker { display: flex; gap: var(--space-3); flex-wrap: wrap; }
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
}
```

## Data flow

1. **First load** (no `cb_theme_v2` value in storage):
   - Pre-paint script in `<head>` finds no stored value → does nothing.
   - CSS `@media (prefers-color-scheme: dark)` applies Dark tokens.
   - Settings panel renders with **Light** marked active (the default). The
     hint text explains OS auto behavior.

2. **First load after upgrade** (had `cb_theme` = `dark`):
   - New key `cb_theme_v2` is empty → OS auto path (same as above).
   - Old `cb_theme` value is left on disk. Dead value; no cleanup.

3. **User picks a theme**:
   - Click → `theme.set(name)` writes `cb_theme_v2` → `theme.apply(name)`
     sets `<html data-theme="name">` → CSS swaps tokens instantly.
   - Swatch `aria-checked` and `is-active` class update.

4. **Subsequent loads with stored choice**:
   - Pre-paint script reads `cb_theme_v2` → `cb_theme_v2=forest` →
     `<html data-theme="forest">` set before paint.
   - OS auto media query is overridden by the manual block.
   - Settings panel renders with the stored theme marked active.

## Files touched

| File | Change |
|---|---|
| `docs/css/tokens.css`              | +3 `:root[data-theme="..."]` blocks (~45 lines each) |
| `docs/js/lib/constants.js`         | `theme: 'cb_theme'` → `theme: 'cb_theme_v2'` |
| `docs/js/lib/theme.js`             | `VALID` set widens to 5 values |
| `docs/js/controllers/settings.js`  | New `renderThemePicker` + click handler + keyboard nav |
| `docs/css/app.css`                 | +`.theme-picker` and `.theme-swatch` rules in `@layer components` |
| `docs/index.html`                  | No markup change (settings panel is rendered by JS) |
| `test/theme.test.js`               | Updated for 5 values + new storage key |
| `test/settings.test.js`            | New tests for picker (mount, click, aria-checked) |
| `test/css-themes.test.js` (new)    | Asserts 3 new theme blocks each contain the full token set |

## Testing strategy (TDD, single phase)

Order: red → green → red → green per file.

### Red — `test/theme.test.js` additions
- `createTheme` round-trips all 5 values: write `sepia`, read `sepia`, apply
  sets `data-theme="sepia"`.
- Setting an invalid value (`'neon'`) is silently ignored.
- Storage key is now `cb_theme_v2`. Existing tests that pin the key
  (`STORAGE_KEYS.theme === 'cb_theme'`) are flipped to `cb_theme_v2`.

### Red — `test/settings.test.js` additions
- `renderSettings` mounts a `.theme-picker` with 5 `.theme-swatch` buttons.
- Clicking a swatch calls `theme.set` + `theme.apply` with the right name.
- `aria-checked` toggles to the clicked swatch and away from the others.
- Initial `is-active` is set from the stored value (or `light` if none).

### Red — `test/css-themes.test.js` (new)
- Loads `docs/css/bundle.css` text.
- For each of `sepia`, `forest`, `ocean`: asserts the selector
  `:root[data-theme="<name>"]` exists.
- For each of those blocks: asserts every required token name appears
  (same list as `design-system.test.js`: bg, bg-elevated, bg-sunken, fg,
  fg-muted, fg-subtle, border, border-strong, accent, accent-fg,
  accent-soft, success, warning, danger, focus-ring, shadow-sm, shadow-lg).
- Asserts the @layer cascade order is still
  `tokens, base, layout, components, app` (regression guard).

### Green
1. `docs/js/lib/constants.js` — bump key.
2. `docs/js/lib/theme.js` — widen VALID.
3. `docs/css/tokens.css` — add 3 blocks.
4. `docs/js/controllers/settings.js` — add picker render + wire.
5. `docs/css/app.css` — add picker styles.
6. `npm run build` → re-bundle.
7. Re-run all tests.

### Verify
- `node --test` — all pass (existing 249 + new).
- `npm run test:e2e` — 5/5 smoke pass.
- Spot-check `test/design-system.test.js` — the existing token-listing
  assertions should still pass; if any of them pinned "exactly one
  occurrence" of a token name, relax to "≥1".

## Out-of-scope risks

- **Swatch color fidelity** — if a swatch can't reach its own target
  tokens (e.g. the swatch is inside a parent that has its own
  `data-theme` override), it would inherit the parent's palette. We
  avoid this by using the inline-style `--swatch-*` custom properties
  rather than relying on `var(--color-bg)` directly inside the swatch.
- **OS auto + manual Sepia race** — pre-paint script sets
  `data-theme="sepia"` if stored, but the `prefers-color-scheme` media
  query is still in the bundle. The manual block must come **after** the
  media query (it does — same order rule as the existing Light/Dark
  blocks).
- **Storage leak** — old `cb_theme` value remains on disk. One orphan
  entry per user, ~10 bytes. Not worth a cleanup script.
- **Token count drift** — if the design-system test pins the exact count
  of `--color-*` token definitions, adding 3 blocks of the same tokens
  may break it. Will adjust the test to count unique token *names* if
  needed.

## Open questions

None — design is fully specified.
