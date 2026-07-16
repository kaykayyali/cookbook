# Shared shopping and pantry synchronization

**Status:** Planned
**Depends on:** `01-household-membership`

## Goal

Make shopping and pantry hints household-shared while retaining instant local interactions.

## In scope

- Add authoritative D1 models/API for shopping items and pantry hints.
- Synchronize check, restore, remove, clear, and manual-add operations.
- Store Shopping and Pantry items with one compatible normalized quantity/unit contract.
- Preserve and accumulate a bought Shopping item's purchase quantity when it moves to Pantry.
- Normalize legacy string-only Pantry entries at read time without requiring a one-off migration.
- Preserve recipe-origin/removal tombstones and deterministic cart semantics.
- Keep pantry informational and non-subtractive.
- Provide optimistic UI with visible retry only on failure.

## Out of scope

- Offline outbox
- Plan-derived list generation
- Barcode inventory or exact stock counts

## Acceptance criteria

- [ ] A check on one signed-in device becomes visible on the other.
- [ ] Concurrent mutations cannot resurrect cleared or removed items.
- [ ] Manual items survive recipe-set normalization.
- [ ] Recipe-derived and manual Shopping items retain their normalized quantity when checked into Pantry.
- [ ] Repeated compatible Pantry additions accumulate; incompatible units are never added numerically.
- [ ] Existing string-only Pantry data remains readable as qualitative normalized entries.
- [ ] Pantry never removes a required shopping item.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Mutation ordering and idempotency
- Migrating browser-local list state without duplication

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
