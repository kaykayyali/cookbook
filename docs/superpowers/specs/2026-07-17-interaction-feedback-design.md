# Issue #23 interaction-feedback design reference

Date: 2026-07-17
Baseline: `51ca083d00aea31c550b47a14d5cb374875a4610`

## Intent

Feedback is a progressive enhancement layered over the existing visible state, focus, toast, and live-region contracts. Feature code emits semantic intent (`select`, `toggle-on`, `toggle-off`, `commit`, `success`, `destructive`, or `blocked`); independent adapters decide whether visual, sound, or haptic feedback is available and enabled.

## Baseline visual references

Generated before production changes with:

```sh
ISSUE23_CAPTURE=before node --test test/e2e-interaction-feedback.test.js
```

The browser fixture writes mobile and desktop PNGs under `artifacts/issue-23/before/` for Week, Recipes, recipe detail, Pantry, Shopping, Settings, and the detail drawer/modal pattern. The same fixture writes matched after captures under `artifacts/issue-23/after/`.

## Interaction inventory

| Journey | Immediate signal | Outcome signal | Motion |
| --- | --- | --- | --- |
| Week navigation, meal slot, servings | `select` / `toggle-*` | `commit`, `success`, `blocked` | 120ms press; optimistic row state |
| Recipes and detail | `select` | `commit`, `success`, `destructive`, `blocked` | 120ms card/press; modal transform only |
| Pantry | `select` / `commit` | `success`, `destructive` | 120ms card insertion/removal without reflow animation |
| Shopping | `toggle-*` / `commit` | `success`, `destructive` | 140ms completion/restoration |
| Settings | `select` / `toggle-*` | persistent visible checked state | 100ms press; no decorative motion |
| Drawers/modals | `select` | existing visible/open state | 140ms opacity/transform, no layout shift |
| Cooking history | `commit` | `success`, `destructive`, `blocked` | optimistic content remains authoritative; short state fade |
| Sync recovery | none for passive sync | `blocked` only after visible recoverable failure | existing status/live announcement; no vibration without active gesture |

## Palette

- **select:** dry 920Hz triangle tick, 24ms, 0.012 peak; optional 8ms pulse.
- **toggle-on/off:** 760Hz/520Hz square-softened clicks, 30ms; optional 12ms pulse.
- **commit:** 430Hz triangle clack, 42ms; optional 16ms pulse.
- **success:** restrained 660Hz + 880Hz two-part confirmation; optional `[14, 34, 18]` pulse.
- **destructive:** low 190Hz triangle thunk, 48ms; optional `[20, 24, 12]` pulse.
- **blocked:** soft 300→240Hz descending cue, 48ms; no haptic by default because failures often resolve outside transient user activation.

All amplitudes are low, sounds are rate-limited and non-overlapping, haptics are meaningful rather than universal, and unsupported/rejected/background behavior is a silent no-op. Android hardware timing remains a documented manual-validation item.

Sound and haptic preferences use independent device-local keys. The sound adapter migrates `cb_interface_sounds_v1` to `cb_interface_sounds_v2`; haptics use `cb_interface_haptics_v1`. Confirmation-gated destructive actions remain silent when cancelled and emit their destructive cue only after confirmation.
