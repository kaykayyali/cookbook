# Normalized Recipe Cart — Design

**Status:** Approved for implementation (2026-07-13)

## Purpose

Replace the current cart of copied ingredient strings with recipe selections that can be scaled by servings and compiled into one concise, normalized shopping list.

## Core rule

The LLM interprets ingredient language once. Deterministic code performs all serving arithmetic, unit conversion, safety margin calculation, aggregation, and display formatting.

An AI failure must never prevent a recipe from being added to the cart. A deterministic parser and the original ingredient text are always retained as fallbacks.

## User flow

1. Open a shared recipe and select **Add recipe to cart**.
2. Normalize the recipe's ingredient lines if no valid cached normalization exists.
3. Add a local cart selection containing the recipe ID, source servings, target servings, and normalized ingredient snapshot.
4. Display the selected recipe in the Cart with decrement/increment serving controls.
5. Recompile the aggregated shopping list immediately whenever target servings change.
6. Present one concise line per canonical ingredient, regardless of how many selected recipes use it.

## Data contracts

### Normalized ingredient

```json
{
  "raw": "1 dozen large eggs",
  "name": "egg",
  "quantity": 12,
  "unit": "count",
  "kind": "count",
  "confidence": 0.99
}
```

Unquantified ingredients remain qualitative:

```json
{
  "raw": "salt to taste",
  "name": "salt",
  "quantity": null,
  "unit": "qualitative",
  "kind": "qualitative",
  "confidence": 0.95
}
```

### Cart recipe selection

```json
{
  "recipeId": "recipe-id",
  "recipeName": "Recipe name",
  "sourceServings": 4,
  "targetServings": 2,
  "normalizationVersion": 1,
  "ingredients": []
}
```

Cart selections are device-local. Recipes remain shared and D1 remains the authoritative recipe source.

## Scaling and aggregation

For each normalized ingredient contribution:

```text
scaled quantity = normalized quantity × target servings ÷ source servings
```

Contributions with the same canonical ingredient name are converted to compatible canonical units and summed before any safety margin or purchase rounding is applied.

Example:

- Recipe A: 1 dozen eggs for 4 servings, target 2 servings → 6 eggs
- Recipe B: 2 eggs for 2 servings, target 2 servings → 2 eggs
- Aggregated required amount → 8 eggs

## Cooking-equivalent conversion policy

Flexibility and practical grocery use are more important than density precision.

Canonical storage dimensions:

- count
- ounces-equivalent for mass and volume
- qualitative

Conversions:

- 1 mL ≈ 1 g
- 1 fl oz ≈ 1 oz
- 1 cup = 8 oz
- 1 tbsp = 0.5 oz
- 1 tsp = 1/6 oz
- 1 lb = 16 oz
- 1 kg = 35.274 oz
- 1 dozen = 12 count

Mass and volume may merge for the same canonical ingredient using these cooking equivalents.

## Safety and rounding

1. Aggregate every selected recipe contribution.
2. Apply a 10% safety margin once to the aggregate.
3. Format the result as a practical US grocery/cooking quantity.

For divisible mass and volume:

```text
required ≤ shopping amount ≤ required × 1.10
```

For indivisible counts and packages, round up to the smallest whole item even when this necessarily exceeds 110%.

Do not apply the safety margin independently to each recipe; that would compound surplus.

## Pantry policy

The pantry is informational and assumed to be approximately 80% accurate.

- Never subtract pantry quantities from the shopping calculation.
- Never exclude an ingredient merely because its canonical name appears in the pantry.
- Show a subtle **In pantry** indicator on matching shopping-list lines.
- Users manually check off or remove items they do not need.

A complete concise list is more important than inferred pantry logic.

## AI normalization

The normalizer receives the recipe name, declared yield, and raw ingredient strings. It returns only structured normalized ingredients.

Validation requirements:

- One output record for every input line.
- Every record preserves its original `raw` line.
- `name` must be non-empty.
- Numeric quantities must be finite and non-negative.
- Units and kinds must come from the supported vocabulary.
- Invalid or missing records fall back to deterministic parsing.
- Qualitative and low-confidence records remain visible rather than being discarded.

Normalized output should be cached with a normalization version so serving adjustments and repeat cart additions do not invoke the LLM again unnecessarily.

## Migration

The existing local cart contains flat ingredient contributions. Loading must accept that shape without crashing or erasing unrelated pantry data. Legacy cart lines may be migrated into a synthetic selection or retained through a compatibility path until the user clears the cart.

## Acceptance criteria

- Two approved example recipes set to two servings compile to eight required eggs before safety rounding.
- Same-name compatible ingredients merge across recipes.
- Serving controls recalculate locally without another AI call.
- The 10% margin is applied once after aggregation.
- Whole counts round upward when required.
- Pantry matches remain in the list and display informational status.
- AI failure falls back without blocking Add to Cart.
- Existing local cart data loads safely.
- Full test suite and production build pass.
