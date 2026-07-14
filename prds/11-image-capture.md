# Camera and image recipe capture

**Status:** Planned
**Depends on:** `02-household-recipes`, `06-pwa-shell`

## Goal

Turn cookbook pages, cards, screenshots, and multi-page photos into reviewable recipe drafts.

## In scope

- Add camera/photo-file entry with mobile capture affordance.
- Support crop/rotate and ordered multi-page uploads.
- Extract structured recipe fields through server-side OCR/vision.
- Preserve source images and confidence/provenance on the draft.
- Highlight uncertain fields and require review before household publication.
- Detect likely duplicates before save.

## Out of scope

- Silent auto-publish
- Bulk book digitization
- Training on private household images
- Guaranteed handwriting accuracy

## Acceptance criteria

- [ ] A real iPhone can capture or select an image.
- [ ] Multi-page order is preserved.
- [ ] Failed/uncertain extraction leaves an editable draft and original images.
- [ ] No recipe enters the household library without explicit confirmation.

## TDD and verification

1. Add focused failing unit/contract/UI tests for every changed state transition and migration.
2. Observe RED before implementation.
3. Implement the smallest complete vertical slice.
4. Run focused tests, then `npm test` and `npm run build`.
5. Run `git diff --check` and verify the real browser/device flow named in the acceptance criteria.

## Risks / known unknowns

- Image size and Workers limits
- Handwriting quality
- Private photo retention
- Duplicate matching

## Slice boundary

This slice must ship as one working commit. If implementation cannot be verified independently, split it before coding.
