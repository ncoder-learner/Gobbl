// Short on purpose — this is a live walkthrough, not another slide deck.
// `advance: 'action'` triggers the real onPress registered on the target
// (actually opens SlotViewer with real data) instead of a scripted nav, so
// the tour always shows real content. `requiresPriorNav: true` steps only
// play if that action actually fired — an empty board has no tile to tap,
// so the swipe/like steps quietly skip themselves rather than showing a
// screen that never opened.
export const TOUR_STEPS = [
  {
    id: 'board-you',
    targetId: 'board.youtile',
    text: 'Tap here to log a meal into this slot.',
    fallbackText: 'Each slot has a "+ you" tile — tap it to log a meal there.',
    advance: 'button',
  },
  {
    id: 'board-tile',
    targetId: 'board.tile.first',
    text: 'Tap a photo to swipe through everyone’s meals here, like, and comment.',
    fallbackText: 'Once meals are posted, tap any photo to swipe through, like, and comment.',
    advance: 'action',
  },
  {
    id: 'slot-swipe',
    text: 'Swipe up/down for the next person, left/right through their photos.',
    advance: 'button',
    requiresPriorNav: true,
  },
  {
    id: 'slot-like',
    targetId: 'slotviewer.like',
    text: 'Tap to like a meal.',
    fallbackText: 'Tap the heart to like a meal.',
    advance: 'button',
    requiresPriorNav: true,
  },
  {
    id: 'back-to-board',
    mode: 'auto-action',
    action: 'back',
    requiresPriorNav: true,
  },
  {
    id: 'board-duel',
    targetId: 'board.duelcard.first',
    text: 'Once a slot’s window closes, a duel opens — vote for the best.',
    fallbackText: 'Once a slot’s window closes, a Tier Duel opens here — vote for the best meal.',
    advance: 'button',
  },
  {
    id: 'board-trail',
    targetId: 'board.trailcard',
    text: 'Eat at 2+ places in a day and your Day Trail appears here.',
    fallbackText: 'Eat at 2+ places in a day and a Day Trail card appears here — a map of your day.',
    advance: 'button',
  },
  {
    id: 'board-friends',
    targetId: 'board.friends',
    text: 'Add friends here to see what they\'re eating alongside you.',
    advance: 'button',
  },
  // board-map and goto-yours were cut: both explained a feature that's
  // empty for a brand-new user with nothing logged yet (map has no pins,
  // Yours has no history/recaps) — low payoff for a forced step, and
  // both are easy to discover once there's actually something to show.
  {
    id: 'board-compose',
    targetId: 'board.compose',
    text: 'Tap here anytime to log a meal — or head to the Log Meal tab below to do it now.',
    advance: 'button',
  },
  // From here on the tour switches tabs itself before showing each card —
  // `navigateTo` fires before the step's card resolves, same as the
  // fallback delay above gives a just-navigated screen time to settle.
  // goto-logmeal was merged into board-compose above (both taught "how to
  // log a meal" back-to-back via two different entry points).
  {
    id: 'goto-profile',
    navigateTo: 'Profile',
    text: 'Your profile, streak, and settings — including this tour, any time, under "How it works."',
    advance: 'button',
  },
  {
    id: 'tour-done',
    navigateTo: 'Feed',
    text: 'That’s it — you’re set. 🎉',
    advance: 'button',
    isFinal: true,
  },
];
