import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Dimensions,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { THEME as C } from '../lib/theme';
import Avatar from '../components/Avatar';

// ─── Distance Calculation Helper (Haversine Formula) ──────────────────────────

function getDistanceInMiles(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 3958.8; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(miles) {
  if (miles == null) return null;
  if (miles < 0.1) return 'Right here';
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}

export default function DiscoverScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locationPermissionStatus, setLocationPermissionStatus] = useState(null);
  const locationRequestedRef = useRef(false);

  // Tab bar height estimate for full screen card height calculation
  const cardHeight = height - insets.top - insets.bottom - 60;

  // ─── Fetch Meals ────────────────────────────────────────────────────────────

  const fetchMeals = useCallback(async (currentLoc = userLocation) => {
    try {
      // Query meals that have an image URL
      const { data, error } = await supabase
        .from('meals')
        .select(`
          id,
          name,
          score,
          rating,
          photo_url,
          tag,
          notes,
          created_at,
          user_id,
          place_id,
          places(id, name, address, lat, lng)
        `)
        .not('photo_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      if (!data || data.length === 0) {
        setMeals([]);
        return;
      }

      // Fetch user profile info for the meal loggers
      const userIds = [...new Set(data.map(m => m.user_id).filter(Boolean))];
      let profilesMap = {};

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', userIds);

        (profiles || []).forEach(p => {
          profilesMap[p.id] = p;
        });
      }

      // Format meals with attached user profiles and computed distances
      const formatted = data.map(meal => {
        const place = meal.places || {};
        const profile = profilesMap[meal.user_id] || null;
        let dist = null;

        if (currentLoc && place.lat != null && place.lng != null) {
          dist = getDistanceInMiles(
            currentLoc.latitude,
            currentLoc.longitude,
            place.lat,
            place.lng
          );
        }

        return {
          ...meal,
          place,
          profile,
          distanceMiles: dist,
        };
      });

      // If user location is available, sort by distance ascending
      if (currentLoc) {
        formatted.sort((a, b) => {
          if (a.distanceMiles != null && b.distanceMiles != null) {
            return a.distanceMiles - b.distanceMiles;
          }
          if (a.distanceMiles != null) return -1;
          if (b.distanceMiles != null) return 1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
      }

      setMeals(formatted);
    } catch (err) {
      console.error('[DiscoverScreen] Error fetching meals:', err.message || err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userLocation]);

  // ─── Location Handling ──────────────────────────────────────────────────────

  const requestLocation = useCallback(async () => {
    if (locationRequestedRef.current) return;
    locationRequestedRef.current = true;

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermissionStatus(status);

      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (loc?.coords) {
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setUserLocation(coords);

          // Re-sort current meals by location immediately
          setMeals(prev => {
            if (!prev || prev.length === 0) return prev;
            const updated = prev.map(m => {
              const place = m.place || {};
              const dist =
                place.lat != null && place.lng != null
                  ? getDistanceInMiles(
                      coords.latitude,
                      coords.longitude,
                      place.lat,
                      place.lng
                    )
                  : null;
              return { ...m, distanceMiles: dist };
            });

            return updated.sort((a, b) => {
              if (a.distanceMiles != null && b.distanceMiles != null) {
                return a.distanceMiles - b.distanceMiles;
              }
              if (a.distanceMiles != null) return -1;
              if (b.distanceMiles != null) return 1;
              return new Date(b.created_at) - new Date(a.created_at);
            });
          });
        }
      }
    } catch (err) {
      console.warn('[DiscoverScreen] Location request error:', err.message || err);
    }
  }, []);

  // Initial load
  useFocusEffect(
    useCallback(() => {
      fetchMeals();
      requestLocation();
    }, [fetchMeals, requestLocation])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchMeals();
  };

  // ─── Card Renderer ──────────────────────────────────────────────────────────

  const renderCard = ({ item }) => {
    const restaurantName = item.place?.name || 'Restaurant Spot';
    const restaurantAddress = item.place?.address || null;
    const distanceText = formatDistance(item.distanceMiles);
    const scoreVal = item.score ? item.score.toFixed(1) : null;
    const username = item.profile?.username || 'foodie';
    const avatarUrl = item.profile?.avatar_url || null;

    return (
      <View style={[styles.cardContainer, { height: cardHeight, width }]}>
        {/* Main Food Photo */}
        <Image
          source={{ uri: item.photo_url }}
          style={styles.cardImage}
          resizeMode="cover"
        />

        {/* Dark Top & Bottom Gradients for Contrast */}
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'transparent']}
          style={styles.topGradient}
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.95)']}
          style={styles.bottomGradient}
        />

        {/* Top Header Overlay */}
        <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerLeft}>
            <Ionicons name="compass" size={22} color={C.orange} />
            <Text style={styles.headerTitle}>Discover</Text>
          </View>

          {distanceText && (
            <View style={styles.distanceBadge}>
              <Ionicons name="navigate-outline" size={12} color={C.white} />
              <Text style={styles.distanceText}>{distanceText}</Text>
            </View>
          )}
        </View>

        {/* Bottom Information Overlay */}
        <View style={styles.bottomOverlay}>
          {/* User Logged By */}
          <TouchableOpacity
            style={styles.userRow}
            onPress={() => {
              if (item.user_id) {
                navigation.navigate('UserProfile', { username });
              }
            }}
            activeOpacity={0.8}
          >
            <Avatar url={avatarUrl} size={32} />
            <Text style={styles.usernameText}>@{username}</Text>
          </TouchableOpacity>

          {/* Meal Title & Score */}
          <View style={styles.mealTitleRow}>
            <Text style={styles.mealName} numberOfLines={2}>
              {item.name}
            </Text>

            {scoreVal && (
              <View style={styles.scorePill}>
                <Ionicons name="star" size={13} color={C.gold} />
                <Text style={styles.scoreText}>{scoreVal}</Text>
              </View>
            )}
          </View>

          {/* Restaurant Name & Address */}
          <TouchableOpacity
            style={styles.locationRow}
            onPress={() => {
              if (item.place_id) {
                navigation.navigate('MealDetail', { mealId: item.id });
              }
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="location-sharp" size={16} color={C.orange} />
            <View style={styles.locationTextWrapper}>
              <Text style={styles.restaurantName} numberOfLines={1}>
                {restaurantName}
              </Text>
              {restaurantAddress && (
                <Text style={styles.restaurantAddress} numberOfLines={1}>
                  {restaurantAddress}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── Render Screen ──────────────────────────────────────────────────────────

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={C.orange} />
        <Text style={styles.loadingText}>Discovering great food spots...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {meals.length === 0 ? (
        <SafeAreaView style={styles.emptyContainer}>
          <Ionicons name="compass-outline" size={64} color={C.gray2} />
          <Text style={styles.emptyTitle}>No Food Discoveries Yet</Text>
          <Text style={styles.emptySub}>
            Be the first to log a meal with a photo to feature it on Discover!
          </Text>
          <TouchableOpacity
            style={styles.logButton}
            onPress={() => navigation.navigate('LogMeal')}
          >
            <Ionicons name="camera-outline" size={20} color={C.white} />
            <Text style={styles.logButtonText}>Log a Meal</Text>
          </TouchableOpacity>
        </SafeAreaView>
      ) : (
        <FlatList
          data={meals}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={cardHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.orange}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: C.gray1,
    fontSize: 14,
  },
  cardContainer: {
    position: 'relative',
    backgroundColor: C.surface,
    overflow: 'hidden',
  },
  cardImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  topGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 120,
  },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: C.serif,
    fontSize: 26,
    color: C.white,
    letterSpacing: 0.5,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: C.pill,
    borderWidth: 1,
    borderColor: C.glassBorder,
  },
  distanceText: {
    color: C.white,
    fontSize: 12,
    fontWeight: '600',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  usernameText: {
    color: C.white,
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  mealTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  mealName: {
    flex: 1,
    color: C.white,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(25, 25, 25, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: C.pill,
    borderWidth: 1,
    borderColor: C.glassBorder,
  },
  scoreText: {
    color: C.white,
    fontSize: 14,
    fontWeight: '700',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(22, 22, 22, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.glassBorder,
    marginTop: 4,
  },
  locationTextWrapper: {
    flex: 1,
  },
  restaurantName: {
    color: C.white,
    fontSize: 15,
    fontWeight: '700',
  },
  restaurantAddress: {
    color: C.gray1,
    fontSize: 12,
    marginTop: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontFamily: C.serif,
    fontSize: 24,
    color: C.white,
    marginTop: 16,
    textAlign: 'center',
  },
  emptySub: {
    color: C.gray1,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.orange,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: C.pill,
    marginTop: 24,
  },
  logButtonText: {
    color: C.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
