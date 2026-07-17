import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const PREFS_KEY = '@fw_notif_prefs';
const ID_DAILY = 'fw-daily-reminder';
const ID_STREAK = 'fw-streak-risk';

export const DEFAULT_PREFS = {
  enabled: false,
  reminderHour: 19,   // 7 PM
  reminderMinute: 0,
};

// Call once at app startup (in App.js useEffect).
export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'Gobbl',
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => {});
  }
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
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

// Returns 'granted' | 'denied' | 'undetermined'
export async function getPermissionStatus() {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

// Returns true if granted; false if denied (user must go to system settings).
export async function requestPermission() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  if (status === 'denied') return false;
  const { status: next } = await Notifications.requestPermissionsAsync();
  return next === 'granted';
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
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
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
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsUntil,
    },
  });
}
