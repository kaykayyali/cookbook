// ════════════════════════════════════════════════════════
// constants.js — shared constants & seed data
// ════════════════════════════════════════════════════════

export const STORAGE_KEYS = {
  recipes: 'cb_recipes',
  pantry: 'cb_pantry',
};

export const CATEGORIES = [
  'Breakfast', 'Appetizer', 'Entree', 'Side Dish',
  'Dessert', 'Snack', 'Beverage',
];

export const COOKING_METHODS = [
  'Baking', 'Boiling', 'Frying', 'Grilling',
  'Roasting', 'Steaming', 'Stir-Frying', 'Stovetop',
];

export const DIETS = [
  ['https://schema.org/GlutenFreeDiet', 'Gluten Free'],
  ['https://schema.org/DiabeticDiet', 'Diabetic'],
  ['https://schema.org/HalalDiet', 'Halal'],
  ['https://schema.org/KosherDiet', 'Kosher'],
  ['https://schema.org/LowCalorieDiet', 'Low Calorie'],
  ['https://schema.org/LowFatDiet', 'Low Fat'],
  ['https://schema.org/VeganDiet', 'Vegan'],
  ['https://schema.org/VegetarianDiet', 'Vegetarian'],
];

export const SEED_RECIPES = [
  {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Classic Shakshuka',
    recipeCategory: 'Breakfast', recipeCuisine: 'Middle Eastern', recipeYield: '6 servings',
    cookingMethod: 'Stovetop', suitableForDiet: 'https://schema.org/VegetarianDiet',
    prepTime: 'PT10M', cookTime: 'PT20M', totalTime: 'PT30M',
    recipeIngredient: [
      '2 tablespoons olive oil', '1 medium onion, diced',
      '1 red bell pepper, seeded and diced', '4 garlic cloves, finely chopped',
      '2 tsp paprika', '1 tsp cumin', '¼ tsp chili powder',
      '1 (28-oz) can whole peeled tomatoes', '6 large eggs',
      'salt and pepper to taste', 'fresh cilantro, chopped', 'fresh parsley, chopped',
    ],
    recipeInstructions: [
      { '@type': 'HowToStep', position: 1, text: 'Heat olive oil in a large sauté pan over medium heat. Add bell pepper and onion, cook 5 minutes until onion is translucent.' },
      { '@type': 'HowToStep', position: 2, text: 'Add garlic and spices and cook an additional minute until fragrant.' },
      { '@type': 'HowToStep', position: 3, text: 'Pour in tomatoes and juice. Break down with a spoon. Season with salt and pepper and bring to a simmer.' },
      { '@type': 'HowToStep', position: 4, text: 'Make small wells in the sauce and crack an egg into each. Cook 5–8 minutes to your liking. Cover to speed cooking.' },
      { '@type': 'HowToStep', position: 5, text: 'Garnish with chopped cilantro and parsley before serving.' },
    ],
    nutrition: { '@type': 'NutritionInformation', servingSize: '1 serving', calories: '146 kcal', proteinContent: '7 g', fatContent: '9 g', carbohydrateContent: '10 g' },
  },
  {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Spaghetti Carbonara',
    recipeCategory: 'Entree', recipeCuisine: 'Italian', recipeYield: '4 servings',
    cookingMethod: 'Boiling', prepTime: 'PT10M', cookTime: 'PT15M', totalTime: 'PT25M',
    recipeIngredient: [
      '400g spaghetti', '200g pancetta or guanciale', '4 large eggs',
      '100g pecorino romano, grated', '50g parmesan, grated',
      'black pepper to taste', 'salt to taste',
    ],
    recipeInstructions: [
      { '@type': 'HowToStep', position: 1, text: 'Bring a large pot of salted water to boil and cook spaghetti al dente.' },
      { '@type': 'HowToStep', position: 2, text: 'Fry pancetta in a pan until crispy.' },
      { '@type': 'HowToStep', position: 3, text: 'Whisk eggs with grated cheeses and generous black pepper.' },
      { '@type': 'HowToStep', position: 4, text: 'Drain pasta reserving a cup of pasta water. Off heat, toss pasta with pancetta, then fold in egg mixture.' },
      { '@type': 'HowToStep', position: 5, text: 'Add pasta water gradually for a creamy consistency. Serve immediately with extra cheese.' },
    ],
    nutrition: { '@type': 'NutritionInformation', servingSize: '1 serving', calories: '650 kcal', proteinContent: '22 g', fatContent: '20 g', carbohydrateContent: '85 g' },
  },
];

export const SEED_PANTRY = [
  'olive oil', 'eggs', 'garlic', 'salt', 'pepper', 'parsley', 'onion', 'spaghetti',
];
