# Household identity and membership

**Status:** Implemented; production account sign-in verification pending
**Depends on:** None

## Goal

Create one private household and map authenticated users to explicit household memberships.

## In scope

- Add idempotent D1 schema for households and household_members.
- Resolve the signed-in user to household membership in API middleware/helpers.
- Add an invitation/acceptance path restricted to the configured private user set.
- Expose household and member display data to the client without exposing email unnecessarily.
- Backfill/migrate existing authenticated users safely before validating the new state shape.

## Out of scope

- Recipe ownership migration
- Shared planner, shopping, pantry, or history
- Public invitations or household discovery

## Acceptance criteria

- [x] Kaysser and Gloria are configured as distinct invitees to the same household and auto-accept on authenticated boot.
- [x] An authorized user without membership gets an explicit onboarding state, not another user's data.
- [x] Unauthorized identities remain denied.
- [x] Repeated schema setup and invitation acceptance are idempotent.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Invitation replay and mistaken cross-household access
- Auth-sub stability and display-name fallback

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
