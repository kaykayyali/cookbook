const DEFAULT_SELECTORS = {
  welcome: '#panel-week .panel-header h2',
  suggestions: '#pick-for-us-title',
  planner: '#week-grid .week-day:first-child > header',
  recipes: '#panel-recipes .panel-header h2',
  recipeGrid: '#recipe-grid .recipe-card:first-child .card-title',
  pantry: '#panel-pantry #pantry-input',
  shopping: '#panel-cart .plan-shop-tools strong',
  settings: '#panel-settings .panel-header h2',
};

/** A product-specific tour registry built on the generic tour controller. */
export function createCookbookTour({ selectors = DEFAULT_SELECTORS } = {}) {
  return {
    id: 'cookbook',
    version: 1,
    label: 'Cookbook tour',
    steps: [
      {
        id: 'welcome', panel: 'week', target: selectors.welcome,
        title: 'Welcome to your shared cookbook',
        body: 'This is one shared kitchen for both of you. Recipes, plans, pantry hints, and the shopping list stay in sync across your devices.',
      },
      {
        id: 'suggestions', panel: 'week', target: selectors.suggestions,
        title: 'Let the cookbook choose',
        body: 'Pick for us offers three explainable ideas: a household favorite, something different, and a quick option. Open any suggestion to see the recipe.',
      },
      {
        id: 'planner', panel: 'week', target: selectors.planner,
        title: 'Plan the next seven dinners',
        body: 'Choose a recipe—or leftovers, dining out, or an open night—set the servings, then select Add dinner. Tonight is always shown first.',
      },
      {
        id: 'recipes', panel: 'recipes', target: selectors.recipes,
        title: 'Find the recipe you want',
        body: 'Search by name, cuisine, or ingredient. Use the filters for a quick category, or filter by ready to make using your pantry hints.',
      },
      {
        id: 'recipe-grid', panel: 'recipes', target: selectors.recipeGrid,
        title: 'Open, cook, or add a recipe',
        body: 'Open a card for ingredients and method. The + button adds recipes manually, from a URL, or from photographed cookbook pages for review.',
      },
      {
        id: 'pantry', panel: 'pantry', target: selectors.pantry,
        title: 'Keep lightweight pantry hints',
        body: 'Add ingredients you usually have. Pantry matching is informational only—it helps both of you spot ready recipes and never removes items from Shopping.',
      },
      {
        id: 'shopping', panel: 'cart', target: selectors.shopping,
        title: 'Turn the plan into one list',
        body: 'Choose the date range and select Update from plan. The app scales and combines ingredients; either of you can check, remove, filter, or add manual items.',
      },
      {
        id: 'settings', panel: 'settings', target: selectors.settings,
        title: 'Make it yours',
        body: 'Settings holds themes, optional reminders, import/export, and this guide. Select Take the tour again whenever you want a refresher.',
      },
    ],
  };
}
