# Weekly planner and Week home

**Status:** Planned
**Depends on:** `02-household-recipes`

## Goal

Make a seven-day household plan the default landing experience, centered on tonight's meal.

## In scope

- Add meal_plan_entries with household ownership, date, slot/type, recipe, servings, planner, cook assignment, note, and status.
- Build a mobile-first Week view and Tonight card.
- Support recipe, leftovers, dining out, and open entries.
- Allow add, move, skip, repeat, and serving adjustment with optimistic feedback.
- Preserve Recipes, Shop, and Pantry as one-tap destinations.

## Out of scope

- Shopping-list generation
- Push reminders
- Calendar provider integration

## Acceptance criteria

- [ ] Week is the default authenticated route.
- [ ] Either member sees and updates the same week.
- [ ] A week can contain non-recipe meal types and empty days.
- [ ] Long recipe names and rapid concurrent edits remain usable on iPhone widths.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Date/timezone boundaries
- Concurrent edits from two phones
- Avoiding a dense calendar UI

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
