# PRD 1 — Shopping cart

**Status:** Proposed (awaiting implementation plan)
**Depends on:** nothing (purely client-side; builds on the existing local-first architecture).
**Scope:** a single feature, suitable for one implementation plan.

## 1. Problem

Users can already see which recipes they can make and which ingredients they're missing, but
there's no way to **collect** ingredients across multiple recipes into a single shopping list.
When planning several meals, the user has to mentally aggregate "I need eggs for the shakshuka
*and* eggs for the alfredo" themselves.

## 2. Goal

Let a user, from any recipe, push its ingredients into a shopping cart via one of two buttons —
**"Add missing items"** (pantry-aware) or **"Add all items"** (pantry-agnostic, for fast
list-building) — then view a consolidated cart in the Pantry panel where each ingredient shows its
per-recipe contributions and quantities (e.g. `Eggs — 5 total (2 eggs: Shakshuka, 3 eggs:
Alfredo Sauce)`). Tapping a cart item marks it **bought**: it is removed from the cart and its base
name is added to the pantry in one step.

## 3. User stories

- As a cook planning meals, I open a recipe and tap "Add missing items to cart" so I buy only what
  I don't already have.
- As a cook building a list fast, I tap "Add all items to cart" to throw a whole recipe's
  ingredients in regardless of my pantry.
- As a shopper, I open the Pantry's Shopping cart section and see every ingredient grouped, with
  which recipe each came from and how much, so I can shop once for several meals.
- As a shopper at the store, I tap an item as I put it in my basket; it leaves the cart and lands
  in my pantry automatically, so the next time I cook the app already knows I have it.
- As a user, adding the same recipe again doesn't double-count its contributions.

## 4. Out of scope (YAGNI)

- No server, no sync, no auth. The cart is device-local like recipes and pantry.
- No printing / sharing the cart (can be added later).
- No price, aisle, or store metadata.
- The cart is **not** continuously linked to the pantry: pantry changes never prune the cart, and
  adding to the cart never checks the pantry (except via the explicit "Add missing items" button,
  which is a one-time filter at add-time, not an ongoing link). The **only** cart→pantry link is the
  bought action (§7.2).

## 5. Architecture

Fits the existing layering exactly:

- **`lib/cart.js` (new, pure, no DOM):** ingredient parsing, cart mutation, grouping, summation,
  and the bought action. Unit-tested under Node like the rest of `lib/`.
- **`components/cart.js` (new):** turns cart data into HTML strings for the cart section.
- **`lib/store.js` (extend):** add `cart: []` to `state` and persist it under a new
  `STORAGE_KEYS.cart = 'cb_cart'`.
- **`app.js` (extend):** render the cart section, wire the two recipe buttons, the cart bought
  tap, and the clear handler.
- **`docs/index.html` (extend):** add a "Shopping cart" section inside the Pantry panel, and the
  two cart buttons in the recipe detail modal footer.
- **`lib/pantry.js` (refactor):** promote the quantity/unit regexes into a reusable
  `parseIngredient(raw)` so cart and pantry share one parser. The bought action reuses the existing
  `addToPantry`.

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
- **Idempotency:** the cart is keyed per `(recipeId, line)`. Adding a recipe's items (via either
  button) **replaces** that recipe's existing contributions rather than appending duplicates.
  Re-adding a recipe after editing it refreshes its contributions; it never double-counts.
- **Not pantry-linked:** an item's presence in the cart says nothing about the pantry. An item can
  be in the cart even if its name is already in the pantry (e.g. added via "Add all items"). The
  cart is only pruned by explicit user actions (bought / remove / clear), never by pantry
  mutations.

### 6.3 Ingredient parsing (`parseIngredient`)
- Input: a raw ingredient line.
- Output: `{ qtyText, name }`.
  - `qtyText` = the leading run matched by the existing `LEADING_QTY` + `LEADING_UNIT` regexes,
    captured rather than discarded (the current `baseName` discards it). Examples:
    `"2 tablespoons olive oil"` → `{ qtyText: "2 tablespoons", name: "olive oil" }`;
    `"6 large eggs"` → `{ qtyText: "6", name: "large eggs" }` ("large" is not a unit, so it stays in
    the name — consistent with today's `baseName`);
    `"salt and pepper to taste"` → `{ qtyText: "", name: "salt and pepper to taste" }`.
- `baseName(raw)` is reimplemented as `parseIngredient(raw).name` so behaviour is unchanged for
  pantry autocomplete.

## 7. Components & UI

### 7.1 Recipe detail modal — two buttons
Add two buttons to the detail footer:
- **"Add missing items to cart"** — for each ingredient line where
  `!haveIngredient(line, pantry)`, add a cart item. One-time pantry filter at add-time.
- **"Add all items to cart"** — for **every** ingredient line, regardless of pantry, add a cart
  item. Pantry-agnostic; enables rapid list-building.
- Both respect idempotency (§6.2): they first remove the recipe's existing cart contributions,
  then add the selected lines.
- Toast: `"Added N items to cart"` (or, for "Add missing items" when nothing is missing:
  `"Nothing missing — you have everything"`; for "Add all items" on an empty recipe:
  `"This recipe has no ingredients"`).

### 7.2 Pantry panel — Shopping cart section
- A new section in the Pantry panel, titled "Shopping cart".
- Empty state: `"Your cart is empty. Open a recipe and tap “Add … items to cart.”"`.
- Populated: one row per **group** (group key = `name`). Each row shows:
  - The ingredient name.
  - An **optional total** shown only when *every* contribution in the group has the same comparable
    unit and a numeric quantity (see §8.2). Otherwise no total.
  - The contribution list: `(qtyText: recipeName)` per contribution, e.g.
    `(2 eggs: Shakshuka, 3 eggs: Alfredo Sauce)`. Empty `qtyText` renders as just the recipe name.
  - **Tap a contribution = "bought":** remove that one contribution from the cart and add its
    `name` (base name) to the pantry in one step. Only that contribution is removed; other
    contributions in the same group remain until bought too. Toast:
    `"Bought “<name>” — added to pantry"`. (If the name is already in the pantry, `addToPantry` is
    idempotent; the contribution is still removed from the cart.)
  - A **"Clear cart"** control empties the cart (does not touch the pantry).

## 8. Logic (`lib/cart.js`)

### 8.1 Mutations (pure, return new arrays / objects)
- `addToCart(cart, recipe, pantry, mode)` → `{ cart, addedCount }` where `mode` is `'missing'` or
  `'all'`.
  - First removes any existing items with `recipe._id` (idempotency).
  - `'missing'`: appends a cart item per line where `!haveIngredient(line, pantry)`.
  - `'all'`: appends a cart item per every line.
  - `addedCount` = number actually added (used by the toast).
- `markBought(cart, item, pantry)` → `{ cart, pantry, name }`. Removes the given contribution
  (matched by `(recipeId, line)`) from the cart and returns a pantry with `item.name` added (via
  the existing `addToPantry`). The returned `pantry` is a new array (purity preserved).
- `removeFromCart(cart, item)` → new cart without that contribution (cart-only; does not touch the
  pantry).
- `clearRecipeFromCart(cart, recipeId)` → new cart without that recipe's contributions.
- `clearCart()` → `[]`.

### 8.2 Grouping & summation
- `groupCart(cart)` → `Map<name, CartItem[]>` (insertion-ordered).
- `sumIfHomogeneous(items)` → `{ total: number|null, unit: string|null }`. Returns a total only
  when every item's parsed quantity is numeric and shares the same unit; otherwise `null`.
  - Quantity/unit are extracted from `qtyText` (a leading number + optional unit). Items with
    empty `qtyText` (e.g. "to taste") make the group non-homogeneous → no total.
  - Deliberately conservative: it never produces a misleading sum. When in doubt, it falls back to
    the contribution list only.

### 8.3 Rendering helper
- `cartGroupsHTML(cart)` (in `components/cart.js`) renders the grouped list per §7.2, calling
  `groupCart` and `sumIfHomogeneous`. Each contribution row carries a `data-recipe-id` and
  `data-line` so the delegated bought/remove handler can target it.

## 9. Persistence & state

- `STORAGE_KEYS.cart = 'cb_cart'` added to `lib/constants.js`.
- `store.state.cart = []`; `save()` writes it; `load()` reads it (tolerant of absence → `[]`).
- `init()` seeds cart as `[]` (never seeded with sample data, unlike recipes/pantry).
- Mutations in `app.js` update `state.cart` (and, for the bought action, `state.pantry`), call
  `save()`, and re-render the cart section, pantry, and recipes grid.

## 10. Behaviour decisions

- **Cart is decoupled from the pantry.** Adding to the cart (either button) and pantry changes do
  not keep the two in sync. "Add missing items" is a one-time pantry filter at the moment of
  adding, not an ongoing link. The **only** cart→pantry link is the bought action, which adds the
  item's base name to the pantry.
- **Bought removes only the tapped contribution.** Buying "2 eggs: Shakshuka" puts `eggs` in the
  pantry but does **not** auto-remove "3 eggs: Alfredo" — the cart is not pantry-linked, so it does
  not re-evaluate on pantry change. The user taps each contribution they've bought. (This keeps
  the decoupling rule honest and avoids surprising deletes.)
- **Re-adding a recipe refreshes** its contributions (idempotency per §6.2), so editing a recipe
  and re-adding it updates the cart rather than duplicating. Note: re-adding via "Add all items"
  after some of that recipe's contributions were already bought will re-add them to the cart; this
  is expected and acceptable (the user chose to rebuild the list).
- **Bought is one-shot, not a persisted state.** A bought item leaves the cart; there is no
  lingering "bought" flag. The pantry records the outcome.

## 11. Error handling

- Empty recipe (no ingredients) → toast: `"This recipe has no ingredients"`.
- "Add missing items" with all ingredients already in pantry → toast:
  `"Nothing missing — you have everything"`.
- Corrupt `cb_cart` in localStorage → `load()` falls back to `[]` (same pattern as recipes/pantry).
- Buying a contribution whose name is already in the pantry → still removes it from the cart;
  `addToPantry` no-ops on the pantry; toast reflects the cart removal.

## 12. Testing

New `test/cart.test.js` covering the pure functions, run by the existing `node --test` suite:

- `parseIngredient`: qty/unit capture, unquantified lines, parity with `baseName`.
- `addToCart(mode:'missing')`: only not-in-pantry lines added, respects `pantry`, correct
  `addedCount`, existing recipe contributions replaced.
- `addToCart(mode:'all')`: every line added regardless of pantry, correct `addedCount`,
  idempotency holds.
- `markBought`: the targeted contribution is removed from the cart and its `name` is added to
  the returned pantry; other contributions (same group or not) are untouched; purity (inputs not
  mutated); idempotent pantry add.
- `removeFromCart`, `clearRecipeFromCart`, `clearCart`: pure, no mutation of input, pantry
  untouched.
- `groupCart`: correct grouping by `name`, insertion order preserved.
- `sumIfHomogeneous`: sums matching-unit numeric quantities; returns `null` on unit mismatch,
  empty quantities, or non-numeric values.

No new dependencies. No browser/DOM required for the logic tests.

## 13. Acceptance criteria

1. The recipe detail modal shows **both** "Add missing items to cart" and "Add all items to
   cart". Missing adds only not-in-pantry lines; All adds every line.
2. The Pantry cart section renders groups in the example shape — with a total when units match,
   without when they don't.
3. Re-adding the same recipe (via either button) does not duplicate its contributions.
4. Tapping a cart contribution marks it bought: the contribution leaves the cart and its base name
   enters the pantry, in one step. Other contributions are unaffected.
5. The cart is never pruned by pantry changes; only bought/remove/clear affect it.
6. Removing a contribution and clearing the cart both work and persist across reloads; the pantry
   is unaffected by remove/clear (only by bought).
7. The app remains fully offline-capable; the cart adds no network dependency.
8. `npm test` passes with the new `cart.test.js` added and no regressions in existing tests.