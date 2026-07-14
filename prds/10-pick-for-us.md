# Explainable Pick for us suggestions

**Status:** Planned
**Depends on:** `09-ratings-memories`

## Goal

Recommend three useful household recipes from real library/history data and explain each choice.

## In scope

- Deterministically filter by household access, explicit dislikes/diet, time, and required recipe data.
- Rank candidates using both personal ratings, recency, effort, cuisine repetition, leftovers, and optional pantry hints.
- Offer Reliable favorite, Something different, and Quick option lanes.
- Use AI only for ranking/explanation over valid candidates, with deterministic fallback.
- Add feedback signals without silently rewriting explicit preferences.

## Out of scope

- Inventing recipes
- AI quantity math
- Black-box single-answer recommendation
- External restaurant suggestions

## Acceptance criteria

- [ ] Every suggestion is an existing accessible recipe.
- [ ] Each card explains why it fits both people.
- [ ] Hard dislikes/diet constraints are never bypassed.
- [ ] The feature remains useful with no AI response and honest with sparse history.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Cold start
- Conflicting preferences
- Overfitting to a small number of ratings

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
