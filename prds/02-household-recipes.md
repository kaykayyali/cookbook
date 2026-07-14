# Household-owned recipe migration

**Status:** Planned
**Depends on:** `01-household-membership`

## Goal

Move recipe visibility from per-author silos to the private household while preserving attribution and ownership controls.

## In scope

- Add household_id and added_by_sub semantics to recipes.
- Backfill existing rows into the accepted household without losing recipe JSON or timestamps.
- List household recipes to either member while preserving who added each recipe.
- Define household edit/delete permissions and deterministic duplicate handling.
- Run migration before new schema validation and test legacy rows explicitly.

## Out of scope

- Meal planning
- Ratings/history
- Public recipe sharing

## Acceptance criteria

- [ ] Both members see the same household library.
- [ ] Existing recipes remain intact and attributed.
- [ ] A member outside the household cannot read or mutate rows.
- [ ] Migration can be rerun without duplicating or dropping recipes.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Two members may already own duplicate copies
- Existing author-scoped API assumptions

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
