import { Alert, Platform } from 'react-native';
import { OneSignal } from 'react-native-onesignal';

const APP_ID = '618af034-f57c-44e7-82b0-b343c9ee3a7c';
let initialized = false;
let dialogShown = false;
let pushSubscriptionObserver = null;

function isRegistered(subscriptionId) {
  return Boolean(subscriptionId) && !subscriptionId.startsWith('local-');
}

function maybeShowIntegrationCompleteDialog(subscriptionId) {
  if (!isRegistered(subscriptionId) || dialogShown) return;

  dialogShown = true;
  Alert.alert(
    'Your OneSignal SDK integration is complete!',
    'You can now send Push Notifications & In-App Messages through OneSignal. Tap below to enable push notifications.',
    [{
      text: 'Got it',
      onPress: () => OneSignal.Notifications.requestPermission(true),
    }],
    { cancelable: false },
  );
}

export function initializeOneSignal() {
  if (Platform.OS !== 'android' || initialized) return;

  initialized = true;
  OneSignal.initialize(APP_ID);

  pushSubscriptionObserver = (event) => {
    maybeShowIntegrationCompleteDialog(event?.current?.id);
  };
  OneSignal.User.pushSubscription.addEventListener('change', pushSubscriptionObserver);
  OneSignal.User.pushSubscription.getIdAsync()
    .then(maybeShowIntegrationCompleteDialog)
    .catch(() => {});
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
