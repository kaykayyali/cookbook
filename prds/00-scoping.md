# Our Cookbook — Product Scoping

**Status:** Accepted defaults; roadmap locked
**Date:** 2026-07-13

## Product vision

Our Cookbook is a private household cooking companion for Kaysser and Gloria: **plan together → shop together → cook → remember → get better suggestions**. It should be unusually usable on a phone and quietly romantic through shared history, attribution, and thoughtful language—not hearts, streak guilt, or social-network mechanics.

## What the idea commits to

| Phrase | Commitment |
|---|---|
| “This app is for us” | One private household with two personal identities and shared household state. |
| “We both like cooking” | Planning and cooking flows treat either partner or both as the cook. |
| “Plan meals for a week” | Week becomes the primary home and planning surface. |
| “Slightly romantic, more focused on usability” | Warm shared-memory language is subordinate to speed, clarity, and accessibility. |
| “Track, rate, suggest, scan” | Cook history feeds personal ratings; ratings feed explainable suggestions; image capture produces reviewed drafts. |
| “Fake iPhone app” | Installable standalone PWA with offline-safe behavior, not an App Store binary. |

## Verified current state

- Google authentication already identifies users.
- D1 is the authoritative recipe store, but recipe queries are currently scoped by `author_sub` (`functions/_lib/recipes.js`).
- Pantry, cart, normalization cache, and shopping check state are primarily browser-local.
- URL and structured recipe extraction already exist.
- No web app manifest or service worker exists today.
- The current deployment is Cloudflare Pages + Functions + D1 + Workers AI.
- Apple documents adding a website to the iPhone Home Screen and opening it as a web app: <https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios>.

## Locked defaults

1. **Week is the default landing screen**, with a prominent Tonight card.
2. A household is the ownership boundary for recipes, plans, shopping, pantry hints, and cooking history.
3. Kaysser and Gloria retain separate profiles, preferences, ratings, and attribution.
   This is one permanent shared household for exactly those two users; generalized multi-tenant isolation and tenant-management machinery are out of scope.
4. Shared remote D1 state is authoritative; IndexedDB is a cache/outbox for fast reloads and offline-safe optimistic updates.
5. The planner supports recipes, leftovers, dining out, and open nights without forcing seven planned recipes.
6. Plan-to-shop reuses deterministic normalization, serving scaling, aggregation, buffering, and rounding.
7. Cook history records events; ratings belong to individuals rather than collapsing both tastes into one value.
8. Suggestions deterministically filter candidates before AI ranking and always explain why a recipe was suggested.
9. Camera/image import creates an editable draft with confidence cues; it never silently publishes.
10. Romantic tone stays subtle: “Tonight at home,” “planned by Gloria,” “you both loved this,” and shared meal memories.
11. PWA installation is delivered without an App Store release; offline and update behavior are explicit.
12. Features ship as test-first, cohesive product waves. Each wave closes a meaningful user loop rather than landing isolated plumbing.

## Core information model

| Entity | Purpose |
|---|---|
| `households` | Private home/cooking space. |
| `household_members` | User membership, display identity, role, and personal preferences. |
| `recipes.household_id` | Shared ownership while retaining `added_by_sub`. |
| `meal_plan_entries` | Date, meal slot/type, recipe, servings, planner, cook assignment, note, and status. |
| `shopping_items` | Shared manual/recipe-derived list with completion and removal metadata. |
| `cook_events` | What was cooked, when, by whom, for whom, servings, notes, and optional photo. |
| `recipe_ratings` | Per-person reaction tied to a cook event. |
| `recipe_import_drafts` | Reviewable image/URL extraction before publishing. |

## Product surfaces

- **Week:** default home, Tonight card, seven-day planning, leftovers/open/eating-out states.
- **Recipes:** shared household library, attribution, planning/history badges, capture entry points.
- **Shop:** synchronized list derived from plans plus manual items.
- **Pantry:** shared informational hints only; never subtractive.
- **Cook:** focused steps, timers, keep-awake where supported, finish-and-remember flow.
- **Memories:** recipe history and lightweight household recap, integrated rather than a social feed.

## Explicitly out of scope for this roadmap

- Public social profiles, followers, or public recipe feeds.
- App Store packaging or native Swift application.
- Automatic nutrition/medical guidance.
- Fully trusted pantry inventory or automatic pantry subtraction.
- AI arithmetic for scaling, aggregation, buffering, or shopping quantities.
- Automatic publication of OCR/vision output.
- Relationship streaks, guilt-based reminders, or excessive romantic decoration.

## Delivery waves

The numbered PRDs remain detailed contracts, but adjacent contracts ship together as larger product waves.

| Wave | Included PRDs | Working outcome |
|---|---|---|
| 01 — Household foundation | 01 | Both admitted identities enter one permanent private household. |
| 02 — Plan and shop together | 02–05 | Sign in without refresh, share the recipe library, plan the week from a Tonight-first home, and generate one synchronized shopping list. |
| 03 — App-like and offline-safe | 06–07 | Installable iPhone PWA with cached reads, durable optimistic mutations, and recovery. |
| 04 — Remember and choose better | 08–10 | Cooking history, individual ratings/shared memories, and explainable suggestions. |
| 05 — Capture and cook | 11–12 | Reviewable image capture, focused cooking mode, reminders, and final household polish. |

## Delivery rule

Each wave is one independently verifiable product loop and release. Tests are written RED first for each behavior inside the wave. Persisted schema additions include migration/backfill before validation. Intermediate checkpoints may verify independently, but the release gate covers the complete wave end to end.

## Out-of-band dependencies

- Google OAuth identities for both household members.
- Cloudflare Pages/Functions, D1, and Workers AI bindings.
- Real iPhone Safari verification for installation, standalone auth, camera capture, safe areas, and offline recovery.
- Gloria must be authorized by deployment configuration before household acceptance can be verified end-to-end.

## Decision log

| Date | Decision |
|---|---|
| 2026-07-13 | Kaysser accepted all proposed defaults, including Week as home and the complete delivery order above. |
| 2026-07-14 | Kaysser asked for fewer, more substantial releases. The 12 detailed contracts are grouped into five cohesive delivery waves; the active Wave 02 combines PRDs 02–05. |
