# Cooking mode, reminders, and household polish

**Status:** Planned
**Depends on:** `06-pwa-shell`, `09-ratings-memories`

## Goal

Complete the daily experience with a focused cooking surface, optional reminders, and subtle shared-home personality.

## In scope

- Add step-focused cooking mode with large type, ingredient context, timers, and keep-awake where supported.
- Add optional weekly-plan and post-cook rating reminders with quiet defaults.
- Add household language and small memory summaries such as meals cooked together.
- Polish loading, empty, undo, retry, offline, and update states across all primary surfaces.
- Audit keyboard, screen-reader, reduced-motion, touch-target, and iPhone safe-area behavior.

## Out of scope

- Voice assistant platform integrations
- Relationship gamification
- Mandatory notifications
- Heavy decorative redesign

## Acceptance criteria

- [ ] A recipe can be cooked one-handed without screen clutter.
- [ ] All reminders are opt-in, individually configurable, and easy to silence.
- [ ] Romantic language is contextual and never blocks usability.
- [ ] Primary flows pass accessibility and real-device mobile QA.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Wake-lock support varies
- Timer reliability when backgrounded
- Tone becoming repetitive or overly sentimental

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
