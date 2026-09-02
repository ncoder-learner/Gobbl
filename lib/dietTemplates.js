export const DIET_TEMPLATES = [
  {
    id: 'low-sodium',
    name: 'Low-sodium baseline',
    description: 'Lower sodium, simpler ingredients, and fewer restaurant-heavy meals.',
    tags: ['low_sodium', 'heart_friendly'],
    target: {
      sodiumMg: 1500,
      proteinG: 90,
      calories: 2100,
    },
    notes: ['Keep salt, sauces, and processed meals to a minimum.'],
  },
  {
    id: 'high-protein-athlete',
    name: 'High-protein athlete',
    description: 'Higher protein with enough carbs to support training and recovery.',
    tags: ['high_protein', 'active'],
    target: {
      sodiumMg: 2000,
      proteinG: 130,
      calories: 2600,
    },
    notes: ['Pair protein with carbs and hydration around workouts.'],
  },
  {
    id: 'balanced-generic',
    name: 'Balanced everyday',
    description: 'A moderate template for general maintenance and routine energy.',
    tags: ['balanced', 'general'],
    target: {
      sodiumMg: 1800,
      proteinG: 100,
      calories: 2200,
    },
    notes: ['Prioritize fiber, protein, and a consistent meal rhythm.'],
  },
];

export function filterDietTemplatesForUser(preferences = {}) {
  const inclusions = (preferences.inclusions || preferences.preferred_inclusions || []).map(item => String(item).toLowerCase());
  const exclusions = (preferences.exclusions || preferences.excluded_ingredients || []).map(item => String(item).toLowerCase());

  return DIET_TEMPLATES.filter(template => {
    const templateTags = (template.tags || []).map(tag => String(tag).toLowerCase());
    const hasExcludedTag = templateTags.some(tag => exclusions.includes(tag));
    if (hasExcludedTag) return false;

    if (inclusions.length === 0) return true;
    return templateTags.some(tag => inclusions.includes(tag)) || template.name.toLowerCase().includes(inclusions.join(' '));
  });
}

export const DIET_DISCLAIMER_TEXT = [
  'This is general nutrition guidance, not medical advice.',
  'Talk to a doctor or dietitian before changing your eating pattern, especially if you have allergies, a condition, or are pregnant.',
  'Suggestions are examples and should be tailored to your body and goals.',
];

export function getDietSuggestionCopy() {
  return {
    title: 'Here’s one option',
    disclaimer: DIET_DISCLAIMER_TEXT,
    caution: 'This includes restrictions — have you talked to a doctor?',
  };
}
