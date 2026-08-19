export const MEAL_TAGS = ['breakfast', 'lunch', 'dinner'];

export const TAG_META = {
  breakfast: { emoji: '🌅', label: 'Breakfast' },
  lunch:     { emoji: '☀️', label: 'Lunch' },
  dinner:    { emoji: '🌙', label: 'Dinner' },
};

export function normalizeMealTag(tag) {
  return MEAL_TAGS.includes(tag) ? tag : null;
}

// Uses the device's local clock. Boundaries: before 11am = breakfast,
// 11am-4pm = lunch, and 4pm onward = dinner.
export function guessMealTag(date = new Date()) {
  const hour = date.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}
