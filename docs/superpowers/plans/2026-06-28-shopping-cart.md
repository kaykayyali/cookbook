# Shopping Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a device-local shopping cart that collects a recipe's ingredients (missing-only or all), groups them across recipes with per-recipe quantities, and lets the user tap an item to mark it bought (removing it from the cart and adding its base name to the pantry in one step).

**Architecture:** Pure client-side, fitting the existing layering exactly — new `lib/cart.js` (pure, no DOM, unit-tested), new `components/cart.js` (HTML strings), state/persistence extended in `lib/store.js`, wiring in `app.js`, markup in `index.html`. `parseIngredient` is promoted out of `pantry.js`'s `baseName` so cart and pantry share one parser.

**Tech Stack:** Native ES modules, Node built-in test runner (`node --test`), Node ≥ 18, zero runtime dependencies.

## Global Constraints

- No build step, no framework, no runtime dependencies. New client code is plain ES modules.
- `lib/` modules are pure (data in, data out, no DOM) and unit-testable under Node with no DOM shim.
- `components/` modules return HTML strings. `app.js` is the only file that touches the DOM.
- All user-supplied text rendered into HTML must go through `esc()` from `lib/format.js`.
- schema.org/Recipe stays canonical (unchanged by this feature).
- The cart is decoupled from the pantry: pantry changes never prune the cart; the only cart→pantry link is the bought action.
- Persistence keys are lowercase `cb_*` strings in `lib/constants.js`.
- Follow existing file header comment style (`// ═══ …` banner with a one-line description).

---

## File Structure

- **Create** `docs/js/lib/cart.js` — pure cart logic: `parseQty`, `sumIfHomogeneous`, `groupCart`, `addToCart`, `markBought`, `removeFromCart`, `clearRecipeFromCart`, `clearCart`.
- **Modify** `docs/js/lib/pantry.js` — promote the leading-qty/unit regexes into a `parseIngredient(raw)` export; reimplement `baseName` on top of it. Behaviour of `baseName` is unchanged.
- **Modify** `docs/js/lib/constants.js` — add `cart: 'cb_cart'` to `STORAGE_KEYS`.
- **Modify** `docs/js/lib/store.js` — add `cart: []` to `state`, persist it in `save()`, load it in `load()` (tolerant of absence).
- **Create** `docs/js/components/cart.js` — `cartGroupsHTML(cart)` and `emptyCartHTML()`.
- **Modify** `docs/index.html` — add a "Shopping cart" section to the Pantry panel; add two buttons to the recipe-detail footer.
- **Modify** `docs/js/app.js` — import cart logic/component, render the cart section, wire the two detail buttons, the bought tap, and Clear cart.
- **Create** `test/cart.test.js` — unit tests for the pure cart logic (run by `npm test`).
- **Modify** `test/pantry.test.js` — add tests for the new `parseIngredient` export.

---

### Task 1: Promote `parseIngredient` out of `baseName` in `pantry.js`

**Files:**
- Modify: `docs/js/lib/pantry.js:7-58` (regexes + `baseName`)
- Test: `test/pantry.test.js` (add a `parseIngredient` test block)

**Interfaces:**
- Produces: `parseIngredient(raw: string) => { qtyText: string, name: string }` exported from `docs/js/lib/pantry.js`. `qtyText` is the captured leading quantity+unit run (trimmed); `name` is the remaining text, trimmed and lowercased. For non-string input returns `{ qtyText: '', name: '' }`. `baseName(raw)` becomes `parseIngredient(raw).name` — behaviour identical to today.

- [ ] **Step 1: Write the failing test**

Append to `test/pantry.test.js` (after the existing `baseName` tests, before the `allRecipeIngredients` test or at the end):

```js
test('parseIngredient captures leading qty+unit and lowercases the name', () => {
  assert.deepEqual(parseIngredient('2 tablespoons olive oil'), { qtyText: '2 tablespoons', name: 'olive oil' });
  assert.deepEqual(parseIngredient('400g spaghetti'), { qtyText: '400g', name: 'spaghetti' });
  assert.deepEqual(parseIngredient('6 large eggs'), { qtyText: '6 large', name: 'eggs' });
  assert.deepEqual(parseIngredient('salt and pepper to taste'), { qtyText: '', name: 'salt and pepper to taste' });
});

test('parseIngredient tolerates non-strings', () => {
  assert.deepEqual(parseIngredient(null), { qtyText: '', name: '' });
  assert.deepEqual(parseIngredient(undefined), { qtyText: '', name: '' });
});
```

And add `parseIngredient` to the import list at the top of `test/pantry.test.js`:

```js
import {
  haveIngredient,
  eligibility,
  ingredientCounts,
  baseName,
  parseIngredient,
  allRecipeIngredients,
  addToPantry,
  removeFromPantry,
  togglePantry,
  normalizePantry,
} from '../docs/js/lib/pantry.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseIngredient is not a function` (or `undefined`).

- [ ] **Step 3: Implement `parseIngredient` and reimplement `baseName`**

In `docs/js/lib/pantry.js`, replace the existing `baseName` function (lines ~52-58) with:

```js
/**
 * Parse a raw ingredient line into its leading quantity/unit snippet and the
 * remaining base name. Reuses the same LEADING_QTY / LEADING_UNIT regexes as
 * the previous baseName, but captures the stripped run instead of discarding
 * it. "2 tablespoons olive oil" → { qtyText: "2 tablespoons", name: "olive oil" }.
 * "6 large eggs" → { qtyText: "6 large", name: "eggs" } (large is a unit here).
 * @param {string} raw
 * @returns {{qtyText:string, name:string}} name is lowercase; non-strings yield empty strings
 */
export function parseIngredient(raw) {
  if (typeof raw !== 'string') return { qtyText: '', name: '' };
  let s = raw;
  let qtyText = '';
  const m1 = s.match(LEADING_QTY);
  if (m1) { qtyText += m1[0]; s = s.slice(m1[0].length); }
  const m2 = s.match(LEADING_UNIT);
  if (m2) { qtyText += m2[0]; s = s.slice(m2[0].length); }
  return { qtyText: qtyText.trim(), name: s.trim().toLowerCase() };
}

/**
 * Reduce a raw ingredient line to its base noun by stripping leading
 * quantity and unit. "2 tablespoons olive oil" → "olive oil".
 * Thin wrapper over parseIngredient so cart and pantry share one parser.
 * @param {string} raw
 * @returns {string} lowercase base name
 */
export function baseName(raw) {
  return parseIngredient(raw).name;
}
```

(Leave the `LEADING_QTY` and `LEADING_UNIT` regex constants above untouched — `parseIngredient` reuses them.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the new `parseIngredient` tests pass, and all existing `baseName` tests still pass (behaviour unchanged).

- [ ] **Step 5: Commit**

```bash
git add docs/js/lib/pantry.js test/pantry.test.js
git commit -m "feat(pantry): export parseIngredient; baseName now wraps it

Promotes the leading-qty/unit capture into a reusable parser so the
shopping cart (next task) and pantry share one ingredient parser.
baseName behaviour is unchanged."
```

---

### Task 2: Pure cart mutations — `addToCart`, `removeFromCart`, `clearRecipeFromCart`, `clearCart`

**Files:**
- Create: `docs/js/lib/cart.js`
- Test: `test/cart.test.js` (new file)

**Interfaces:**
- Consumes: `parseIngredient(raw) => { qtyText, name }` from `docs/js/lib/pantry.js` (Task 1); `haveIngredient(line, pantry) => boolean` from `docs/js/lib/pantry.js`.
- Produces:
  - `makeCartItem(raw, recipe) => { name, line, qtyText, recipeId, recipeName }` (internal helper, exported for testing).
  - `addToCart(cart, recipe, pantry, mode) => { cart, addedCount }` where `mode` is `'missing'` | `'all'`. Removes the recipe's existing contributions first (idempotency), then adds per-line items. `'missing'` filters via `haveIngredient`; `'all'` adds every line. `addedCount` is the number added.
  - `removeFromCart(cart, recipeId, line) => cart[]` — removes the matching contribution (cart-only; pantry untouched).
  - `clearRecipeFromCart(cart, recipeId) => cart[]`.
  - `clearCart() => []`.
  - All are pure: inputs are not mutated.

- [ ] **Step 1: Write the failing tests**

Create `test/cart.test.js`:

```js
// Tests for lib/cart.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCartItem,
  addToCart,
  removeFromCart,
  clearRecipeFromCart,
  clearCart,
} from '../docs/js/lib/cart.js';

const RECIPES = {
  shakshuka: { _id: 'r1', name: 'Shakshuka', recipeIngredient: ['2 tablespoons olive oil', '6 large eggs', 'salt to taste'] },
  alfredo: { _id: 'r2', name: 'Alfredo Sauce', recipeIngredient: ['3 eggs', '1 cup parmesan'] },
};

test('makeCartItem parses qty and base name and tags the recipe', () => {
  assert.deepEqual(makeCartItem('2 tablespoons olive oil', RECIPES.shakshuka), {
    name: 'olive oil', line: '2 tablespoons olive oil', qtyText: '2 tablespoons',
    recipeId: 'r1', recipeName: 'Shakshuka',
  });
  assert.deepEqual(makeCartItem('salt to taste', RECIPES.shakshuka), {
    name: 'salt to taste', line: 'salt to taste', qtyText: '',
    recipeId: 'r1', recipeName: 'Shakshuka',
  });
});

test('addToCart(missing) adds only not-in-pantry lines', () => {
  const pantry = ['olive oil'];
  const { cart, addedCount } = addToCart([], RECIPES.shakshuka, pantry, 'missing');
  // olive oil is in pantry -> excluded; eggs + salt added
  assert.equal(addedCount, 2);
  assert.deepEqual(cart.map((c) => c.name).sort(), ['eggs', 'salt to taste']);
});

test('addToCart(all) adds every line regardless of pantry', () => {
  const pantry = ['olive oil'];
  const { cart, addedCount } = addToCart([], RECIPES.shakshuka, pantry, 'all');
  assert.equal(addedCount, 3);
  assert.equal(cart.length, 3);
});

test('addToCart is idempotent: re-adding a recipe replaces its contributions', () => {
  const first = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const again = addToCart(first, RECIPES.shakshuka, [], 'all').cart;
  // not duplicated
  const shak = again.filter((c) => c.recipeId === 'r1');
  assert.equal(shak.length, 3);
});

test('addToCart does not mutate its inputs', () => {
  const cart = [];
  const before = [...cart];
  addToCart(cart, RECIPES.shakshuka, [], 'all');
  assert.deepEqual(cart, before, 'input cart array unchanged');
});

test('removeFromCart removes one contribution by (recipeId, line) and is pure', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const next = removeFromCart(cart, 'r1', '6 large eggs');
  assert.equal(next.length, cart.length - 1);
  assert.deepEqual(cart.length, 3, 'input unchanged');
});

test('clearRecipeFromCart drops a recipe and clearCart empties everything', () => {
  const cart = [
    ...addToCart([], RECIPES.shakshuka, [], 'all').cart,
    ...addToCart([], RECIPES.alfredo, [], 'all').cart,
  ];
  const oneGone = clearRecipeFromCart(cart, 'r1');
  assert.equal(oneGone.filter((c) => c.recipeId === 'r1').length, 0);
  assert.equal(oneGone.length, 2);
  assert.deepEqual(clearCart(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module `../docs/js/lib/cart.js` not found / functions undefined.

- [ ] **Step 3: Implement the pure mutations**

Create `docs/js/lib/cart.js`:

```js
// ════════════════════════════════════════════════════════
// cart.js — shopping cart logic (no DOM)
//
// Cart item: { name, line, qtyText, recipeId, recipeName }
//   name      = baseName(raw) — lowercase noun, the GROUP KEY
//   line      = original raw ingredient text
//   qtyText   = captured leading qty+unit snippet, or "" when unquantified
//   recipeId  = _id of the contributing recipe
//   recipeName = recipe.name, denormalised for display
//
// The cart is decoupled from the pantry: pantry changes never prune it.
// The only cart→pantry link is markBought (Task 3).
// ════════════════════════════════════════════════════════

import { parseIngredient, haveIngredient } from './pantry.js';

/**
 * Build a cart item from a raw ingredient line and its recipe.
 * @param {string} raw ingredient line
 * @param {object} recipe internal recipe with _id and name
 * @returns {{name:string,line:string,qtyText:string,recipeId:string,recipeName:string}}
 */
export function makeCartItem(raw, recipe) {
  const { qtyText, name } = parseIngredient(raw);
  return { name, line: raw, qtyText, recipeId: recipe._id, recipeName: recipe.name };
}

/**
 * Add a recipe's ingredients to the cart. Idempotent per recipe: existing
 * contributions for this recipe are removed first, then the selected lines are
 * appended. 'missing' adds only lines not satisfied by the pantry; 'all' adds
 * every line. Pure — does not mutate inputs.
 * @param {object[]} cart
 * @param {object} recipe
 * @param {string[]} pantry
 * @param {'missing'|'all'} mode
 * @returns {{cart:object[], addedCount:number}}
 */
export function addToCart(cart, recipe, pantry, mode) {
  const withoutRecipe = cart.filter((c) => c.recipeId !== recipe._id);
  const lines = (recipe.recipeIngredient || []).filter((l) => typeof l === 'string');
  const selected = lines.filter((l) => mode === 'all' || !haveIngredient(l, pantry));
  const items = selected.map((l) => makeCartItem(l, recipe));
  return { cart: [...withoutRecipe, ...items], addedCount: items.length };
}

/**
 * Remove one contribution matched by (recipeId, line). Cart-only — pantry is
 * not touched. Pure.
 * @param {object[]} cart
 * @param {string} recipeId
 * @param {string} line
 * @returns {object[]}
 */
export function removeFromCart(cart, recipeId, line) {
  return cart.filter((c) => !(c.recipeId === recipeId && c.line === line));
}

/**
 * Remove all of a recipe's contributions. Pure.
 * @param {object[]} cart
 * @param {string} recipeId
 * @returns {object[]}
 */
export function clearRecipeFromCart(cart, recipeId) {
  return cart.filter((c) => c.recipeId !== recipeId);
}

/** Empty cart. */
export function clearCart() {
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `cart.test.js` tests green, no regressions in existing suites.

- [ ] **Step 5: Commit**

```bash
git add docs/js/lib/cart.js test/cart.test.js
git commit -m "feat(cart): pure addToCart/remove/clear with idempotent per-recipe add"
```

---

### Task 3: `markBought` — remove a contribution and add its base name to the pantry

**Files:**
- Modify: `docs/js/lib/cart.js` (add `markBought`)
- Test: `test/cart.test.js` (add `markBought` tests)

**Interfaces:**
- Consumes: `addToPantry(pantry, name) => { pantry, added, name }` from `docs/js/lib/pantry.js`.
- Produces: `markBought(cart, recipeId, line, pantry) => { cart, pantry, name, removed }`. Finds the matching contribution, removes it from the cart, and returns a pantry with its `name` added. If no match, returns inputs unchanged with `removed: false`. Pure.

- [ ] **Step 1: Write the failing tests**

Append to `test/cart.test.js` (and add `markBought` to the import list):

```js
import {
  makeCartItem,
  addToCart,
  markBought,
  removeFromCart,
  clearRecipeFromCart,
  clearCart,
} from '../docs/js/lib/cart.js';
```

```js
test('markBought removes the contribution and adds its name to the pantry', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const pantry = ['olive oil'];
  const res = markBought(cart, 'r1', '6 large eggs', pantry);
  // contribution gone
  assert.equal(res.cart.length, cart.length - 1);
  assert.equal(res.cart.find((c) => c.line === '6 large eggs'), undefined);
  // name added to pantry
  assert.ok(res.pantry.includes('eggs'));
  assert.equal(res.removed, true);
  assert.equal(res.name, 'eggs');
});

test('markBought leaves other contributions untouched', () => {
  const cart = [
    ...addToCart([], RECIPES.shakshuka, [], 'all').cart,
    ...addToCart([], RECIPES.alfredo, [], 'all').cart,
  ];
  const res = markBought(cart, 'r1', '6 large eggs', []);
  // the other "eggs" contribution (from Alfredo) remains
  assert.ok(res.cart.find((c) => c.recipeId === 'r2' && c.line === '3 eggs'));
  assert.equal(res.pantry.includes('eggs'), true);
});

test('markBought is idempotent on the pantry when name already present', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const res = markBought(cart, 'r1', '6 large eggs', ['eggs']);
  // still removed from cart; pantry unchanged (no duplicate)
  assert.equal(res.cart.length, cart.length - 1);
  assert.deepEqual(res.pantry, ['eggs']);
});

test('markBought with no match returns inputs unchanged', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const pantry = ['olive oil'];
  const res = markBought(cart, 'r1', 'nope', pantry);
  assert.equal(res.removed, false);
  assert.deepEqual(res.cart, cart);
  assert.deepEqual(res.pantry, pantry);
});

test('markBought does not mutate its inputs', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const pantry = ['olive oil'];
  const cartBefore = [...cart];
  const pantryBefore = [...pantry];
  markBought(cart, 'r1', '6 large eggs', pantry);
  assert.deepEqual(cart, cartBefore);
  assert.deepEqual(pantry, pantryBefore);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `markBought is not a function` / not exported.

- [ ] **Step 3: Implement `markBought`**

Append to `docs/js/lib/cart.js` (add `addToPantry` to the import from `./pantry.js`):

```js
import { parseIngredient, haveIngredient, addToPantry } from './pantry.js';
```

```js
/**
 * Mark one contribution bought: remove it from the cart and add its base name
 * to the pantry, in one step. Only that contribution is removed — others stay.
 * The cart is otherwise decoupled from the pantry; this is the only link.
 * Pure — does not mutate inputs.
 * @param {object[]} cart
 * @param {string} recipeId
 * @param {string} line
 * @param {string[]} pantry
 * @returns {{cart:object[], pantry:string[], name:string, removed:boolean}}
 */
export function markBought(cart, recipeId, line, pantry) {
  const item = cart.find((c) => c.recipeId === recipeId && c.line === line);
  if (!item) return { cart, pantry, name: '', removed: false };
  const nextCart = cart.filter((c) => c !== item);
  const { pantry: nextPantry } = addToPantry(pantry, item.name);
  return { cart: nextCart, pantry: nextPantry, name: item.name, removed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all cart tests green, including `markBought`.

- [ ] **Step 5: Commit**

```bash
git add docs/js/lib/cart.js test/cart.test.js
git commit -m "feat(cart): markBought removes contribution + adds to pantry in one step"
```

---

### Task 4: `groupCart` and `sumIfHomogeneous`

**Files:**
- Modify: `docs/js/lib/cart.js` (add `parseQty`, `sumIfHomogeneous`, `groupCart`)
- Test: `test/cart.test.js` (add grouping/summation tests)

**Interfaces:**
- Produces:
  - `groupCart(cart) => Map<string, object[]>` — groups items by `name`, insertion-ordered.
  - `sumIfHomogeneous(items) => { total: string|null, unit: string|null }` — returns a total only when every item's `qtyText` parses to a number and all share the same unit; `total` is a formatted integer string or `null` when not homogeneous / not integer-summed.
  - `parseQty(qtyText) => { n: number, unit: string } | null` (internal helper, exported for testing) — parses a leading number (integers, decimals, simple fractions like `1/2`, unicode fractions `½`) plus an optional trailing unit word; `null` when unquantified (`""`) or unparseable.

- [ ] **Step 1: Write the failing tests**

Append to `test/cart.test.js` (add `parseQty`, `groupCart`, `sumIfHomogeneous` to the import list):

```js
import {
  makeCartItem,
  addToCart,
  markBought,
  removeFromCart,
  clearRecipeFromCart,
  clearCart,
  parseQty,
  groupCart,
  sumIfHomogeneous,
} from '../docs/js/lib/cart.js';
```

```js
test('parseQty handles integers, decimals, fractions, and units', () => {
  assert.deepEqual(parseQty('2'), { n: 2, unit: '' });
  assert.deepEqual(parseQty('3'), { n: 3, unit: '' });
  assert.deepEqual(parseQty('2 tablespoons'), { n: 2, unit: 'tablespoons' });
  assert.deepEqual(parseQty('1/2 cup'), { n: 0.5, unit: 'cup' });
  assert.deepEqual(parseQty('½'), { n: 0.5, unit: '' });
  assert.deepEqual(parseQty('6 large'), { n: 6, unit: 'large' });
});

test('parseQty returns null for empty or unparseable', () => {
  assert.equal(parseQty(''), null);
  assert.equal(parseQty('to taste'), null);
});

test('groupCart groups by name preserving insertion order', () => {
  const cart = addToCart([], RECIPES.shakshuka, [], 'all').cart;
  const g = groupCart(cart);
  assert.ok(g instanceof Map);
  // first-added name comes first
  const names = [...g.keys()];
  assert.equal(names[0], 'olive oil');
  assert.ok(g.has('eggs'));
});

test('sumIfHomogeneous sums matching-unit integer totals', () => {
  // 2 eggs + 3 eggs -> both unit "" -> total "5"
  const items = [
    { name: 'eggs', qtyText: '2', recipeId: 'r1', recipeName: 'Shakshuka' },
    { name: 'eggs', qtyText: '3', recipeId: 'r2', recipeName: 'Alfredo Sauce' },
  ];
  assert.deepEqual(sumIfHomogeneous(items), { total: '5', unit: '' });
});

test('sumIfHomogeneous returns null on unit mismatch or unquantified', () => {
  const mismatch = [
    { name: 'eggs', qtyText: '6 large', recipeId: 'r1', recipeName: 'Shakshuka' },
    { name: 'eggs', qtyText: '3', recipeId: 'r2', recipeName: 'Alfredo Sauce' },
  ];
  assert.deepEqual(sumIfHomogeneous(mismatch), { total: null, unit: null });

  const unquantified = [
    { name: 'salt', qtyText: '', recipeId: 'r1', recipeName: 'Shakshuka' },
    { name: 'salt', qtyText: '1 tsp', recipeId: 'r2', recipeName: 'Alfredo Sauce' },
  ];
  assert.deepEqual(sumIfHomogeneous(unquantified), { total: null, unit: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseQty` / `groupCart` / `sumIfHomogeneous` not exported.

- [ ] **Step 3: Implement grouping and summation**

Append to `docs/js/lib/cart.js`:

```js
const FRACTIONS = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/**
 * Parse a qtyText snippet into a number + unit. Accepts integers, decimals,
 * simple fractions (1/2) and unicode fractions (½), with an optional trailing
 * unit word. Returns null for empty/unquantified or unparseable input.
 * @param {string} qtyText
 * @returns {{n:number, unit:string}|null}
 */
export function parseQty(qtyText) {
  const t = (qtyText || '').trim();
  if (!t) return null;
  if (FRACTIONS[t] != null) return { n: FRACTIONS[t], unit: '' };
  const m = t.match(/^([\d.\/¼½¾⅓⅔⅛⅜⅝⅞]+)\s*([a-zA-Z]*)$/);
  if (!m) return null;
  let n;
  if (FRACTIONS[m[1]] != null) n = FRACTIONS[m[1]];
  else if (/^\d+\/\d+$/.test(m[1])) {
    const [a, b] = m[1].split('/').map(Number);
    if (!b) return null;
    n = a / b;
  } else if (/^\d+(\.\d+)?$/.test(m[1])) n = parseFloat(m[1]);
  else return null;
  return { n, unit: m[2].toLowerCase() };
}

/**
 * Group cart items by their base name, preserving insertion order.
 * @param {object[]} cart
 * @returns {Map<string, object[]>}
 */
export function groupCart(cart) {
  const map = new Map();
  for (const item of cart) {
    if (!map.has(item.name)) map.set(item.name, []);
    map.get(item.name).push(item);
  }
  return map;
}

/**
 * Sum a group's quantities only when every item parses to a number and all share
 * the same unit, AND the total is a whole number. Conservative — returns
 * { total: null, unit: null } otherwise (mismatched units, unquantified lines,
 * or non-integer sums) so the renderer never shows a misleading total.
 * @param {object[]} items
 * @returns {{total:string|null, unit:string|null}}
 */
export function sumIfHomogeneous(items) {
  if (!items.length) return { total: null, unit: null };
  const parsed = items.map((it) => parseQty(it.qtyText));
  if (parsed.some((p) => p == null)) return { total: null, unit: null };
  const unit = parsed[0].unit;
  if (!parsed.every((p) => p.unit === unit)) return { total: null, unit: null };
  const total = parsed.reduce((s, p) => s + p.n, 0);
  if (Math.abs(total - Math.round(total)) > 1e-9) return { total: null, unit: null };
  return { total: String(Math.round(total)), unit };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all cart tests green, including grouping and summation.

- [ ] **Step 5: Commit**

```bash
git add docs/js/lib/cart.js test/cart.test.js
git commit -m "feat(cart): groupCart + conservative sumIfHomogeneous for per-unit totals"
```

---

### Task 5: Persist the cart in `state` / `localStorage`

**Files:**
- Modify: `docs/js/lib/constants.js:5-8` (`STORAGE_KEYS`)
- Modify: `docs/js/lib/store.js:9-35` (`state`, `save`, `load`)

**Interfaces:**
- Produces: `state.cart: object[]`; `save()` writes `cb_cart`; `load()` reads it (absence → `[]`, corrupt → `[]`). Downstream tasks (`app.js`) read/write `state.cart` and call `save()`.

- [ ] **Step 1: Add the storage key**

In `docs/js/lib/constants.js`, change `STORAGE_KEYS` to:

```js
export const STORAGE_KEYS = {
  recipes: 'cb_recipes',
  pantry: 'cb_pantry',
  cart: 'cb_cart',
};
```

- [ ] **Step 2: Add `cart` to state and persist it**

In `docs/js/lib/store.js`:

Change `state` to include `cart: []`:

```js
export const state = {
  recipes: [],
  pantry: [],
  cart: [],
  editingId: null,
  detailId: null,
  searchTerm: '',
  categoryFilter: '',
  eligibleOnly: false,
};
```

Change `save()` to write the cart:

```js
export function save() {
  localStorage.setItem(STORAGE_KEYS.recipes, JSON.stringify(state.recipes));
  localStorage.setItem(STORAGE_KEYS.pantry, JSON.stringify(state.pantry));
  localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(state.cart));
}
```

Change `load()` to read it (tolerant of absence/corrupt):

```js
export function load() {
  try {
    state.recipes = JSON.parse(localStorage.getItem(STORAGE_KEYS.recipes) || '[]');
  } catch {
    state.recipes = [];
  }
  try {
    state.pantry = normalizePantry(JSON.parse(localStorage.getItem(STORAGE_KEYS.pantry) || '[]'));
  } catch {
    state.pantry = [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cart);
    state.cart = Array.isArray(raw ? JSON.parse(raw) : []) ? JSON.parse(raw) : [];
  } catch {
    state.cart = [];
  }
}
```

(`init()` is unchanged — `load()` runs first, and an empty cart is the correct first-run default; the cart is never seeded with sample data.)

- [ ] **Step 3: Verify the suite still passes**

Run: `npm test`
Expected: PASS — no regressions (store.js has no dedicated tests; the cart logic tests remain green).

- [ ] **Step 4: Commit**

```bash
git add docs/js/lib/constants.js docs/js/lib/store.js
git commit -m "feat(store): persist shopping cart in localStorage under cb_cart"
```

---

### Task 6: Cart markup — `components/cart.js`

**Files:**
- Create: `docs/js/components/cart.js`
- (No unit test — presentational; verified visually in Task 8. Logic it calls is already tested.)

**Interfaces:**
- Consumes: `groupCart(cart)`, `sumIfHomogeneous(items)` from `docs/js/lib/cart.js`; `esc(s)` from `docs/js/lib/format.js`.
- Produces:
  - `cartGroupsHTML(cart) => string` — one row per group; each contribution is a `<span class="cart-contrib" data-action="bought" data-recipe-id data-line data-name>`; an optional total span when `sumIfHomogeneous` returns a total.
  - `emptyCartHTML() => string` — empty-state paragraph.

- [ ] **Step 1: Implement the component**

Create `docs/js/components/cart.js`:

```js
// ════════════════════════════════════════════════════════
// cart.js — shopping cart markup (returns HTML strings)
// ════════════════════════════════════════════════════════

import { esc } from '../lib/format.js';
import { groupCart, sumIfHomogeneous } from '../lib/cart.js';

/**
 * Render the cart as grouped rows. Each contribution is a tappable span
 * (data-action="bought") carrying recipe-id, line, and name so a delegated
 * handler can mark it bought. An optional total is shown when the group's
 * quantities are homogeneous and integer-summable.
 * @param {object[]} cart
 * @returns {string}
 */
export function cartGroupsHTML(cart) {
  const groups = groupCart(cart);
  const rows = [];
  for (const [name, items] of groups) {
    const { total, unit } = sumIfHomogeneous(items);
    const totalHTML = total != null
      ? `<span class="cart-total">${esc(total)}${unit ? ' ' + esc(unit) : ''} total</span> `
      : '';
    const contribs = items
      .map((it) => {
        const qty = it.qtyText ? `${esc(it.qtyText)}: ` : '';
        return `<span class="cart-contrib" data-action="bought" data-recipe-id="${esc(it.recipeId)}" data-line="${esc(it.line)}" data-name="${esc(it.name)}" title="Tap to mark bought (adds to pantry)">${qty}${esc(it.recipeName)}</span>`;
      })
      .join(', ');
    rows.push(
      `<div class="cart-row"><span class="cart-name">${esc(name)}</span> ${totalHTML}(${contribs})</div>`
    );
  }
  return rows.join('');
}

/** Empty-state message for the cart section. */
export function emptyCartHTML() {
  return '<p class="cart-empty">Your cart is empty. Open a recipe and tap “Add … items to cart.”</p>';
}
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npm test`
Expected: PASS (component is not tested under Node; logic it calls is already covered).

- [ ] **Step 3: Commit**

```bash
git add docs/js/components/cart.js
git commit -m "feat(cart): cartGroupsHTML + emptyCartHTML components"
```

---

### Task 7: Markup — Shopping cart section + two detail buttons in `index.html`

**Files:**
- Modify: `docs/index.html` (Pantry panel section, recipe-detail footer)

- [ ] **Step 1: Add the Shopping cart section to the Pantry panel**

In `docs/index.html`, inside the `#panel-pantry` section, immediately after the `pantry-grid` div (after line ~102 `</div>` closing `pantry-grid`), add:

```html
    <div class="cart-section">
      <div class="panel-header" style="margin-top:1.5rem">
        <div>
          <h2>Shopping cart</h2>
          <p>Tap an item to mark it bought — it leaves the cart and lands in your pantry.</p>
        </div>
        <button class="btn btn-ghost btn-sm" id="cart-clear-btn">Clear cart</button>
      </div>
      <div class="cart-grid" id="cart-grid"></div>
    </div>
```

- [ ] **Step 2: Add the two cart buttons to the recipe-detail footer**

In `docs/index.html`, in the `.detail-footer` block (around lines 140-146), add two buttons before the existing View JSON-LD / Edit buttons:

```html
  <div class="detail-footer">
    <button class="btn btn-ghost btn-sm" id="dm-add-missing-btn">Add missing items to cart</button>
    <button class="btn btn-ghost btn-sm" id="dm-add-all-btn">Add all items to cart</button>
    <button class="btn btn-ghost btn-sm" id="dm-schema-btn">View JSON-LD</button>
    <button class="btn btn-ghost btn-sm" id="dm-edit-btn">
      <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Edit
    </button>
  </div>
```

- [ ] **Step 3: Add minimal cart styles**

Append to `docs/css/styles.css`:

```css
/* ── Shopping cart ── */
.cart-section { margin-top: 1.5rem; }
.cart-grid { display: flex; flex-direction: column; gap: .5rem; }
.cart-row { display: flex; flex-wrap: wrap; gap: .35rem; align-items: baseline; padding: .5rem .6rem; background: var(--surface, #26221e); border-radius: 8px; font-size: .9rem; }
.cart-name { font-weight: 600; }
.cart-total { color: var(--ink-light, #a8a29e); font-size: .8rem; }
.cart-contrib { cursor: pointer; padding: .15rem .35rem; border-radius: 6px; border: 1px solid var(--border, #3a3531); }
.cart-contrib:hover { background: var(--accent, #b91c1c); color: #fff; border-color: transparent; }
.cart-empty { color: var(--ink-light, #a8a29e); font-size: .85rem; }
```

(These use CSS variables already defined in `styles.css`; if a referenced variable is absent it falls back to the literal.)

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/css/styles.css
git commit -m "feat(cart): shopping cart section + two add-to-cart buttons in detail footer"
```

---

### Task 8: Wire the cart into `app.js` — render, two buttons, bought tap, clear

**Files:**
- Modify: `docs/js/app.js` (imports, `renderCart`, handlers in `wire`)

**Interfaces:**
- Consumes: `addToCart`, `markBought`, `clearCart` from `docs/js/lib/cart.js`; `cartGroupsHTML`, `emptyCartHTML` from `docs/js/components/cart.js`; `state`, `save` from `docs/js/lib/store.js`; `$`, `els`, `toast` from `docs/js/lib/dom.js`; `esc`, `pluralize` from `docs/js/lib/format.js`.
- Produces: a `renderCart()` function called by `showPanel('pantry')`, by the two add-to-cart buttons, by the bought tap, and by Clear cart.

- [ ] **Step 1: Add the imports**

In `docs/js/app.js`, extend the `pantry.js` import block (lines ~8-13) to also bring nothing new from pantry (already imported), and add a cart import block. After the existing `filters.js` import (line 14), add:

```js
import { addToCart, markBought, clearCart } from './lib/cart.js';
import { cartGroupsHTML, emptyCartHTML } from './components/cart.js';
```

- [ ] **Step 2: Add `renderCart()`**

In `docs/js/app.js`, add this function just after `renderPantry()` (after line ~81):

```js
function renderCart() {
  const grid = $('cart-grid');
  if (!grid) return;
  grid.innerHTML = state.cart.length ? cartGroupsHTML(state.cart) : emptyCartHTML();
}
```

- [ ] **Step 3: Render the cart when the Pantry panel opens**

In `showPanel` (lines ~230-236), the `pantry` branch already calls `renderPantry()`. Extend it to also render the cart:

```js
  if (id === 'pantry') {
    renderPantry();
    renderCart();
  }
```

- [ ] **Step 4: Add the two add-to-cart handlers**

In `docs/js/app.js`, add a helper and wire both detail buttons. Place the helper near `openDetail` (after line ~117):

```js
function addRecipeToCart(mode) {
  const r = state.recipes.find((x) => x._id === state.detailId);
  if (!r) return;
  const ings = r.recipeIngredient || [];
  if (!ings.length) {
    toast('This recipe has no ingredients');
    return;
  }
  const { addedCount } = addToCart(state.cart, r, state.pantry, mode);
  state.cart = addToCart(state.cart, r, state.pantry, mode).cart;
  save();
  renderCart();
  if (mode === 'missing' && addedCount === 0) toast('Nothing missing — you have everything');
  else toast(`Added ${pluralize(addedCount, 'item')} to cart`);
}
```

> Note: `addToCart` returns `{ cart, addedCount }` in one call — capture it once to avoid a double application. The two-line form above should be collapsed to:

```js
function addRecipeToCart(mode) {
  const r = state.recipes.find((x) => x._id === state.detailId);
  if (!r) return;
  const ings = r.recipeIngredient || [];
  if (!ings.length) {
    toast('This recipe has no ingredients');
    return;
  }
  const { cart, addedCount } = addToCart(state.cart, r, state.pantry, mode);
  state.cart = cart;
  save();
  renderCart();
  if (mode === 'missing' && addedCount === 0) toast('Nothing missing — you have everything');
  else toast(`Added ${pluralize(addedCount, 'item')} to cart`);
}
```

Use the collapsed single-call form in the file.

Wire the buttons inside `wire()`, alongside the other detail buttons (after the `dm-edit-btn` wiring around line ~394):

```js
  $('dm-add-missing-btn').addEventListener('click', () => addRecipeToCart('missing'));
  $('dm-add-all-btn').addEventListener('click', () => addRecipeToCart('all'));
```

- [ ] **Step 5: Add the bought-tap and clear handlers**

Inside `wire()`, after the pantry-grid click handler (after line ~296), add a delegated handler on the cart grid:

```js
  // Shopping cart: tap a contribution to mark it bought; Clear cart empties it
  $('cart-grid').addEventListener('click', (e) => {
    const bought = e.target.closest('[data-action="bought"]');
    if (bought) {
      const { recipeId, line } = bought.dataset;
      const res = markBought(state.cart, recipeId, line, state.pantry);
      if (!res.removed) return;
      state.cart = res.cart;
      state.pantry = res.pantry;
      save();
      renderCart();
      renderPantry();
      renderRecipes();
      toast(`Bought “${res.name}” — added to pantry`);
      return;
    }
  });

  $('cart-clear-btn').addEventListener('click', () => {
    if (!state.cart.length) return;
    state.cart = clearCart();
    save();
    renderCart();
    toast('Cart cleared');
  });
```

- [ ] **Step 6: Render the cart on boot**

At the end of `app.js` (after `renderPantry();`, line ~445), add:

```js
renderCart();
```

- [ ] **Step 7: Verify the suite still passes**

Run: `npm test`
Expected: PASS — no regressions. (`app.js` is not unit-tested; it is verified manually next.)

- [ ] **Step 8: Manual smoke test**

Run: `npx serve docs` (or `python3 -m http.server -d docs 8000`) and open the app.

1. Open a recipe (e.g. Shakshuka). Tap "Add all items to cart". Toast shows "Added 3 items to cart".
2. Open the Pantry panel → Shopping cart section shows grouped rows. "Eggs" row shows a total when units match (Shakshuka "6 large" + Carbonara "4 large" → "10 large total"); tap a contribution → it leaves the cart and "eggs"/"olive oil" appears in the pantry tags above. Toast confirms.
3. Open Alfredo Sauce, "Add missing items to cart" → only not-in-pantry lines added; if everything is in the pantry, toast says "Nothing missing — you have everything".
4. Re-open Shakshuka, "Add all items to cart" again → no duplicate contributions (idempotency).
5. Reload the page → cart persists.
6. "Clear cart" empties it; pantry unaffected.

- [ ] **Step 9: Commit**

```bash
git add docs/js/app.js
git commit -m "feat(cart): wire render, two add-to-cart buttons, bought tap, and clear

Adds renderCart(); pantries the cart on panel open and boot; the two
detail buttons add missing/all items; tapping a contribution marks it
bought (removes from cart + adds base name to pantry); Clear empties."
```

---

## Self-review (run against PRD 1)

- **Two buttons (PRD §7.1):** Task 7 adds both `#dm-add-missing-btn` and `#dm-add-all-btn`; Task 8 wires both. ✓
- **Add all items pantry-agnostic (§7.1):** `addToCart('all')` ignores `haveIngredient` (Task 2). ✓
- **Idempotency (§6.2):** `addToCart` filters out the recipe's existing contributions first (Task 2), tested. ✓
- **Decoupling (§4, §10):** cart is never pruned by pantry; only `markBought`/remove/clear mutate it (Tasks 2/3/8). ✓
- **Bought → pantry in one step (§7.2):** `markBought` removes the contribution and adds the name to the pantry (Task 3), wired in Task 8. ✓
- **Bought removes only the tapped contribution (§10):** `markBought` filters the single matched item; other same-name contributions remain (Task 3 test "leaves other contributions untouched"). ✓
- **Grouping + sum-when-safe (§8.2):** `groupCart` + `sumIfHomogeneous` (Task 4), rendered in Task 6. ✓
- **Persistence (§9):** `cb_cart` in constants (Task 5), state/save/load (Task 5). ✓
- **Pure + tested (§12):** all `lib/cart.js` functions are pure and covered by `test/cart.test.js` (Tasks 2-4). ✓
- **Error handling (§11):** empty recipe and "nothing missing" toasts (Task 8); corrupt `cb_cart` → `[]` (Task 5). ✓
- **Offline (§13):** no network added anywhere. ✓

No placeholders; all referenced functions (`parseIngredient`, `haveIngredient`, `addToPantry`, `esc`, `pluralize`, `$`, `toast`) exist in the codebase or earlier tasks.