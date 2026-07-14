# Installable PWA shell

**Status:** Planned
**Depends on:** `03-week-planner`

## Goal

Make the cookbook installable and app-like on iPhone without an App Store release.

## In scope

- Add manifest, standalone display settings, icons, Apple touch metadata, and theme colors.
- Add a versioned service worker for the immutable app shell and offline fallback.
- Add a one-time Safari Add-to-Home-Screen guide.
- Provide explicit update-available behavior rather than silently serving mixed assets.
- Verify safe-area, standalone navigation, and Google sign-in behavior on a real iPhone.

## Out of scope

- Full data offline mutation support
- Native App Store packaging
- Push reminders

## Acceptance criteria

- [ ] Safari offers an app-style Home Screen install path.
- [ ] Installed launch opens in standalone mode with the expected icon and colors.
- [ ] The shell opens offline with a clear data state.
- [ ] A new deployment upgrades without stale mixed-version assets.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Service-worker cache invalidation
- Standalone OAuth return behavior
- iOS-specific safe areas

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
