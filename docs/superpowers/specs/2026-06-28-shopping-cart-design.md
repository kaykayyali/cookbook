# PRD 1 — Shopping cart

**Status:** Proposed (awaiting implementation plan)
**Depends on:** nothing (purely client-side; builds on the existing local-first architecture).
**Scope:** a single feature, suitable for one implementation plan.

## 1. Problem

Users can already see which recipes they can make and which ingredients they're missing, but
there's no way to **collect** missing ingredients across multiple recipes into a single shopping
list. When planning several meals, the user has to mentally aggregate "I need eggs for the
shakshuka *and* eggs for the alfredo" themselves.

## 2. Goal

Let a user, from any recipe, push its missing (not-in-pantry) ingredients into a shopping cart,
then view a consolidated cart in the Pantry panel where each ingredient shows its per-recipe
contributions and quantities — e.g. `Eggs — 5 total (2 eggs: Shakshuka, 3 eggs: Alfredo Sauce)`.

## 3. User stories

- As a cook planning meals, I open a recipe and tap "Add missing items to cart" so I don't have to
  remember what to buy.
- As a shopper, I open the Pantry's Shopping cart section and see every missing ingredient grouped,
  with which recipe each came from and how much, so I can shop once for several meals.
- As a user, adding the same recipe again doesn't double-count its contributions.

## 4. Out of scope (YAGNI)

- No server, no sync, no auth. The cart is device-local like recipes and pantry.
- No auto-removal of cart items when an ingredient is added to the pantry (see §10).
- No printing / sharing the cart (can be added later).
- No price, aisle, or store metadata.

## 5. Architecture

Fits the existing layering exactly:

- **`lib/cart.js` (new, pure, no DOM):** ingredient parsing, cart mutation, grouping, and
  summation logic. Unit-tested under Node like the rest of `lib/`.
- **`components/cart.js` (new):** turns cart data into HTML strings for the cart section.
- **`lib/store.js` (extend):** add `cart: []` to `state` and persist it under a new
  `STORAGE_KEYS.cart = 'cb_cart'`.
- **`app.js` (extend):** render the cart section, wire the "Add missing items to cart" button and
  cart remove/clear handlers.
- **`docs/index.html` (extend):** add a "Shopping cart" section inside the Pantry panel, and the
  cart button in the recipe detail modal footer.
- **`lib/pantry.js` (refactor):** promote the quantity/unit regexes into a reusable
  `parseIngredient(raw)` so cart and pantry share one parser.

## 6. Data model

### 6.1 Cart item
```
{
  name: string,        // baseName(raw) — lowercase noun; the GROUP KEY
  line: string,        // original raw ingredient text, e.g. "2 tablespoons olive oil"
  qtyText: string,     // captured leading qty+unit snippet, e.g. "2 tbsp" / "6" / "¼ tsp" / "" for unquantified
  recipeId: string,   // _id of the contributing recipe
  recipeName: string   // recipe.name, denormalised for display without a lookup
}
```

### 6.2 Cart
- `cart: CartItem[]`, persisted at `cb_cart`.
- **Idempotency:** the cart is keyed per `(recipeId, line)`. Adding a recipe's missing items
  **replaces** that recipe's existing contributions rather than appending duplicates. This means
  re-adding a recipe after editing it refreshes its contributions; it never double-counts.

### 6.3 Ingredient parsing (`parseIngredient`)
- Input: a raw ingredient line.
- Output: `{ qtyText, name }`.
  - `qtyText` = the leading run matched by the existing `LEADING_QTY` + `LEADING_UNIT` regexes,
    captured rather than discarded (the current `baseName` discards it). Examples:
    `"2 tablespoons olive oil"` → `{ qtyText: "2 tablespoons", name: "olive oil" }`;
    `"6 large eggs"` → `{ qtyText: "6", name: "large eggs" }` (note: "large" is not a unit, so it
    stays in the name — acceptable and consistent with today's `baseName`);
    `"salt and pepper to taste"` → `{ qtyText: "", name: "salt and pepper to taste" }`.
- `baseName(raw)` is reimplemented as `parseIngredient(raw).name` so behaviour is unchanged for
  pantry autocomplete.

## 7. Components & UI

### 7.1 Recipe detail modal
- Add a button to the detail footer: **"Add missing items to cart"** (between View JSON-LD and
  Edit).
- On click: compute the recipe's missing lines (those where `!haveIngredient(line, pantry)`),
  remove any existing cart items with this `recipeId`, and push a cart item per missing line.
  Toast: `"Added N missing items to cart"` (or `"Nothing missing — you have everything"`).

### 7.2 Pantry panel — Shopping cart section
- A new section above (or below) the pantry tags, titled "Shopping cart".
- Empty state: `"Your cart is empty. Open a recipe and tap “Add missing items to cart.”"`.
- Populated: one row per **group** (group key = `name`). Each row shows:
  - The ingredient name.
  - An **optional total** shown only when *every* contribution in the group has the same comparable
    unit and a numeric quantity (see §8.2). Otherwise no total.
  - The contribution list: `(qtyText: recipeName)` per contribution, e.g.
    `(2 eggs: Shakshuka, 3 eggs: Alfredo Sauce)`. Empty `qtyText` renders as just the recipe name.
  - A remove control per contribution, and a **"Clear cart"** control for the whole cart.

## 8. Logic (`lib/cart.js`)

### 8.1 Mutations (pure, return new arrays / objects)
- `addToCart(cart, recipe)` → `{ cart, addedCount }`. Removes any existing items with
  `recipe._id`, then appends a cart item per missing line (`!haveIngredient(line, pantry)`).
  Requires `pantry` as a parameter.
- `removeFromCart(cart, item)` → new cart without that exact item (matched by identity/reference
  or by `(recipeId, line)`).
- `clearRecipeFromCart(cart, recipeId)` → new cart without that recipe's contributions.
- `clearCart()` → `[]`.

### 8.2 Grouping & summation
- `groupCart(cart)` → `Map<name, CartItem[]>` (insertion-ordered).
- `sumIfHomogeneous(items)` → `{ total: number|null, unit: string|null }`. Returns a total only
  when every item's parsed quantity is numeric and shares the same unit; otherwise `null`.
  - Quantity/unit are extracted from `qtyText` (a leading number + optional unit). Items with
    empty `qtyText` (e.g. "to taste") make the group non-homogeneous → no total.
  - This is deliberately conservative: it never produces a misleading sum. When in doubt, it
    falls back to the contribution list only.

### 8.3 Rendering helper
- `cartGroupsHTML(cart)` (in `components/cart.js`) renders the grouped list per §7.2, calling
  `groupCart` and `sumIfHomogeneous`.

## 9. Persistence & state

- `STORAGE_KEYS.cart = 'cb_cart'` added to `lib/constants.js`.
- `store.state.cart = []`; `save()` writes it; `load()` reads it (tolerant of absence → `[]`).
- `init()` seeds cart as `[]` (never seeded with sample data, unlike recipes/pantry).
- Mutations in `app.js` update `state.cart`, call `save()`, and re-render the cart section (and, if
  the detail modal is open, the "missing" count on the button).

## 10. Behaviour decisions

- **Cart is independent of the pantry.** Adding an ingredient to the pantry (existing tap-to-
  toggle) does **not** remove it from the cart. Rationale: the cart is a shopping list, not a
  mirror of the pantry; coupling them would cause surprising deletes. (Future enhancement, out
  of scope here: a "move checked-off items to pantry" action.)
- **Optional "mark as bought"** is deferred (out of scope for v1) to keep the PRD focused. The
  data model leaves room for a future `bought: boolean` per item.
- **Re-adding a recipe refreshes** its contributions (idempotency per §6.2), so editing a recipe
  and re-adding it updates the cart rather than duplicating.

## 11. Error handling

- Empty recipe (no ingredients) → button toast: `"This recipe has no ingredients"`.
- Recipe with all ingredients in pantry → toast: `"Nothing missing — you have everything"`.
- Corrupt `cb_cart` in localStorage → `load()` falls back to `[]` (same pattern as recipes/pantry).

## 12. Testing

New `test/cart.test.js` covering the pure functions, run by the existing `node --test` suite:

- `parseIngredient`: qty/unit capture, unquantified lines, parity with `baseName`.
- `addToCart`: only missing lines added, existing recipe contributions replaced (idempotency),
  correct `addedCount`, respects `pantry`.
- `removeFromCart`, `clearRecipeFromCart`, `clearCart`: pure, no mutation of input.
- `groupCart`: correct grouping by `name`, insertion order preserved.
- `sumIfHomogeneous`: sums matching-unit numeric quantities; returns `null` on unit mismatch,
  empty quantities, or non-numeric values.

No new dependencies. No browser/DOM required for the logic tests.

## 13. Acceptance criteria

1. From a recipe detail modal, "Add missing items to cart" adds exactly the not-in-pantry
   ingredients, and the Pantry cart section shows them grouped with per-recipe quantities.
2. The cart renders the example shape: `Eggs — 5 total (2 eggs: Shakshuka, 3 eggs: Alfredo
   Sauce)` when units match; without a total when they don't.
3. Re-adding the same recipe does not duplicate its contributions.
4. Removing a contribution and clearing the cart both work and persist across reloads.
5. The app remains fully offline-capable; the cart adds no network dependency.
6. `npm test` passes with the new `cart.test.js` added and no regressions in existing tests.