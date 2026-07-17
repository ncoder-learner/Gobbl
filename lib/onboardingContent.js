// Shared between OnboardingScreen (first run, marks onboarding_completed) and
// AccountScreen's "How it works" replay (no completion write, just a replay)
// — one source of truth for the carousel copy so the two never drift apart.
export const ONBOARDING_SLIDES = [
  {
    emoji: '📸',
    title: 'Log three meals a day',
    body: 'Snap breakfast, lunch, and dinner as you go. Gobbl identifies the dish and rates it with you — takes seconds.',
  },
  {
    emoji: '📋',
    title: "See everyone's day at once",
    body: "The board lays out breakfast, lunch, and dinner for you and your friends, slot by slot — one glance and you know who's eaten what.",
  },
  {
    emoji: '👀',
    title: 'Swipe through, like, comment',
    body: "Tap into any slot to swipe through everyone's meals there, drop a like, or leave a comment.",
  },
  {
    emoji: '🏆',
    title: 'Tier Duels crown the best',
    body: "Once a slot's window closes, a duel opens — vote for your favorite meal in that slot. Most votes wins.",
  },
  {
    emoji: '🗺️',
    title: 'Your Day Trail unlocks',
    body: 'Eat at 2+ places in one day and your Day Trail appears — a map of your day, stop by stop.',
  },
];
