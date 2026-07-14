# IndexedDB cache and durable outbox

**Status:** Planned
**Depends on:** `04-shared-shop-pantry`, `06-pwa-shell`

## Goal

Keep household data immediately available while preserving D1 as the sole authority and safely replaying offline mutations.

## In scope

- Add versioned IndexedDB stores for read cache and mutation outbox.
- Render cached recipes, plan, shopping, and pantry immediately on reload.
- Queue idempotent mutations with client operation IDs.
- Replay in order after reconnect and reconcile server acknowledgements.
- Surface only actionable sync errors and provide retry/discard recovery.
- Backfill new IndexedDB state before validation on upgrades.

## Out of scope

- Peer-to-peer device sync
- Making IndexedDB authoritative
- Background AI work while offline

## Acceptance criteria

- [ ] Reload displays cached household data before network completion.
- [ ] Offline edits survive app termination and sync once online.
- [ ] Replaying the same operation cannot duplicate it.
- [ ] Remote truth wins after reconciliation without silently losing local intent.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Conflict policy
- Storage eviction
- Service-worker/client version skew

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
