import { sendUserNotification } from './notifications';

export function notifyMealTimeReminder(targetUserId, slotLabel = 'meal', timeWindow = 'today') {
  if (!targetUserId) return Promise.resolve(null);

  return sendUserNotification(
    targetUserId,
    'Time to log your next meal',
    `Log ${slotLabel} for ${timeWindow} before the window closes.`,
    { type: 'meal_time_reminder', slotLabel, timeWindow },
  );
}

export function notifyFriendMealLogged(targetUserId, friendUsername, mealLabel) {
  if (!targetUserId || !friendUsername) return Promise.resolve(null);

  const label = mealLabel ? mealLabel.toLowerCase() : 'a meal';

  return sendUserNotification(
    targetUserId,
    '👀 Friend activity',
    `${friendUsername} just logged ${label}.`,
    { type: 'friend_meal_logged', friendUsername, mealLabel: label },
  );
}

export function notifyDailyDuelReady(targetUserId, duelTitle = 'Daily duel') {
  if (!targetUserId) return Promise.resolve(null);

  return sendUserNotification(
    targetUserId,
    '⚔️ Results ready',
    `${duelTitle} results are ready. Check who won.`,
    { type: 'daily_duel_ready', duelTitle },
  );
}

export function notifyQuickLogReminder(targetUserId) {
  if (!targetUserId) return Promise.resolve(null);

  return sendUserNotification(
    targetUserId,
    '📸 Quick log ready',
    'Snap a photo and tag your meal — no extra steps needed.',
    { type: 'quick_log_reminder' },
  );
}
