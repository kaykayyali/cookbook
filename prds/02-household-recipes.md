# Wave 02 — Plan and shop together

**Status:** In progress
**Depends on:** `01-household-membership`

## Goal

Close the first complete household loop: sign in, share the recipe library, plan the week from a Tonight-first home, and generate one synchronized shopping list.

## Carry-forward defect

- After a successful Google sign-in, the login gate remains visible until the page is manually refreshed.
- This slice must repair the authenticated boot handoff before migrating recipe ownership so the real sign-in-to-library path can be verified end to end.

## In scope

- Add household_id and added_by_sub semantics to recipes.
- Backfill existing rows into the accepted household without losing recipe JSON or timestamps.
- List household recipes to either member while preserving who added each recipe.
- Define household edit/delete permissions and deterministic duplicate handling.
- Run migration before new schema validation and test legacy rows explicitly.
- Make a successful sign-in immediately resolve household membership and load the authenticated application without a manual refresh.
- Add the seven-day Week home with Tonight primary, serving targets, and recipe/leftovers/dining-out/open states.
- Support add, move, skip, repeat, and serving adjustments against authoritative household plan entries.
- Move Shopping and pantry hints to synchronized D1 state while preserving the existing deterministic cart behavior, removal overrides, and optimistic feedback.
- Generate or regenerate the current week's recipe needs into Shopping using plan servings, aggregate/buffer/round once, retain manual items, and record plan provenance.
- Deliver the contracts in `03-week-planner.md`, `04-shared-shop-pantry.md`, and `05-plan-to-shop.md` as part of this wave rather than separate releases.

## Out of scope

- Ratings/history
- Public recipe sharing
- PWA installation and durable offline outbox
- Calendar providers, push reminders, barcode stock, pricing, or AI arithmetic

## Acceptance criteria

- [ ] Both members see the same household library.
- [ ] Existing recipes remain intact and attributed.
- [ ] A member outside the household cannot read or mutate rows.
- [ ] Migration can be rerun without duplicating or dropping recipes.
- [ ] After Google sign-in, the household library appears without refreshing the page.
- [ ] Week is the default authenticated home and both members see the same seven-day plan.
- [ ] Recipe, leftovers, dining-out, and open entries work at iPhone width, including move/skip/repeat and serving changes.
- [ ] Shopping checks, manual items, generated items, removals, and pantry hints synchronize without stale resurrection.
- [ ] Regenerating an unchanged week creates no duplicates; changed servings update only plan-derived needs.
- [ ] One end-to-end browser flow proves sign in → plan dinner → generate Shopping without a page reload.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria, including a fresh signed-out-to-signed-in transition with no reload.

## Risks / known unknowns

- Two members may already own duplicate copies
- Existing author-scoped API assumptions
- Google Identity Services callback timing may race household bootstrap or initialize the authenticated app more than once.
- Date/timezone boundaries and rapid updates from two devices.
- Preserving checked/manual/removal state through deterministic plan regeneration.

## Wave boundary

The complete sign-in → plan → shop loop ships as one release. Internal behaviors still follow RED/GREEN checkpoints, but PRDs 02–05 are not separately released.
