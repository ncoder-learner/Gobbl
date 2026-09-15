// Short, deterministic guidance. This is educational planning support, not
// medical or training advice, and deliberately does not depend on an AI call.
const GUIDES = {
  maintenance: {
    workout: 'Build a durable base: 3 full-body strength sessions and 2 easy cardio sessions this week.',
    meal: 'Balanced plate: grilled chicken or tofu, rice or potatoes, and two colorful vegetables.',
    feed: 'Share a balanced plate to give friends an easy dinner idea.',
  },
  muscle_gain: {
    workout: 'Progressive strength: add 1 rep or a small amount of weight to one compound lift each session.',
    meal: 'Recovery bowl: lean protein, rice, roasted vegetables, olive oil, and Greek yogurt or a dairy-free swap.',
    feed: 'Post your post-workout meal so your training crew can compare recovery fuel.',
  },
  weight_loss: {
    workout: 'Keep strength first: 3 resistance sessions, then finish with a 20-minute easy walk or bike ride.',
    meal: 'High-volume bowl: protein, a big serving of vegetables, beans or potato, and a bright yogurt-lemon dressing.',
    feed: 'Show a satisfying high-protein plate—friends can save it as a lean-day idea.',
  },
  keto: {
    workout: 'Start with steady strength and low-intensity cardio while you learn how your energy responds.',
    meal: 'Keto plate: salmon or eggs, avocado, greens, roasted zucchini, and a handful of nuts if tolerated.',
    feed: 'Share a low-carb plate and tag the meal so friends can spot your keto-friendly ideas.',
  },
  clean_eating: {
    workout: 'Aim for movement variety: strength, a longer walk, and mobility work spread through the week.',
    meal: 'Whole-food plate: protein, whole grain, seasonal vegetables, fruit, and a healthy-fat dressing.',
    feed: 'Post one ingredient-forward meal to start a cleaner-plate streak with friends.',
  },
  no_restriction: {
    workout: 'Choose something repeatable: two strength sessions and two sessions of movement you genuinely enjoy.',
    meal: 'Flexible plate: hit a protein anchor, add produce, then make room for the food you actually want.',
    feed: 'Share the meal you are proud of today—consistency beats perfection.',
  },
};

export function getHealthGuidance(goal) {
  return GUIDES[goal] || GUIDES.maintenance;
}
