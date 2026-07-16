import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { mappableCoords, displayPlaceName } from '../lib/homePrivacy';
import Avatar from '../components/Avatar';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc', white: '#ffffff',
  gray1: '#888888', gray2: '#666666', gray4: '#444444',
};

const TAG_EMOJI = { breakfast: '🌅', lunch: '☀️', dinner: '🌙' };

const DEFAULT_REGION = {
  // Fallback when there's no device location and no pins yet — center of
  // the continental US, wide zoom, so the map isn't stuck on (0,0)/ocean.
  latitude: 39.5, longitude: -98.35, latitudeDelta: 40, longitudeDelta: 40,
};

const MEAL_FIELDS = 'id, name, emoji, tag, score, photo_url, place_id, created_at, places(lat, lng, name)';

// Local-calendar-day boundary, not UTC — a meal logged at 11pm shouldn't
// disappear from "today" for someone west of UTC just because the UTC date
// has already rolled over.
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

// `isOwner` drives home-meal privacy (lib/homePrivacy.js): a non-owner never
// gets a coordinate for a home meal — not even a fuzzed one — so a friend's
// home meal simply produces no pin on this map at all (there's no sensible
// "fixed non-map position" inside an actual interactive geographic map; that
// treatment is DayTrail's sequence-strip only). "My Meals" mode is always
// self-view (isOwner: true); "Friends" mode is always someone else's meal
// (isOwner: false), since that query already excludes the viewer's own posts.
function toPin(meal, { isOwner, poster } = {}) {
  if (!meal || !meal.place_id) return null;
  const coord = mappableCoords(meal, { isOwner });
  if (!coord) return null;
  return {
    id: meal.id,
    lat: coord.lat,
    lng: coord.lng,
    emoji: TAG_EMOJI[meal.tag] || meal.emoji || '📍',
    name: meal.name,
    place: displayPlaceName(meal),
    poster: poster || null, // {username, first_name, last_name, display_name, avatar_url} — friends-mode pins only
  };
}

async function loadMyMealPins(userId) {
  const { data, error } = await supabase
    .from('meals')
    .select(MEAL_FIELDS)
    .eq('user_id', userId)
    .not('place_id', 'is', null);
  if (error) throw error;
  return (data || []).map(m => toPin(m, { isOwner: true })).filter(Boolean);
}

async function loadFriendMealPins(userId) {
  // Only meals a friend has actually posted — never their private/unposted
  // log. A tri-image post can carry up to 3 meals (breakfast/lunch/dinner
  // slots); meal_id is the legacy/primary slot, kept for posts made before
  // those columns existed. RLS (posts_not_blocked, see_own_and_friends_posts)
  // already restricts this to accepted friends and hides blocked users.
  // Pins are further filtered to meals logged today (local calendar day) —
  // this is a "where are my friends eating right now" view, not a historical
  // map, so yesterday's (or older) meals are dropped even though the query
  // still fetches them.
  const { data, error } = await supabase
    .from('posts')
    .select(`
      user_id,
      profiles!posts_user_id_fkey(username, first_name, last_name, display_name, avatar_url),
      legacy:meals!meal_id(${MEAL_FIELDS}),
      breakfast:meals!breakfast_meal_id(${MEAL_FIELDS}),
      lunch:meals!lunch_meal_id(${MEAL_FIELDS}),
      dinner:meals!dinner_meal_id(${MEAL_FIELDS})
    `)
    .neq('user_id', userId);
  if (error) throw error;

  const pinsById = new Map();
  for (const post of data || []) {
    const slots = [post.breakfast, post.lunch, post.dinner].filter(Boolean);
    const meals = slots.length > 0 ? slots : [post.legacy].filter(Boolean);
    for (const meal of meals) {
      if (!isToday(meal.created_at)) continue;
      const pin = toPin(meal, { isOwner: false, poster: post.profiles });
      if (pin) pinsById.set(pin.id, pin);
    }
  }
  return Array.from(pinsById.values());
}

function regionFromPins(pins) {
  if (pins.length === 0) return null;
  const lats = pins.map(p => p.lat);
  const lngs = pins.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(maxLat - minLat, 0.05) * 1.6,
    longitudeDelta: Math.max(maxLng - minLng, 0.05) * 1.6,
  };
}

// react-native-maps rasterizes a custom Marker's children into a static
// image and, by default, only re-snapshots while `tracksViewChanges` is
// true. A remote avatar Image loads asynchronously *after* that first
// snapshot, so without this the marker gets frozen as a blank/black bubble
// forever. Keep tracking until the photo (or its absence) has actually
// rendered once, then switch it off so markers aren't re-rasterized every
// frame (expensive, and the usual reason people avoid this prop).
function PinMarker({ pin, onPress }) {
  // Only a remote avatar photo loads asynchronously — initials and the
  // plain emoji pin both render synchronously on first paint, so only the
  // photo case needs to keep tracking past the initial snapshot.
  const [tracking, setTracking] = useState(!!pin.poster?.avatar_url);
  return (
    <Marker
      coordinate={{ latitude: pin.lat, longitude: pin.lng }}
      title={pin.poster?.username ? `@${pin.poster.username}` : pin.name}
      description={pin.place}
      onPress={onPress}
      tracksViewChanges={tracking}
    >
      <View style={styles.pinBubble}>
        {pin.poster ? (
          <Avatar
            uri={pin.poster.avatar_url}
            firstName={pin.poster.first_name}
            lastName={pin.poster.last_name}
            displayName={pin.poster.display_name}
            username={pin.poster.username}
            size={34}
            style={styles.pinAvatarWrap}
            textStyle={styles.pinInitial}
            onLoadEnd={() => setTracking(false)}
          />
        ) : (
          <Text style={styles.pinEmoji}>{pin.emoji}</Text>
        )}
      </View>
    </Marker>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <View style={styles.toggleRow}>
      <TouchableOpacity
        style={[styles.toggleBtn, mode === 'mine' && styles.toggleBtnActive]}
        onPress={() => onChange('mine')}
        activeOpacity={0.85}
      >
        <Text style={[styles.toggleText, mode === 'mine' && styles.toggleTextActive]}>My Meals</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toggleBtn, mode === 'friends' && styles.toggleBtnActive]}
        onPress={() => onChange('friends')}
        activeOpacity={0.85}
      >
        <Text style={[styles.toggleText, mode === 'friends' && styles.toggleTextActive]}>Friends</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MapScreen() {
  const navigation = useNavigation();
  const [mode, setMode] = useState('mine');
  const [pins, setPins] = useState([]);
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mapRef = useRef(null);
  const pinsAlreadyLoadedRef = useRef(false);

  // Best-effort device location for the initial region only — mirrors the
  // permission pattern already used in LogMealScreen/TierListScreen ("Near
  // Me"). Non-fatal if denied; pins' own bounding box takes priority once
  // loaded (see load() below), applied imperatively so it doesn't fight the
  // user's own panning/zooming.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || pinsAlreadyLoadedRef.current) return;
        const pos = await Location.getCurrentPositionAsync({});
        const here = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        };
        setRegion(here);
        mapRef.current?.animateToRegion(here, 400);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const load = useCallback(async (currentMode) => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const loaded = currentMode === 'mine'
        ? await loadMyMealPins(user.id)
        : await loadFriendMealPins(user.id);

      setPins(loaded);
      const bbox = regionFromPins(loaded);
      if (bbox) {
        pinsAlreadyLoadedRef.current = true;
        setRegion(bbox);
        mapRef.current?.animateToRegion(bbox, 500);
      }
    } catch (err) {
      setError(err.message || 'Failed to load map.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(mode);
    }, [mode, load])
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Map</Text>
        <View style={{ width: 22 }} />
      </View>

      <ModeToggle mode={mode} onChange={setMode} />

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton
        >
          {pins.map(pin => (
            <PinMarker
              key={pin.id}
              pin={pin}
              onPress={() => navigation.navigate('MealDetail', { mealId: pin.id })}
            />
          ))}
        </MapView>

        {loading && (
          <View style={styles.overlay}>
            <ActivityIndicator color={C.orange} />
          </View>
        )}

        {!loading && pins.length === 0 && (
          <View style={styles.emptyBanner}>
            <Text style={styles.emptyText}>
              {mode === 'mine'
                ? 'No logged meals with a location yet.'
                : "No friends have posted a located meal today yet."}
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.emptyBanner}>
            <Text style={[styles.emptyText, { color: '#ff6b6b' }]}>{error}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navTitle: { fontSize: 15, fontWeight: '600', color: C.white },

  toggleRow: {
    flexDirection: 'row', marginHorizontal: 20, marginBottom: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 4,
    borderWidth: 0.5, borderColor: C.border,
  },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: C.purple },
  toggleText: { fontSize: 13, fontWeight: '600', color: C.gray2 },
  toggleTextActive: { color: C.white },

  mapWrap: { flex: 1 },
  pinBubble: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.orange,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  pinEmoji: { fontSize: 16 },
  pinAvatarWrap: { backgroundColor: C.surface },
  pinInitial: { fontSize: 14, fontWeight: '700', color: C.purple },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(13,13,13,0.35)',
  },
  emptyBanner: {
    position: 'absolute', bottom: 24, left: 20, right: 20,
    backgroundColor: 'rgba(26,26,26,0.92)', borderRadius: 12,
    borderWidth: 0.5, borderColor: C.border,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  emptyText: { fontSize: 13, color: C.gray1, textAlign: 'center' },
});
