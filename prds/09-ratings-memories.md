# Personal ratings and recipe memories

**Status:** Planned
**Depends on:** `08-cook-history`

## Goal

Capture each person's reaction without turning dinner into a survey or erasing differences in taste.

## In scope

- Add per-member rating/reaction tied to a cook event.
- Use a fast Loved it / Good / Not for us interaction plus optional would-make-again and note.
- Allow each member to update only their own reaction.
- Show both reactions, shared agreement, and remembered notes on recipes.
- Prompt optionally after cooking or on the next visit; never block the flow.

## Out of scope

- AI suggestions
- Public comments
- Relationship scores or streaks

## Acceptance criteria

- [ ] Kaysser and Gloria can rate the same cook event independently.
- [ ] One member's edit cannot overwrite the other's rating.
- [ ] Prompts can be dismissed and do not nag repeatedly.
- [ ] Warm copy remains concise and accessible.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Sparse early data
- Sensitive/private notes
- Avoiding notification fatigue

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
