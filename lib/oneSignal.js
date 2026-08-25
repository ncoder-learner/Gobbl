import { Platform } from 'react-native';
import { OneSignal } from 'react-native-onesignal';

const APP_ID = '618af034-f57c-44e7-82b0-b343c9ee3a7c';
let initialized = false;

export function initializeOneSignal() {
  if (Platform.OS !== 'android' || initialized) return;

  initialized = true;
  OneSignal.initialize(APP_ID);
}

export async function getOneSignalPermission() {
  if (Platform.OS !== 'android') return null;
  return OneSignal.Notifications.getPermissionAsync();
}

export function identifyOneSignalUser(userId) {
  if (Platform.OS === 'android' && userId) OneSignal.login(userId);
}

export function logoutOneSignalUser() {
  if (Platform.OS === 'android') OneSignal.logout();
}
