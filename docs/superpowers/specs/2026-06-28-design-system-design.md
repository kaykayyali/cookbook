# Design System

**Date:** 2026-06-28
**Status:** Draft — awaiting user review
**Branch:** `feat/design-system` (from `main` @ `54eec01`)
**Scope:** Frontend only — `docs/css/`, `docs/js/components/`, `docs/index.html`. No data-layer or backend changes.

## 1. Purpose

Cookbook's frontend currently has a single hand-written `docs/css/styles.css` plus four component files in `docs/js/components/`. Visual decisions are inlined in component HTML strings; reusable styles are repeated; the design tokens (color, spacing, type) are implicit. This makes the UI hard to evolve coherently — a typographic or color change today is a find-and-replace exercise across the codebase.

This design system establishes an explicit **token layer**, a small set of **primitives**, and rebuilt **composites** that replace the existing component files. After this change, every visual decision lives in `docs/css/`; every component consumes the system.

## 2. Non-goals

- No new features. This is a visual rebuild, not a feature addition.
- No data-layer changes. `docs/js/lib/` (cart, pantry, store, schema, parse, normalize, filters, format, icons, dom, constants) is untouched.
- No backend changes. `functions/` is untouched.
- No build step. CSS is plain layered CSS with custom properties. No preprocessor, no PostCSS, no Tailwind.
- No new UI affordances. No modals, tabs, or dropdowns unless an existing view needs them.
- No migration shims. Existing views are rebuilt atomically; no parallel "old + new" period.

## 3. Visual register

Warm and editorial, in the spirit of NYT Cooking: cream-paper backgrounds, terracotta accent, serif display type paired with humanist sans body, generous whitespace, soft elevation. Reads like a personal recipe box rather than a productivity tool.

## 4. Constraints (locked from brainstorming)

| Decision | Value |
|---|---|
| CSS architecture | Native CSS layers + custom properties |
| Dark mode | Included in v1 |
| Viewport bias | Mobile-first |
| Component API | Hybrid — CSS classes for layout, JS factories for interactive primitives |
| Type pairing | Serif display + sans body |
| Palette | Concrete hex values in the design doc |
| Migration shape | Atomic — full replacement in one branch |
| Token/primitive/composite scope | All three, full replacement |

## 5. Token layer

All tokens live in `docs/css/tokens.css` as CSS custom properties. Two scopes: `:root` (light, default) and `:root[data-theme="dark"]` (manual override) plus `@media (prefers-color-scheme: dark)` for automatic. Every other file references tokens — never raw hex/px/colors.

### 5.1 Color — light theme

| Token | Hex | Role |
|---|---|---|
| `--color-bg` | `#fbf7f1` | Page background (warm cream paper) |
| `--color-bg-elevated` | `#ffffff` | Cards, sheets, popovers |
| `--color-bg-sunken` | `#f1ebe0` | Insets, code, table stripes |
| `--color-fg` | `#2a1f17` | Primary text (espresso) |
| `--color-fg-muted` | `#6b5a4a` | Secondary text |
| `--color-fg-subtle` | `#9b8a78` | Captions, helper text, disabled |
| `--color-border` | `#e8dfd0` | Hairlines |
| `--color-border-strong` | `#d2c4ac` | Heavier dividers, focus rings at rest |
| `--color-accent` | `#b34a1c` | Terracotta — buttons, links, active states |
| `--color-accent-fg` | `#ffffff` | Text on accent |
| `--color-accent-soft` | `#f4dcc8` | Tinted bg for tags, badges |
| `--color-success` | `#5e7a3a` | "In pantry", added-to-cart |
| `--color-warning` | `#b8861a` | Low stock, expiring |
| `--color-danger` | `#9a2a2a` | Destructive, errors |
| `--color-focus-ring` | `#9a4a1a` | Always-visible `:focus-visible` ring (AA against bg; warm-tinted to match register) |

### 5.2 Color — dark theme

`--color-bg: #1a140e`, `--color-bg-elevated: #221a13`, `--color-bg-sunken: #15100a`, `--color-fg: #f4ecdf`, `--color-fg-muted: #b8a48c`, `--color-fg-subtle: #7a6856`, `--color-border: #2f2519`, `--color-border-strong: #4a3a28`, `--color-accent: #e07a4a`, `--color-accent-fg: #1a140e`, `--color-accent-soft: #3a2418`, `--color-success: #a8c47a`, `--color-warning: #d4a642`, `--color-danger: #d66060`, `--color-focus-ring: #c87a4a` (warm dark-mode focus ring; AA against `#1a140e`).

### 5.3 Typography

- `--font-display: "Source Serif 4", "Lora", "Iowan Old Style", Georgia, serif;` — headlines, recipe titles, h1/h2.
- `--font-body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;`
- `--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;`

Scale (mobile-first; `--text-md` is the root body size):

| Token | Mobile | Desktop ≥1024px |
|---|---|---|
| `--text-xs` | 0.75rem | 0.75rem |
| `--text-sm` | 0.875rem | 0.875rem |
| `--text-md` | 1rem | 1.0625rem |
| `--text-lg` | 1.125rem | 1.25rem |
| `--text-xl` | 1.375rem | 1.5rem |
| `--text-2xl` | 1.75rem | 2rem |
| `--text-3xl` | 2.25rem | 2.75rem |

Line heights: `--leading-tight: 1.15`, `--leading-snug: 1.3`, `--leading-normal: 1.5`, `--leading-relaxed: 1.7`.
Tracking: `--tracking-tight: -0.01em`, `--tracking-normal: 0`, `--tracking-wide: 0.04em`.

### 5.4 Spacing

4px geometric base. Tokens: `--space-0: 0`, `--space-1: 0.25rem`, `--space-2: 0.5rem`, `--space-3: 0.75rem`, `--space-4: 1rem`, `--space-6: 1.5rem`, `--space-8: 2rem`, `--space-10: 2.5rem`, `--space-12: 3rem`, `--space-16: 4rem`, `--space-20: 5rem`, `--space-24: 6rem`.

### 5.5 Radii

`--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 14px`, `--radius-xl: 22px`, `--radius-pill: 999px`. No 0px — sharp corners feel out of register.

### 5.6 Shadow

`--shadow-sm: 0 1px 2px rgba(42, 31, 23, 0.06)`, `--shadow-md: 0 2px 8px rgba(42, 31, 23, 0.08)`, `--shadow-lg: 0 12px 32px rgba(42, 31, 23, 0.12)`. Same shadows in dark theme with `rgba(0, 0, 0, ...)` colors.

### 5.7 Motion

`--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`, `--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)`. Durations: `--dur-fast: 120ms`, `--dur-base: 200ms`, `--dur-slow: 320ms`. `prefers-reduced-motion: reduce` zeroes durations in a media query.

### 5.8 Layout

`--container-narrow: 40rem` (long-form recipe text), `--container-base: 60rem` (recipe detail), `--container-wide: 80rem` (grid views). Breakpoints: `--bp-sm: 40rem`, `--bp-md: 64rem`.

### 5.9 Z-index scale

`--z-base: 0`, `--z-dropdown: 10`, `--z-sticky: 20`, `--z-overlay: 30`, `--z-modal: 40`, `--z-toast: 50`.

## 6. Primitives

Smallest set of named UI atoms. Each lives as a class (in `components.css`) and, for interactive primitives, a JS factory (in `docs/js/lib/ui.js`).

| Primitive | Type | Variants |
|---|---|---|
| `Button` | Class + JS factory | `primary` / `secondary` / `ghost`; sizes `sm` / `md` / `lg`; `:disabled`, `:focus-visible` ring |
| `IconButton` | Class + JS factory | size variants; requires `aria-label` |
| `Input` | Class + JS factory | text / textarea / number / url; error state via `aria-invalid` |
| `Select` | Class | native `<select>` styled |
| `Checkbox` | Class | native styled; used by cart + pantry |
| `Badge` | Class | `neutral` / `accent` / `success` / `warning` / `danger` |
| `Card` | Class | `padding-sm` / `md` / `lg` |
| `Stack` | Class | `.stack-{1..12}` — vertical flex with token gap |
| `Cluster` | Class | `.cluster-{1..12}` — horizontal flex, wrap, token gap |
| `Grid` | Class | `.grid-cards` — auto-fill grid for recipe cards |
| `Divider` | Class | horizontal hairline |
| `Icon` | JS factory | wraps inline SVG; sizes from text scale |
| `Toast` | JS factory | success / error; auto-dismiss via `--dur-slow` |

**Layout primitives** (Stack, Cluster, Grid, Divider, Card) are pure CSS classes — zero JS.
**Interactive primitives** (Button, IconButton, Input, Icon, Toast) are JS factories that return HTML strings (or DOM nodes) with correct ARIA, focus handling, and event wiring attributes.

### 6.1 Why native form controls

Custom `<select>` and `<checkbox`> implementations are an accessibility minefield (keyboard nav, screen reader semantics, mobile pickers). The system styles native elements — looks custom, behaves correctly.

### 6.2 Why no Modal / Tabs

Neither is used by any existing view. Adding them to the system before they're needed violates YAGNI and inflates the surface area.

## 7. Composites

Existing component files in `docs/js/components/` are rebuilt to consume primitives. Each becomes a thin wrapper — same exports, same call sites, new internals.

| File | Now consumes | Visible change |
|---|---|---|
| `recipeCard.js` | `Card`, `Badge`, `Stack`, `Icon` | Serif title, softer elevation, category badge replaces raw meta |
| `recipeDetail.js` | `Card`, `Stack`, `Cluster`, `Divider`, `IconButton` | Two-column on desktop (ingredients / steps side-by-side), stacked on mobile; breadcrumb header |
| `recipeForm.js` | `Input`, `Select`, `Button`, `Stack` | Same fields, restyled; form chrome gains focus indicators |
| `cart.js` (component) | `Card`, `Checkbox`, `IconButton`, `Stack` | Recipe-grouped items; clearer "bought" tap affordance; empty state gains illustration slot |

Component exports and their signatures stay identical. `app.js` requires no changes.

## 8. File layout

```
docs/
  css/
    tokens.css        # @layer tokens — all custom properties + theme switching
    base.css          # @layer base — reset, root typography, body, focus-visible
    layout.css        # @layer layout — .stack-*, .cluster-*, .grid-*, .container-*
    components.css    # @layer components — primitives + composites
    styles.css        # DELETED — replaced by the four files above
  js/
    lib/
      ui.js           # NEW — JS factories for interactive primitives (Button, IconButton, Input, Icon, Toast)
    components/
      recipeCard.js   # rewritten
      recipeDetail.js # rewritten
      recipeForm.js   # rewritten
      cart.js         # rewritten
  index.html          # imports the four CSS files in order
```

`docs/js/lib/ui.js` is the only new JS file. It depends on `dom.js` for safe HTML composition (already in the codebase).

## 9. Theme switching

- Default: light.
- `@media (prefers-color-scheme: dark)` applies dark tokens automatically.
- A `[data-theme="dark"]` attribute on `<html>` overrides for users who choose explicit dark.
- Manual toggle lives in the existing sidebar footer (now part of `app.js`'s `renderAuth`/settings area) and writes the preference to `localStorage` under a new key `cb_theme`.
- Initial paint avoids a flash by reading `localStorage` synchronously in an inline `<script>` in `<head>` before any CSS loads.

## 10. Accessibility non-negotiables

A full visual rebuild is when accessibility silently regresses. The system encodes these as required behaviors:

1. Every interactive primitive has a visible `:focus-visible` ring using `--color-focus-ring`.
2. Every `IconButton` requires an `aria-label`.
3. Every `Input` is associated with a `<label>` (visual or `aria-label`).
4. Color contrast: `--color-fg` on `--color-bg` ≥ 7:1; `--color-fg-muted` on `--color-bg` ≥ 4.5:1; `--color-accent-fg` on `--color-accent` ≥ 4.5:1. Both themes.
5. `prefers-reduced-motion: reduce` removes all transitions.
6. Touch targets ≥ 44×44px.
7. Form errors are announced via `aria-live="polite"` regions managed by `ui.js`.

## 11. Testing

Existing tests (`test/*.test.js`) cover data-layer logic and are unaffected.

**New test:** `test/design-system.test.js` validates the design-system contract — not visual output, but invariants:

- All tokens defined in `tokens.css` are referenced at least once in `components.css` (no orphans).
- Every primitive class name appears at least once in the corresponding component file (no dead primitives).
- No raw hex values outside `tokens.css` (enforced by a grep test).
- No raw `px` font sizes outside `tokens.css` (enforced by a grep test).
- `docs/js/lib/ui.js` exports `Button`, `IconButton`, `Input`, `Icon`, `Toast`.

Run with `npm test` — same script as today.

## 12. Migration mechanics

- One branch (`feat/design-system`).
- One PR.
- Atomic — no parallel "old + new" period. The migration is one commit series, not interleaved with other work.
- The branch is created from `main` @ `54eec01` (the post-shopping-cart merge).
- Rebase strategy: rebase onto `main` immediately before opening the PR, after `feat/google-auth` lands.
- If `feat/google-auth` adds UI affordances (`#auth-area`, `renderAuth` sign-in button), the design system must subsume those styles — not fight them. Implementation order: tokens → base → layout → primitives → composites → auth-area restyle.

## 13. Open risks

1. **`feat/google-auth` merge order.** If auth UI affordances land in `main` before this branch rebases, the auth UI must be re-themed against the new system in this same PR. Otherwise the auth UI looks like the old system while the rest looks like the new one.
2. **`feat/recipe-extraction` (if it lands before us).** Same concern — any new UI affordances in that branch must be re-themed here.
3. **Accessibility regression risk during the rebuild.** The system encodes the non-negotiables (§10), but the implementation can still drift. Mitigation: `test/design-system.test.js` plus the foreground code review.

## 14. Out of scope (explicit)

- Animations beyond the duration tokens.
- A Figma / design tool handoff — this repo is the source of truth.
- Component documentation site — `docs/superpowers/specs/` covers it.
- Storybook or any visual review tooling.
- Migration of the standalone `cookbook.html` file at the repo root (legacy — not deployed).

## 15. Acceptance criteria

A reviewer should be able to look at the deployed `docs/` site and confirm:

1. The site uses the warm cream/terracotta palette specified in §5.1.
2. Recipe titles render in serif; body text in sans.
3. Dark mode works (manual toggle + automatic).
4. Mobile viewport (375px wide) is comfortable to read and tap.
5. Every interactive element is keyboard-reachable with a visible focus ring.
6. The four existing component files (`recipeCard`, `recipeDetail`, `recipeForm`, `cart`) all consume primitives — no inline styles, no raw colors.
7. `npm test` passes (existing + new tests).