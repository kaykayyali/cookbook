# Cooking history

**Status:** Planned
**Depends on:** `03-week-planner`

## Goal

Record what the household actually cooked so recipes gain useful history and shared memory.

## In scope

- Add cook_events with household, recipe, plan link, timestamp, participants, cook assignment, servings, notes, and optional photo reference.
- Add Mark cooked from Tonight, Week, recipe, and cooking-mode surfaces.
- Update plan entry status atomically with event creation.
- Show last cooked and cook count on relevant recipe surfaces.
- Support correction or deletion without corrupting plan history.

## Out of scope

- Ratings and recommendation ranking
- Automatic meal recognition
- Public activity feed

## Acceptance criteria

- [ ] Marking a planned meal cooked creates one idempotent event.
- [ ] Either member sees the shared history.
- [ ] Recipe cards can show accurate last-cooked metadata.
- [ ] Editing/deleting an event leaves an auditable, consistent plan state.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Duplicate taps/events
- Timezone and backdated meals
- Photo retention/privacy

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
