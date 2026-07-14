# Plan-to-shopping generation

**Status:** Planned
**Depends on:** `03-week-planner`, `04-shared-shop-pantry`

## Goal

Turn chosen meal-plan entries into one concise shared shopping list using the existing deterministic quantity pipeline.

## In scope

- Select a date range or the current week.
- Include recipe entries and exclude skipped/dining-out/open entries.
- Use each plan entry's target servings.
- Aggregate first, buffer once, and round with existing deterministic rules.
- Merge generated needs without deleting manual items or unrelated existing items.
- Record plan provenance so regeneration is idempotent and explainable.

## Out of scope

- AI arithmetic
- Automatic pantry subtraction
- Price optimization

## Acceptance criteria

- [ ] Generating the same unchanged week twice creates no duplicates.
- [ ] Changing servings updates only plan-derived quantities.
- [ ] Manual items and removal overrides remain intact.
- [ ] Both members see the generated list.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Regeneration after partial shopping
- Recipe changes after planning

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
