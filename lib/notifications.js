import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { getOneSignalPermission } from './oneSignal';

const PREFS_KEY = '@fw_notif_prefs';
const AUTO_SETUP_KEY = '@fw_notif_auto_setup_v2';
const ID_DAILY = 'fw-daily-reminder';
const ID_STREAK = 'fw-streak-risk';
const CHANNEL_DEFAULT = 'default';
const CHANNEL_SOCIAL = 'social';
const CHANNEL_REMINDERS = 'reminders';
const CHANNEL_STREAK = 'streak';

export const DEFAULT_PREFS = {
  enabled: true,
  reminderHour: 19,   // 7 PM
  reminderMinute: 0,
};

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;

  await Promise.all([
    Notifications.setNotificationChannelAsync(CHANNEL_DEFAULT, {
      name: 'Gobbl',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 120, 200],
    }),
    Notifications.setNotificationChannelAsync(CHANNEL_SOCIAL, {
      name: 'Social activity',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
    }),
    Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, {
      name: 'Meal reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    }),
    Notifications.setNotificationChannelAsync(CHANNEL_STREAK, {
      name: 'Streak alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 120, 250],
    }),
  ]).catch(() => {});
}

// Call once at app startup (in App.js useEffect).
export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  ensureAndroidChannels();
}

export async function loadNotifPrefs() {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function saveNotifPrefs(prefs) {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  } catch {}
}

// Returns 'granted' | 'denied' | 'undetermined'
export async function getPermissionStatus() {
  const oneSignalPermission = await getOneSignalPermission();
  if (oneSignalPermission !== null) return oneSignalPermission ? 'granted' : 'denied';
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

// Returns true if granted; false if denied (user must go to system settings).
export async function requestPermission() {
  await ensureAndroidChannels();
  const oneSignalPermission = await getOneSignalPermission();
  if (oneSignalPermission !== null) return oneSignalPermission;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  if (status === 'denied') return false;
  const { status: next } = await Notifications.requestPermissionsAsync();
  return next === 'granted';
}

export async function registerPushTokenForUser(userId) {
  if (!userId) return false;
  await ensureAndroidChannels();

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return false;

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId;

  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  if (!tokenData?.data) return false;

  await supabase
    .from('profiles')
    .update({ push_token: tokenData.data })
    .eq('id', userId);
  return true;
}

// Schedule the repeating daily reminder. Replaces any existing one.
export async function scheduleDailyReminder(hour, minute) {
  try { await Notifications.cancelScheduledNotificationAsync(ID_DAILY); } catch {}
  await Notifications.scheduleNotificationAsync({
    identifier: ID_DAILY,
    content: {
      title: '🍽️ Time to log a meal',
      body: "Capture what you're eating today and keep your streak alive!",
      sound: true,
      data: { type: 'meal_reminder' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: CHANNEL_REMINDERS,
    },
  });
}

// Enable notifications: request permission then schedule the daily reminder.
// Returns true if permission was granted.
export async function enableNotifications(hour, minute) {
  const granted = await requestPermission();
  if (!granted) return false;
  await scheduleDailyReminder(hour, minute);
  return true;
}

// First-run default-on setup. It asks once per user/device, registers the push
// token when allowed, and schedules the meal reminder using the saved/default
// reminder time.
export async function ensureDefaultNotifications(userId) {
  if (!userId) return false;
  if (Platform.OS === 'android') return false;

  const setupKey = `${AUTO_SETUP_KEY}:${userId}`;
  const [alreadyTried, prefs] = await Promise.all([
    AsyncStorage.getItem(setupKey).catch(() => null),
    loadNotifPrefs(),
  ]);

  if (prefs.enabled === false || alreadyTried === 'true') {
    if (prefs.enabled) await registerPushTokenForUser(userId).catch(() => false);
    return false;
  }

  await AsyncStorage.setItem(setupKey, 'true').catch(() => {});
  const granted = await enableNotifications(prefs.reminderHour, prefs.reminderMinute);
  if (!granted) {
    await saveNotifPrefs({ ...prefs, enabled: false });
    return false;
  }

  await saveNotifPrefs({ ...prefs, enabled: true });
  await registerPushTokenForUser(userId).catch(() => false);
  return true;
}

// Cancel all FoodWrapped notifications.
export async function disableNotifications() {
  try { await Notifications.cancelScheduledNotificationAsync(ID_DAILY); } catch {}
  try { await Notifications.cancelScheduledNotificationAsync(ID_STREAK); } catch {}
}

// Schedule or cancel tonight's streak-at-risk notification.
// Call this each time the app focuses (HomeScreen useFocusEffect).
// Does nothing if permission is not granted or notifications are disabled in prefs.
export async function syncStreakRiskNotification(streak, loggedToday) {
  try { await Notifications.cancelScheduledNotificationAsync(ID_STREAK); } catch {}

  // Nothing at risk if no streak or already logged today.
  if (streak === 0 || loggedToday) return;

  const now = new Date();
  const fire = new Date(now);
  fire.setHours(21, 0, 0, 0); // 9 PM tonight

  const secondsUntil = Math.floor((fire.getTime() - now.getTime()) / 1000);
  if (secondsUntil <= 0) return; // already past 9 PM

  await Notifications.scheduleNotificationAsync({
    identifier: ID_STREAK,
    content: {
      title: `🔥 ${streak}-day streak at risk!`,
      body: 'Log a meal before midnight to keep your streak alive.',
      sound: true,
      data: { type: 'streak_risk' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsUntil,
      channelId: CHANNEL_STREAK,
    },
  });
}

export async function sendUserNotification(targetUserId, title, body, data = {}) {
  if (!targetUserId || !title || !body) return;
  return supabase.functions.invoke('send-notification', {
    body: { targetUserId, title, body, data },
  });
}

export async function notifyLike(targetUserId, actorUsername) {
  return sendUserNotification(
    targetUserId,
    '❤️ New like',
    `@${actorUsername || 'Someone'} liked your meal!`,
    { type: 'like' },
  );
}

export async function notifyComment(targetUserId, actorUsername) {
  return sendUserNotification(
    targetUserId,
    '💬 New comment',
    `@${actorUsername || 'Someone'} commented on your meal!`,
    { type: 'comment' },
  );
}

export async function notifyFriendRequest(targetUserId, actorUsername) {
  return sendUserNotification(
    targetUserId,
    '👋 New friend request',
    `@${actorUsername || 'Someone'} wants to be friends on Gobbl.`,
    { type: 'friend_request' },
  );
}

export async function notifyFriendAccepted(targetUserId, actorUsername) {
  return sendUserNotification(
    targetUserId,
    '🤝 Friend request accepted',
    `@${actorUsername || 'Someone'} accepted your friend request!`,
    { type: 'friend_accepted' },
  );
}

export async function notifyFriendPost(targetUserId, actorUsername, mealName) {
  const body = mealName
    ? `@${actorUsername || 'Someone'} posted ${mealName}.`
    : `@${actorUsername || 'Someone'} posted a meal.`;
  return sendUserNotification(
    targetUserId,
    '🍽️ Friend posted',
    body,
    { type: 'friend_post' },
  );
}
