import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  Vibration,
  Linking,
  Platform,
  StatusBar,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── API Key ─────────────────────────────────────────────────────────────────
// NEVER hardcode a real key here as a fallback string. This file gets bundled
// into the app binary and can be extracted from the APK/IPA, and if it's ever
// committed to git it's in your history forever. Read from env only.
const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

if (__DEV__ && !GOOGLE_PLACES_API_KEY) {
  console.warn(
    '[DiscoverScreen] Missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY. See setup notes at the bottom of this file.'
  );
}

// Key under which the user's saved ("Craved") places are persisted locally.
const CRAVED_STORAGE_KEY = '@discover_craved_places_v1';

// Broad search radius (~10 miles in meters)
const SEARCH_RADIUS_METERS = 16000;

// Diverse search categories used to fetch a multitude of places
const CUISINE_CATEGORIES = [
  { keyword: 'restaurant food', label: 'POPULAR' },
  { keyword: 'smash burger fries', label: 'BURGERS' },
  { keyword: 'artisan pizza wood fired', label: 'PIZZA' },
  { keyword: 'birria tacos mexican', label: 'MEXICAN' },
  { keyword: 'sushi sashimi japanese', label: 'SUSHI' },
  { keyword: 'tonkotsu ramen noodles', label: 'RAMEN' },
  { keyword: 'korean fried chicken wings', label: 'KOREAN' },
  { keyword: 'thai pad thai curry', label: 'THAI' },
  { keyword: 'bbq smoked brisket ribs', label: 'BBQ' },
  { keyword: 'pasta italian kitchen', label: 'ITALIAN' },
  { keyword: 'bakery cafe coffee brunch', label: 'CAFE' },
  { keyword: 'mediterranean gyro falafel', label: 'MEDITERRANEAN' },
];

// Strict non-food blacklist (filters out golf clubs, gyms, gas stations, plazas)
const NON_FOOD_KEYWORDS = [
  'golf',
  'country club',
  'mall',
  'shopping center',
  'plaza',
  'athletic club',
  'tennis',
  'fitness',
  'gym',
  'hotel',
  'motel',
  'resort',
  'gas',
  'chevron',
  'shell',
  'car wash',
  'spa',
  'salon',
  'supermarket',
  'grocery',
  'stadium',
];

const NON_FOOD_TYPES = [
  'shopping_mall',
  'golf_course',
  'lodging',
  'gas_station',
  'gym',
  'spa',
  'supermarket',
  'grocery_or_supermarket',
  'convenience_store',
  'car_dealer',
  'park',
  'tourist_attraction',
  'stadium',
];

function isLegitRestaurant(place) {
  const nameLower = (place.name || '').toLowerCase();
  const types = place.types || [];

  for (const word of NON_FOOD_KEYWORDS) {
    if (nameLower.includes(word)) return false;
  }

  for (const badType of NON_FOOD_TYPES) {
    if (types.includes(badType)) return false;
  }

  return (
    types.includes('restaurant') ||
    types.includes('meal_takeaway') ||
    types.includes('cafe') ||
    types.includes('bakery') ||
    types.includes('bar') ||
    types.includes('food')
  );
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cleanRestaurantName(name) {
  return (name || '')
    .replace(/#\d+/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

// Tries a native app URL scheme first (if the app is installed), falling back
// to a normal web URL. Used for cases where a real scheme exists and is worth
// trying (e.g. Google Maps). For DoorDash/Uber Eats see the notes further
// down — there's no verified scheme for a name-based search, so those just
// open the web URL, which iOS/Android already hand off to the installed app
// via Universal Links / App Links.
async function openExternalApp(schemeUrl, webUrl) {
  try {
    if (schemeUrl) {
      const canOpen = await Linking.canOpenURL(schemeUrl);
      if (canOpen) {
        await Linking.openURL(schemeUrl);
        return;
      }
    }
    await Linking.openURL(webUrl);
  } catch (err) {
    console.warn('Could not open external app:', err);
  }
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [foodItems, setFoodItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [noMoreResults, setNoMoreResults] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  // Craved items are stored as full objects (id -> item), not just booleans,
  // so the Saved tab still works after a restart even if a fresh fetch
  // doesn't happen to re-surface that place in foodItems.
  const [cravedMap, setCravedMap] = useState({});
  const [brokenImages, setBrokenImages] = useState({});
  const [activeTab, setActiveTab] = useState('feed'); // 'feed' | 'craved'

  const categoryIndexRef = useRef(0);
  const seenPlaceIdsRef = useRef(new Set());
  const isFetchingRef = useRef(false);
  const emptyBatchStreakRef = useRef(0);
  const isMountedRef = useRef(true);

  const cardHeight = height - insets.bottom - 48;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ─── Load / persist Craved places ───────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CRAVED_STORAGE_KEY);
        if (raw && isMountedRef.current) setCravedMap(JSON.parse(raw));
      } catch (e) {
        console.warn('[DiscoverScreen] Could not load saved places:', e);
      }
    })();
  }, []);

  // ─── Fetch a Multitude of Places Around User ────────────────────────────────
  const fetchPlacesBatch = useCallback(
    async (coords, isReset = false) => {
      if (!coords || isFetchingRef.current) return;
      if (!GOOGLE_PLACES_API_KEY) {
        setLoadError('Missing Google Maps API key. Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to your .env file.');
        setLoading(false);
        return;
      }
      isFetchingRef.current = true;

      if (isReset) {
        setLoading(true);
        setLoadError(null);
        setNoMoreResults(false);
        seenPlaceIdsRef.current.clear();
        categoryIndexRef.current = 0;
        emptyBatchStreakRef.current = 0;
      } else {
        setLoadingMore(true);
      }

      try {
        // On initial reset, fetch 4 categories in parallel for an instant multitude of spots
        const categoriesToFetch = isReset
          ? [CUISINE_CATEGORIES[0], CUISINE_CATEGORIES[1], CUISINE_CATEGORIES[2], CUISINE_CATEGORIES[3]]
          : [
              CUISINE_CATEGORIES[categoryIndexRef.current % CUISINE_CATEGORIES.length],
              CUISINE_CATEGORIES[(categoryIndexRef.current + 1) % CUISINE_CATEGORIES.length],
            ];

        categoryIndexRef.current += isReset ? 4 : 2;

        const promises = categoriesToFetch.map(async (cat) => {
          const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coords.latitude},${coords.longitude}&radius=${SEARCH_RADIUS_METERS}&type=restaurant&keyword=${encodeURIComponent(cat.keyword)}&key=${GOOGLE_PLACES_API_KEY}`;
          const res = await fetch(url);
          const data = await res.json();
          return { data, category: cat.label };
        });

        const results = await Promise.all(promises);
        const newBatch = [];
        let anyOk = false;
        let anyErrorStatus = false;

        for (const { data, category } of results) {
          if (data.status === 'OK') {
            anyOk = true;
          } else if (data.status && data.status !== 'ZERO_RESULTS') {
            anyErrorStatus = true;
            console.warn(
              `[DiscoverScreen] Places API error (${category}): ${data.status}${data.error_message ? ' - ' + data.error_message : ''}`
            );
            continue;
          }

          if (!data.results || data.results.length === 0) continue;

          for (const place of data.results) {
            if (!place.place_id || seenPlaceIdsRef.current.has(place.place_id)) continue;
            if (!isLegitRestaurant(place)) continue;
            if (!place.photos || place.photos.length === 0) continue;

            seenPlaceIdsRef.current.add(place.place_id);

            // Select real photo
            const targetPhoto = place.photos.length > 1 ? place.photos[1] : place.photos[0];
            const realPhotoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${targetPhoto.photo_reference}&key=${GOOGLE_PLACES_API_KEY}`;

            const lat = place.geometry?.location?.lat;
            const lng = place.geometry?.location?.lng;
            const dist = calculateDistanceMiles(coords.latitude, coords.longitude, lat, lng);

            if (dist !== null && dist > 15.0) continue;

            newBatch.push({
              id: place.place_id,
              name: place.name,
              restaurant: place.name,
              address: place.vicinity || place.formatted_address || 'Nearby Spot',
              image: realPhotoUrl,
              rating: place.rating || 4.5,
              reviewsCount: place.user_ratings_total || 0,
              distance: dist ? `${dist.toFixed(1)} mi away` : 'Nearby',
              cuisine: category,
              priceLevel: place.price_level ? '$'.repeat(place.price_level) : '$$',
              isOpen: place.opening_hours?.open_now,
              lat,
              lng,
            });
          }
        }

        if (!isMountedRef.current) return;

        // Nothing came back OK at all on a fresh load - surface it instead of
        // leaving the user staring at an empty screen with no explanation.
        if (isReset && !anyOk && anyErrorStatus) {
          setLoadError('Could not load restaurants nearby. Check your connection and try again.');
        }

        // Stop hammering the API once swiping stops turning up new places -
        // this is a paid endpoint, don't burn quota on empty cycles.
        if (newBatch.length < 2) {
          emptyBatchStreakRef.current += 1;
          if (emptyBatchStreakRef.current >= 3) setNoMoreResults(true);
        } else {
          emptyBatchStreakRef.current = 0;
        }

        // Shuffle so user gets a vibrant mix of burgers, tacos, sushi, etc.
        const shuffled = newBatch.sort(() => Math.random() - 0.5);
        setFoodItems((prev) => (isReset ? shuffled : [...prev, ...shuffled]));
      } catch (e) {
        console.warn('[DiscoverScreen] Error fetching places:', e);
        if (isReset && isMountedRef.current) {
          setLoadError('Could not load restaurants nearby. Check your connection and try again.');
        }
      } finally {
        isFetchingRef.current = false;
        if (isMountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  // ─── GPS Location Acquisition ────────────────────────────────────────────────
  const getLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied, using default coordinates.');
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (loc?.coords && isMountedRef.current) {
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserLocation(coords);
        fetchPlacesBatch(coords, true);
        return;
      }
    } catch (err) {
      console.warn('Location lookup error:', err);
    }

    if (!isMountedRef.current) return;
    const fallback = { latitude: 37.7749, longitude: -122.4194 };
    setUserLocation(fallback);
    fetchPlacesBatch(fallback, true);
  }, [fetchPlacesBatch]);

  useEffect(() => {
    getLocation();
  }, [getLocation]);

  const onRefresh = () => {
    setRefreshing(true);
    setNoMoreResults(false);
    setLoadError(null);
    if (userLocation) fetchPlacesBatch(userLocation, true);
    else getLocation();
  };

  // item is the full place object (needed so Craved can persist independent
  // of whatever happens to be in foodItems this session)
  const handleToggleLike = (item) => {
    Vibration.vibrate(25);
    setCravedMap((prev) => {
      const next = { ...prev };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = item;
      }
      AsyncStorage.setItem(CRAVED_STORAGE_KEY, JSON.stringify(next)).catch((e) =>
        console.warn('[DiscoverScreen] Could not persist saved places:', e)
      );
      return next;
    });
  };

// ─── External URL Actions ───────────────────────────────────────────────────

// Google Profile
// Opens Google Search for the exact restaurant instead of intentionally
// launching Google Maps. The name + address makes the result specific.
const handleOpenGoogleProfile = (item) => {
  Vibration.vibrate(15);

  const query = encodeURIComponent(`${item.name}, ${item.address}`);
  const url = `https://www.google.com/search?q=${query}`;

  Linking.openURL(url).catch((err) =>
    console.warn('Could not open Google Profile:', err)
  );
};

// DoorDash
// Until we have a real DoorDash restaurant/store URL, use the restaurant
// name + address so DoorDash gets a much more precise search.
const handleOpenDoorDash = (item) => {
  Vibration.vibrate(15);

  const cleaned = cleanRestaurantName(item.name);
  const url = `https://www.doordash.com/search/store/${encodeURIComponent(cleaned)}/`;

  Linking.openURL(url).catch((err) =>
    console.warn('Could not open DoorDash:', err)
  );
};

// Uber Eats
// Until we have a real Uber Eats restaurant URL/ID, search using the
// restaurant name + address rather than just the restaurant name.
const handleOpenUberEats = (item) => {
  Vibration.vibrate(15);

  const query = encodeURIComponent(`${item.name}, ${item.address}`);
  const url = `https://www.ubereats.com/search?q=${query}`;

  Linking.openURL(url).catch((err) =>
    console.warn('Could not open Uber Eats:', err)
  );
};

// Directions
// This is intentionally the ONLY Google action that launches Google Maps.
// Uses the exact Google Place ID + coordinates for the destination.
const handleGetDirections = (item) => {
  Vibration.vibrate(15);

  if (item.lat == null || item.lng == null) return;

  const webUrl =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${item.lat},${item.lng}` +
    `&destination_place_id=${encodeURIComponent(item.id)}`;

  if (Platform.OS === 'ios') {
    const iosScheme =
      `comgooglemaps://?daddr=${item.lat},${item.lng}` +
      `&q=${encodeURIComponent(item.name)}`;

    openExternalApp(iosScheme, webUrl);
  } else {
    Linking.openURL(webUrl).catch((err) =>
      console.warn('Could not open directions:', err)
    );
  }
};

  const cravedItems = Object.values(cravedMap);

  // ─── Card Renderer ───────────────────────────────────────────────────────────
  const renderFoodCard = ({ item }) => {
    const isLiked = !!cravedMap[item.id];
    const displayCount = item.reviewsCount + (isLiked ? 1 : 0);

    return (
      <View style={[styles.card, { width, height: cardHeight }]}>
        {/* Real Live Google Place Photo, with a graceful fallback if the
            photo reference 404s (common if the API key's app restrictions
            end up blocking the Photo endpoint) */}
        {brokenImages[item.id] ? (
          <View style={[styles.dishImage, styles.imageFallback]}>
            <Ionicons name="restaurant-outline" size={48} color="#3A3A3C" />
          </View>
        ) : (
          <Image
            source={{ uri: item.image }}
            style={styles.dishImage}
            resizeMode="cover"
            onError={() => setBrokenImages((prev) => ({ ...prev, [item.id]: true }))}
          />
        )}

        {/* Ambient Gradients */}
        <LinearGradient colors={['rgba(0,0,0,0.65)', 'transparent']} style={styles.topGradient} />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.96)']}
          style={styles.bottomGradient}
        />

        {/* Right Floating Actions */}
        <View style={styles.rightActions}>
          {/* Like / Crave Button */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleToggleLike(item)}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconBg, isLiked && styles.actionIconBgLiked]}>
              <Ionicons
                name={isLiked ? 'heart' : 'heart-outline'}
                size={26}
                color={isLiked ? '#FF2E55' : '#FFF'}
              />
            </View>
            <Text style={[styles.actionCountText, isLiked && { color: '#FF2E55' }]}>
              {formatNumber(displayCount)}
            </Text>
            <Text style={styles.actionSubLabel}>{isLiked ? 'Saved' : 'Saves'}</Text>
          </TouchableOpacity>

          {/* Action: Google Profile */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleOpenGoogleProfile(item)}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconBg, { backgroundColor: 'rgba(66, 133, 244, 0.85)' }]}>
              <Ionicons name="storefront-outline" size={22} color="#FFF" />
            </View>
            <Text style={styles.actionLabel}>Profile</Text>
          </TouchableOpacity>

          {/* Action: Directions */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleGetDirections(item)}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconBg, { backgroundColor: 'rgba(52, 199, 89, 0.85)' }]}>
              <Ionicons name="navigate" size={20} color="#FFF" />
            </View>
            <Text style={styles.actionLabel}>Directions</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom Details & Direct Ordering Buttons */}
        <View style={styles.bottomContent}>
          {/* Profile Badges */}
          <View style={styles.tagsRow}>
            <View style={styles.tagBadge}>
              <Text style={styles.tagText}>{item.distance}</Text>
            </View>
            <View style={styles.tagBadge}>
              <Text style={styles.tagText}>{item.priceLevel}</Text>
            </View>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={12} color="#FFB800" />
              <Text style={styles.ratingText}>
                {item.rating} ({formatNumber(item.reviewsCount)})
              </Text>
            </View>
            {item.isOpen !== undefined && (
              <View
                style={[
                  styles.tagBadge,
                  { backgroundColor: item.isOpen ? 'rgba(52, 199, 89, 0.25)' : 'rgba(255, 59, 48, 0.25)' },
                ]}
              >
                <Text style={[styles.tagText, { color: item.isOpen ? '#34C759' : '#FF3B30' }]}>
                  {item.isOpen ? 'Open Now' : 'Closed'}
                </Text>
              </View>
            )}
          </View>

          {/* Restaurant Title (Tap opens Google Profile) */}
          <TouchableOpacity onPress={() => handleOpenGoogleProfile(item)} activeOpacity={0.8}>
            <Text style={styles.dishName} numberOfLines={2}>
              {item.name}
            </Text>
          </TouchableOpacity>

          {/* Address & Cuisine */}
          <Text style={styles.restaurantAddress} numberOfLines={1}>
            {item.address} · {item.cuisine}
          </Text>

          {/* 3 Dedicated Action Buttons */}
          <View style={styles.buttonRow}>
            {/* Action 1: Google Profile */}
            <TouchableOpacity
              style={[styles.btn, styles.googleBtn]}
              onPress={() => handleOpenGoogleProfile(item)}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-google" size={14} color="#FFF" />
              <Text style={styles.btnText}>Google Profile</Text>
            </TouchableOpacity>

            {/* Action 2: DoorDash */}
            <TouchableOpacity
              style={[styles.btn, styles.doorDashBtn]}
              onPress={() => handleOpenDoorDash(item)}
              activeOpacity={0.85}
            >
              <Ionicons name="bag-handle" size={14} color="#FFF" />
              <Text style={styles.btnText}>DoorDash</Text>
            </TouchableOpacity>

            {/* Action 3: Uber Eats */}
            <TouchableOpacity
              style={[styles.btn, styles.uberEatsBtn]}
              onPress={() => handleOpenUberEats(item)}
              activeOpacity={0.85}
            >
              <Ionicons name="flash" size={13} color="#FFF" />
              <Text style={styles.btnText}>Uber Eats</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#FB7238" />
        <Text style={styles.loadingText}>Discovering a multitude of places around you...</Text>
      </SafeAreaView>
    );
  }

  if (loadError && foodItems.length === 0) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <Ionicons name="cloud-offline-outline" size={40} color="#8E8E93" />
        <Text style={styles.loadingText}>{loadError}</Text>
        <TouchableOpacity
          style={styles.explorePill}
          onPress={() => (userLocation ? fetchPlacesBatch(userLocation, true) : getLocation())}
        >
          <Text style={styles.explorePillText}>Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Top Navigation Bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brandIcon}>
          <Ionicons name="restaurant" size={18} color="#FFF" />
        </View>

        <View style={styles.modeSwitchWrapper}>
          <TouchableOpacity
            style={[styles.modePill, activeTab === 'feed' && styles.modePillActive]}
            onPress={() => setActiveTab('feed')}
          >
            <Text style={[styles.modePillText, activeTab === 'feed' && styles.modePillTextActive]}>
              Discover ({foodItems.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modePill, activeTab === 'craved' && styles.modePillActiveCraved]}
            onPress={() => setActiveTab('craved')}
          >
            <Ionicons
              name={activeTab === 'craved' ? 'heart' : 'heart-outline'}
              size={13}
              color={activeTab === 'craved' ? '#FF2E55' : '#8E8E93'}
            />
            <Text style={[styles.modePillText, activeTab === 'craved' && styles.modePillTextActive]}>
              Saved ({cravedItems.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Endless Swiper */}
      {activeTab === 'craved' ? (
        cravedItems.length === 0 ? (
          <SafeAreaView style={styles.emptyContainer}>
            <View style={styles.emptyHeartBg}>
              <Ionicons name="heart" size={40} color="#FF2E55" />
            </View>
            <Text style={styles.emptyTitle}>No Saved Places Yet</Text>
            <Text style={styles.emptySub}>
              Tap the heart on any spot in the feed to save it to your collection!
            </Text>
            <TouchableOpacity style={styles.explorePill} onPress={() => setActiveTab('feed')}>
              <Text style={styles.explorePillText}>Explore Places</Text>
            </TouchableOpacity>
          </SafeAreaView>
        ) : (
          <FlatList
            // Distinct key from the feed FlatList below - without this, RN
            // reuses the same list instance when switching tabs and throws
            // ("Changing numColumns on the fly is not supported"). This is
            // the actual crash fix.
            key="craved-grid"
            data={cravedItems}
            keyExtractor={(item) => `crave-${item.id}`}
            numColumns={2}
            contentContainerStyle={[styles.gridContainer, { paddingTop: insets.top + 60 }]}
            columnWrapperStyle={{ gap: 12 }}
            renderItem={({ item }) => (
              <View style={styles.gridCard}>
                {brokenImages[item.id] ? (
                  <View style={[styles.gridImage, styles.imageFallback]}>
                    <Ionicons name="restaurant-outline" size={32} color="#3A3A3C" />
                  </View>
                ) : (
                  <Image
                    source={{ uri: item.image }}
                    style={styles.gridImage}
                    onError={() => setBrokenImages((prev) => ({ ...prev, [item.id]: true }))}
                  />
                )}
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)']} style={styles.gridGradient} />
                <TouchableOpacity style={styles.gridHeart} onPress={() => handleToggleLike(item)}>
                  <Ionicons name="heart" size={18} color="#FF2E55" />
                </TouchableOpacity>
                <View style={styles.gridOverlay}>
                  <Text style={styles.gridDish} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.gridRestaurant} numberOfLines={1}>
                    {item.distance} · {item.cuisine}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                    <TouchableOpacity
                      style={styles.gridSmallBtn}
                      onPress={() => handleOpenDoorDash(item)}
                    >
                      <Text style={styles.gridBtnText}>DoorDash</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.gridSmallBtn}
                      onPress={() => handleOpenGoogleProfile(item)}
                    >
                      <Text style={styles.gridBtnText}>Profile</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />
        )
      ) : foodItems.length === 0 ? (
        <SafeAreaView style={styles.emptyContainer}>
          <View style={styles.emptyHeartBg}>
            <Ionicons name="restaurant-outline" size={40} color="#FB7238" />
          </View>
          <Text style={styles.emptyTitle}>Nothing Nearby</Text>
          <Text style={styles.emptySub}>
            Couldn't find restaurants in your area. Try refreshing.
          </Text>
          <TouchableOpacity
            style={styles.explorePill}
            onPress={() => userLocation && fetchPlacesBatch(userLocation, true)}
          >
            <Text style={styles.explorePillText}>Refresh</Text>
          </TouchableOpacity>
        </SafeAreaView>
      ) : (
        <FlatList
          // Distinct key from the craved grid FlatList above - see note there.
          key="feed-swiper"
          data={foodItems}
          keyExtractor={(item) => item.id}
          renderItem={renderFoodCard}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={width}
          decelerationRate="fast"
          // Automatically loads more batches of places as you swipe near the end
          onEndReached={() => {
            if (!loadingMore && userLocation && !noMoreResults) {
              fetchPlacesBatch(userLocation, false);
            }
          }}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FB7238" />}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          ListFooterComponent={
            loadingMore ? (
              <View style={[styles.loadingMoreBox, { width: 100, height: cardHeight }]}>
                <ActivityIndicator size="small" color="#FB7238" />
              </View>
            ) : noMoreResults ? (
              <View style={[styles.loadingMoreBox, { width: 240, height: cardHeight, paddingHorizontal: 24 }]}>
                <Ionicons name="checkmark-circle-outline" size={28} color="#8E8E93" />
                <Text style={styles.loadingMoreText}>You've seen every spot nearby. Pull down to refresh.</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  loadingContainer: { flex: 1, backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  loadingText: { color: '#8E8E93', fontSize: 13, marginTop: 12, fontWeight: '600', textAlign: 'center' },
  loadingMoreText: { color: '#8E8E93', fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 10 },
  imageFallback: { backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 0,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FB7238',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSwitchWrapper: {
    flexDirection: 'row',
    backgroundColor: 'rgba(20, 20, 20, 0.88)',
    padding: 3,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 3,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 22,
  },
  modePillActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  modePillActiveCraved: {
    backgroundColor: 'rgba(255, 46, 85, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 46, 85, 0.4)',
  },
  modePillText: { color: '#8E8E93', fontSize: 12, fontWeight: '700' },
  modePillTextActive: { color: '#FFF' },
  card: { position: 'relative', overflow: 'hidden' },
  dishImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  topGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  bottomGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 340 },
  rightActions: {
    position: 'absolute',
    right: 16,
    bottom: 180,
    gap: 14,
    alignItems: 'center',
    zIndex: 10,
  },
  actionBtn: { alignItems: 'center' },
  actionIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBgLiked: { backgroundColor: 'rgba(255,46,85,0.3)', borderColor: '#FF2E55' },
  actionCountText: { color: '#FFF', fontSize: 12, fontWeight: '900', marginTop: 3 },
  actionSubLabel: { color: '#AAA', fontSize: 9, fontWeight: '600' },
  actionLabel: { color: '#FFF', fontSize: 10, fontWeight: '700', marginTop: 3 },
  bottomContent: { position: 'absolute', bottom: 20, left: 16, right: 16 },
  tagsRow: { flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' },
  tagBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,184,0,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  ratingText: { color: '#FFB800', fontSize: 11, fontWeight: '800' },
  dishName: { color: '#FFF', fontSize: 24, fontWeight: '900', marginBottom: 4 },
  restaurantAddress: { color: '#CCC', fontSize: 12, marginBottom: 14 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    borderRadius: 12,
  },
  googleBtn: {
    backgroundColor: 'rgba(66, 133, 244, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  doorDashBtn: { backgroundColor: '#FF3008' },
  uberEatsBtn: { backgroundColor: '#06C167' },
  btnText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  loadingMoreBox: { alignItems: 'center', justifyContent: 'center' },
  gridContainer: { paddingHorizontal: 16, paddingBottom: 32 },
  gridCard: {
    flex: 1,
    height: 230,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
    marginBottom: 12,
    position: 'relative',
  },
  gridImage: { width: '100%', height: '100%' },
  gridGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  gridHeart: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridOverlay: { position: 'absolute', bottom: 10, left: 10, right: 10 },
  gridDish: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  gridRestaurant: { color: '#CCC', fontSize: 11, marginTop: 2 },
  gridSmallBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
  },
  gridBtnText: { color: '#FFF', fontSize: 9, fontWeight: '700' },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyHeartBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 46, 85, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 22, color: '#FFF', fontWeight: '700' },
  emptySub: { color: '#8E8E93', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  explorePill: {
    backgroundColor: '#FB7238',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 20,
  },
  explorePillText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
});

/*
─── API KEY SETUP ──────────────────────────────────────────────────────────

1. Rotate your key. The one that was in this file is exposed now - go to
   Google Cloud Console → APIs & Services → Credentials and regenerate it,
   or delete it and create a fresh one.

2. Never hardcode a fallback value in source. Create a `.env` file at your
   project root (same level as package.json):

     EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_new_key_here

   Add `.env` to .gitignore before you commit anything.

3. Restrict the key in Google Cloud Console, under "Application restrictions":
   - Android: restrict by package name + SHA-1 signing certificate fingerprint
   - iOS: restrict by bundle identifier
   Do NOT use "HTTP referrers" restriction - that's for websites, and it'll
   just silently break every request from the app.
   Under "API restrictions", limit the key to only Places API (+ Places
   Photos), not "don't restrict".

4. Set a daily quota / billing alert on the key in Cloud Console. Nearby
   Search + Photo calls add up fast, especially now that pagination stops
   itself (see noMoreResults below) but every swipe still costs money.

5. Best real fix, when you have time: don't ship this key in the app at all.
   Proxy Places requests through a tiny backend endpoint you control, so the
   key never leaves your server. A restricted client-side key still gets
   pulled out of app binaries by anyone determined enough.

─── WHAT ELSE CHANGED ──────────────────────────────────────────────────────

- Crashed Craved tab: fixed via the `key="feed-swiper"` / `key="craved-grid"`
  props on the two FlatLists. RN throws when it reuses one FlatList instance
  across incompatible configs (horizontal <-> numColumns) - that was the bug.
- Saved places now persist across app restarts (AsyncStorage) and store the
  full place object, not just an id -> boolean, so they survive even if a
  fresh fetch doesn't happen to include that place again.
- Added a real error screen for failed loads instead of an infinite spinner
  or silently-empty feed.
- Added an empty state for the Discover feed itself (previously only Craved
  had one).
- Stops auto-paginating once 3 batches in a row return basically nothing new,
  instead of burning API calls forever once you've seen everything nearby.
- Guards all setState calls with a mounted check so it doesn't warn/crash if
  a request resolves after the screen unmounts.
- Broken/expired photo URLs now fall back to a placeholder icon instead of
  a broken image.
- Added a Directions button that tries Google Maps' native iOS scheme first,
  falling back to the web URL (Android's web URL already opens the app
  directly, no scheme needed there).

You'll need to install AsyncStorage if it's not already in the project:
  npx expo install @react-native-async-storage/async-storage

FEATURE IDEAS I DIDN'T BUILD (didn't want to guess at scope you don't want):
- Cuisine filter chips / "Open Now only" toggle
- Swipe-to-undo when removing a Craved item, with a toast
- Skeleton loading cards instead of a single spinner
- expo-image instead of RN's Image, for caching + faster reloads
- A real backend proxy for the Places calls (see point 5 above) - this is
  the one I'd actually prioritize before you ship, everything else is polish
*/
