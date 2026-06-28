# Cookbook

A modern, mobile-first recipe manager that stores recipes as **schema.org/Recipe** JSON-LD.

## Features

- **Add & organize recipes** with full metadata (prep/cook time, servings, cuisine, dietary info)
- **Pantry tracking** — mark ingredients you have on hand to see which recipes you can make right now
- **Ingredient autocomplete** — when adding to your pantry, suggestions populate from all your saved recipes
- **Recipe detail view** — tap any recipe to see full ingredients (with pantry checklist), numbered steps, and nutrition info
- **Tap ingredients to toggle** — directly from the recipe view, tap any ingredient to add/remove from your pantry
- **Category filtering & search** — filter by Breakfast/Entree/Dessert, cuisine, or ingredient name
- **JSON-LD export/import** — all recipes are valid schema.org/Recipe, so you can export to JSON, import from other sources
- **Fully offline** — everything runs in your browser with localStorage

## Mobile-First Design

- Bottom navigation tab bar (Recipes, Pantry, Import, Export)
- Full-screen detail and edit sheets
- Responsive grid layout (2-col desktop → 1-col mobile)
- Safe-area insets for notched phones
- 44px minimum tap targets

## Getting Started

1. Open `cookbook.html` in any modern browser
2. Add your first recipe or import existing JSON-LD recipes
3. Add ingredients to your pantry
4. Tap recipes to see which ones you can cook right now

## Local Storage

All data is stored in your browser's localStorage. Data persists between sessions and is never sent to any server.

## Export & Share

Use the Export button (sidebar) to download all recipes as valid schema.org/Recipe JSON-LD. Import them elsewhere or share the file.

---

Built with vanilla HTML/CSS/JS. No dependencies, ~1500 lines of code.
