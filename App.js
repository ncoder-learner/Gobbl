import { useRef, useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from './lib/supabase';
import { withTimeout } from './lib/withTimeout';
import { setupNotificationHandler } from './lib/notifications';
import * as Notifications from 'expo-notifications';
import LogMealScreen from './screens/LogMealScreen';
import RecapsScreen from './screens/RecapsScreen';
import TierListScreen from './screens/TierListScreen';
import AccountScreen from './screens/AccountScreen';
import HistoryScreen from './screens/HistoryScreen';
import YoursScreen from './screens/YoursScreen';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import ProfileInfoScreen from './screens/ProfileInfoScreen';
import UsernamePromptScreen from './screens/UsernamePromptScreen';
import FriendsScreen from './screens/FriendsScreen';
import UserProfileScreen from './screens/UserProfileScreen';
import MyProfileScreen from './screens/MyProfileScreen';
import BlockedUsersScreen from './screens/BlockedUsersScreen';
import MealDetailScreen from './screens/MealDetailScreen';
import MapScreen from './screens/MapScreen';
import DayTrailDetailScreen from './screens/DayTrailDetailScreen';
import DayBoardScreen from './screens/DayBoardScreen';
import SlotViewerScreen from './screens/SlotViewerScreen';
import DuelScreen from './screens/DuelScreen';
import DuelLiveListener from './components/DuelLiveListener';
import TourOverlay from './components/TourOverlay';
import { TourProvider, useTour } from './lib/tourContext';
import { navigationRef } from './lib/navigationRef';

const Tab  = createBottomTabNavigator();
const Root = createNativeStackNavigator();

// Lets a shared profile link (com.ncoderpro.foodwrapped://profile/<username>)
// open UserProfileScreen directly when tapped by someone who already has the
// app installed. UserProfileScreen resolves the username to a userId itself.
const linking = {
  prefixes: ['com.ncoderpro.foodwrapped://'],
  config: {
    screens: {
      UserProfile: 'profile/:username',
    },
  },
};

// React Navigation v7 requires all four font slots; without them the tab bar
// accesses theme.fonts.regular → undefined → crashes silently in React 19.
const NAV_THEME = {
  dark: true,
  colors: {
    primary: '#FF6B3D',
    background: '#0d0d0d',
    card: '#0d0d0d',
    text: '#ffffff',
    border: '#2a2a2a',
    notification: '#FF6B3D',
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium:  { fontFamily: 'System', fontWeight: '500' },
    bold:    { fontFamily: 'System', fontWeight: '600' },
    heavy:   { fontFamily: 'System', fontWeight: '700' },
  },
};

// ─── Bottom tab navigator ─────────────────────────────────────────────────────

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0d0d0d', borderTopColor: '#2a2a2a' },
        tabBarActiveTintColor: '#FF6B3D',
        tabBarInactiveTintColor: '#666666',
        sceneContainerStyle: { backgroundColor: '#0d0d0d' },
      }}
    >
      <Tab.Screen
        name="Feed"
        component={DayBoardScreen}
        options={{
          tabBarLabel: 'Feed',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="LogMeal"
        component={LogMealScreen}
        options={{
          tabBarLabel: 'Log',
          tabBarIcon: ({ color, size }) => <Ionicons name="camera-outline" size={size} color={color} />,
        }}
      />
      {/* Merges History, Tier List, and Recaps behind a segmented control —
          three sorts of the same meal data, not three separate concerns.
          The original screens stay registered below (Root.Navigator) so
          by-name navigation to them — e.g. LogMealScreen's
          navigate('TierList', { newMealId }) — still resolves; it now
          presents as a full-screen push instead of a tab switch. */}
      <Tab.Screen
        name="Yours"
        component={YoursScreen}
        options={{
          tabBarLabel: 'Yours',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={MyProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

// ─── Root stack: tabs + push screens ─────────────────────────────────────────

function AppNavigator() {
  return (
    <NavigationContainer ref={navigationRef} theme={NAV_THEME} linking={linking}>
      <DuelLiveListener />
      <Root.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0d0d0d' } }}>
        <Root.Screen name="Tabs" component={TabNavigator} />
        <Root.Screen
          name="UserProfile"
          component={UserProfileScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="Friends"
          component={FriendsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="AccountSettings"
          component={AccountScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="BlockedUsers"
          component={BlockedUsersScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="MealDetail"
          component={MealDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="Map"
          component={MapScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="DayTrailDetail"
          component={DayTrailDetailScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Root.Screen
          name="SlotViewer"
          component={SlotViewerScreen}
          options={{ animation: 'fade' }}
        />
        <Root.Screen
          name="Duel"
          component={DuelScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        {/* No longer standalone tabs (merged into "Yours" — see TabNavigator)
            but kept registered here so by-name navigation to them still
            resolves, e.g. LogMealScreen's navigate('TierList', { newMealId })
            to highlight a just-logged meal. Presents as a push now instead
            of a tab switch. */}
        <Root.Screen
          name="TierList"
          component={TierListScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="History"
          component={HistoryScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Root.Screen
          name="Recaps"
          component={RecapsScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Root.Navigator>
    </NavigationContainer>
  );
}

// Starts the guided tour the moment AppNavigator actually mounts after a
// fresh onboarding completion — not right when the carousel finishes,
// since ProfileInfoScreen/UsernamePromptScreen can still sit in between.
// `trigger` stays true (harmlessly) through those screens; this only does
// anything once it's mounted inside the real navigator.
function AutoStartTour({ trigger, onStarted }) {
  const { startTour } = useTour();
  useEffect(() => {
    if (!trigger) return;
    const id = setInterval(() => {
      if (navigationRef.isReady()) {
        clearInterval(id);
        setTimeout(startTour, 300);
        onStarted();
      }
    }, 150);
    return () => clearInterval(id);
  }, [trigger]);
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function onboardingKey(userId) {
  return `onboarding_done_${userId}`;
}

function profileInfoKey(userId) {
  return `profile_info_done_${userId}`;
}

async function registerPushToken(userId) {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    if (!tokenData.data) return;
    await supabase.from('profiles').update({ push_token: tokenData.data }).eq('id', userId);
  } catch { /* non-fatal */ }
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession]               = useState(undefined);
  const [onboardingDone, setOnboardingDone] = useState(undefined);
  const [hasProfileInfo, setHasProfileInfo] = useState(undefined);
  const [hasUsername, setHasUsername]       = useState(undefined);
  const [autoStartTour, setAutoStartTour]   = useState(false);
  const lastCheckedUserRef                  = useRef(null);

  async function checkProfile(userId) {
    if (lastCheckedUserRef.current === userId) return;
    lastCheckedUserRef.current = userId;

    // checkProfile is called fire-and-forget (no .catch at the call site),
    // so nothing here may throw past this try/catch — an uncaught rejection
    // would leave whichever states hadn't been set yet stuck at `undefined`
    // forever, which is exactly what isLoading treats as "still checking".
    // The `finally` below is the last-resort guarantee: no matter what goes
    // wrong above (including a query that hangs and never resolves at all —
    // confirmed to happen on this device around a sign-out/sign-in cycle,
    // hence the withTimeout wraps below), every state gets resolved to
    // *something* so the app can never hang on the loading spinner forever.
    try {
      // AsyncStorage is the primary source of truth for onboarding/profile-info.
      // It persists even when DB writes fail (RLS, network, migration not run, etc.).
      const [localOnboardingDone, localProfileInfoDone] = await Promise.all([
        AsyncStorage.getItem(onboardingKey(userId)).catch(() => null),
        AsyncStorage.getItem(profileInfoKey(userId)).catch(() => null),
      ]);

      if (localOnboardingDone === 'true') {
        setOnboardingDone(true);
        if (localProfileInfoDone === 'true') {
          setHasProfileInfo(true);
        } else {
          try {
            const { data } = await withTimeout(
              supabase.from('profiles').select('profile_details_completed').eq('id', userId).maybeSingle(),
              8000,
            );
            setHasProfileInfo(data?.profile_details_completed === true);
          } catch {
            setHasProfileInfo(false);
          }
        }
        try {
          const { data } = await withTimeout(
            supabase.from('profiles').select('username').eq('id', userId).maybeSingle(),
            8000,
          );
          setHasUsername(!!(data?.username));
        } catch {
          setHasUsername(false);
        }
        return;
      }

      // First launch for this user on this device — check DB. Column sets
      // fall back progressively in case a migration hasn't landed on this
      // environment yet (mirrors the pre-existing username fallback below).
      try {
        const { data } = await withTimeout(
          supabase.from('profiles').select('onboarding_completed, profile_details_completed, username').eq('id', userId).maybeSingle(),
          8000,
        );

        const done = data?.onboarding_completed === true;
        setOnboardingDone(done);
        setHasProfileInfo(data?.profile_details_completed === true);
        setHasUsername(!!(data?.username));

        if (done) await AsyncStorage.setItem(onboardingKey(userId), 'true').catch(() => {});
      } catch {
        try {
          const { data } = await withTimeout(
            supabase.from('profiles').select('onboarding_completed, username').eq('id', userId).maybeSingle(),
            8000,
          );

          const done = data?.onboarding_completed === true;
          setOnboardingDone(done);
          setHasProfileInfo(false);
          setHasUsername(!!(data?.username));

          if (done) await AsyncStorage.setItem(onboardingKey(userId), 'true').catch(() => {});
        } catch {
          // username/profile_details_completed columns might not exist yet —
          // fall back to onboarding_completed only.
          try {
            const { data } = await withTimeout(
              supabase.from('profiles').select('onboarding_completed').eq('id', userId).maybeSingle(),
              8000,
            );

            const done = data?.onboarding_completed === true;
            setOnboardingDone(done);
            setHasProfileInfo(false);
            setHasUsername(false);

            if (done) await AsyncStorage.setItem(onboardingKey(userId), 'true').catch(() => {});
          } catch {
            setOnboardingDone(false);
            setHasProfileInfo(false);
            setHasUsername(false);
          }
        }
      }
    } catch (err) {
      console.warn('[App] checkProfile failed unexpectedly:', err?.message ?? err);
    } finally {
      setOnboardingDone(v => v === undefined ? false : v);
      setHasProfileInfo(v => v === undefined ? false : v);
      setHasUsername(v => v === undefined ? false : v);
    }
  }

  useEffect(() => {
    setupNotificationHandler();
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session ?? null);

      // TOKEN_REFRESHED needs the same handling as SIGNED_IN/INITIAL_SESSION:
      // signing back in (especially via OAuth) right after a sign-out can
      // land as a token refresh of a not-yet-fully-cleared internal session
      // rather than a clean SIGNED_IN — if that case isn't handled here,
      // checkProfile never runs and onboardingDone/hasProfileInfo/hasUsername
      // stay stuck at `undefined` forever, hanging isLoading indefinitely.
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session) {
          checkProfile(session.user.id);
          registerPushToken(session.user.id);
        } else {
          // `undefined`, not `false` — isLoading below waits specifically
          // for `undefined` ("not checked yet"). A stale `false` here would
          // satisfy that gate before checkProfile has actually run for the
          // next signed-in user, so the app briefly shows
          // Onboarding/ProfileInfo/UsernamePrompt for an account that
          // already completed all three.
          setOnboardingDone(undefined);
          setHasProfileInfo(undefined);
          setHasUsername(undefined);
        }
      } else if (event === 'SIGNED_OUT') {
        lastCheckedUserRef.current = null;
        setOnboardingDone(undefined);
        setHasProfileInfo(undefined);
        setHasUsername(undefined);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleOnboardingDone() {
    setOnboardingDone(true);
    setAutoStartTour(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await AsyncStorage.setItem(onboardingKey(user.id), 'true');
    } catch { /* non-fatal */ }
  }

  async function handleProfileInfoDone() {
    setHasProfileInfo(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await AsyncStorage.setItem(profileInfoKey(user.id), 'true');
    } catch { /* non-fatal */ }
  }

  function handleUsernameDone() {
    setHasUsername(true);
  }

  const isLoading =
    session === undefined ||
    (session !== null && onboardingDone === undefined) ||
    (session !== null && onboardingDone === true && hasProfileInfo === undefined) ||
    (session !== null && onboardingDone === true && hasProfileInfo === true && hasUsername === undefined);

  // Single render tree — no separate early return for loading state.
  // This prevents the GestureHandlerRootView + SafeAreaProvider from unmounting
  // and remounting between the loading and content phases (which caused a white flash).
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0d0d0d' }}>
      <SafeAreaProvider>
        {isLoading ? (
          <View style={{ flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#FF6B3D" />
          </View>
        ) : !session ? (
          <AuthScreen />
        ) : !onboardingDone ? (
          <OnboardingScreen onDone={handleOnboardingDone} />
        ) : !hasProfileInfo ? (
          <ProfileInfoScreen onDone={handleProfileInfoDone} />
        ) : !hasUsername ? (
          <UsernamePromptScreen onDone={handleUsernameDone} />
        ) : (
          <TourProvider>
            <AppNavigator />
            <TourOverlay />
            <AutoStartTour trigger={autoStartTour} onStarted={() => setAutoStartTour(false)} />
          </TourProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
