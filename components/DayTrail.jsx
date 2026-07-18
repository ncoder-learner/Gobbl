import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { TAG_META } from '../lib/postUtils';
import { isHomeMeal, mappableCoords, displayPlaceName } from '../lib/homePrivacy';
import { THEME as C } from '../lib/theme';

// Small non-interactive map thumbnail showing where a day's logged meals
// were eaten. Renders for 1+ located stops; a connecting line (breakfast →
// lunch → dinner order) only appears once there are 2+ *mapped* stops.
// Shared by FeedScreen's post cards and MealDetailScreen so both surfaces
// render the identical trail instead of diverging plain-map implementations.
//
// `isOwner` drives home-meal privacy (lib/homePrivacy.js): a non-owner never
// gets a coordinate for a home meal, not even a fuzzed one — the map only
// ever plots stops it has real coordinates for. A home stop instead renders
// as a fixed house-icon node in the sequence strip below the map, in its
// correct breakfast/lunch/dinner order, with no coordinate behind it at all.
export default function DayTrail({ images, isOwner }) {
  const navigation = useNavigation();

  const stops = images
    .map(({ tag, meal }) => {
      if (!meal.place_id) return null;
      const coord = mappableCoords(meal, { isOwner });
      if (coord) return { tag, meal, kind: 'mapped', coord, placeName: displayPlaceName(meal) };
      if (isHomeMeal(meal)) return { tag, meal, kind: 'home', coord: null, placeName: 'Home' };
      return null;
    })
    .filter(Boolean);
  if (stops.length === 0) return null;

  const mapped = stops.filter(s => s.kind === 'mapped');
  const hasMap = mapped.length > 0;
  const mapCoords = mapped.map(s => ({ latitude: s.coord.lat, longitude: s.coord.lng }));

  let region = null;
  if (hasMap) {
    const lats = mapCoords.map(c => c.latitude);
    const lngs = mapCoords.map(c => c.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    region = {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(maxLat - minLat, 0.01) * 1.8,
      longitudeDelta: Math.max(maxLng - minLng, 0.01) * 1.8,
    };
  }

  function openDetail() {
    navigation.navigate('DayTrailDetail', {
      locations: stops.map(s => ({
        tag: s.tag,
        kind: s.kind,
        lat: s.coord?.lat ?? null,
        lng: s.coord?.lng ?? null,
        placeName: s.placeName,
        mealName: s.meal.name,
        photoUrl: s.meal.photo_url ?? null,
        createdAt: s.meal.created_at ?? null,
      })),
    });
  }

  const label = stops.length >= 2 ? "Today's trail" : stops[0].placeName || 'Location';

  return (
    <TouchableOpacity style={styles.trailWrap} onPress={openDetail} activeOpacity={0.85}>
      {hasMap ? (
        <MapView
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={region}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          pointerEvents="none"
        >
          {mapped.length >= 2 && (
            <Polyline coordinates={mapCoords} strokeColor={C.orange} strokeWidth={2.5} />
          )}
          {mapped.map(({ tag, meal, coord }) => (
            <Marker key={tag} coordinate={{ latitude: coord.lat, longitude: coord.lng }}>
              <View style={styles.trailPin}>
                {meal.photo_url ? (
                  <Image source={{ uri: meal.photo_url }} style={styles.trailPinPhoto} />
                ) : (
                  <Text style={styles.trailPinEmoji}>{TAG_META[tag].emoji}</Text>
                )}
              </View>
            </Marker>
          ))}
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noMapBg]} />
      )}

      {/* Fixed sequence strip — ordinary layout, not map-projected, so a
          home stop's position here carries no coordinate information at
          all. Only rendered when a home stop is actually part of the day. */}
      {stops.some(s => s.kind === 'home') && (
        <View style={styles.sequenceRow}>
          {stops.map((s, i) => (
            <View key={s.tag} style={styles.sequenceItem}>
              {i > 0 && <View style={styles.sequenceConnector} />}
              <View style={[styles.sequenceIcon, s.kind === 'home' && styles.sequenceIconHome]}>
                <Text style={styles.sequenceIconEmoji}>
                  {s.kind === 'home' ? '🏠' : TAG_META[s.tag].emoji}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.trailLabel}>
        <Ionicons name="trail-sign-outline" size={11} color={C.white} />
        <Text style={styles.trailLabelText}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trailWrap: {
    height: 100, borderRadius: 14, overflow: 'hidden', marginTop: 10,
    backgroundColor: '#111', borderWidth: 0.5, borderColor: C.border,
  },
  noMapBg: { backgroundColor: '#161616' },
  trailPin: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.orange,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  trailPinPhoto: { width: '100%', height: '100%' },
  trailPinEmoji: { fontSize: 12 },
  trailLabel: {
    position: 'absolute', left: 8, bottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  trailLabelText: { fontSize: 10, fontWeight: '600', color: C.white },

  // Sequence strip — a plain flex row fixed at the top-right, entirely
  // independent of the map's coordinate system.
  sequenceRow: {
    position: 'absolute', top: 8, right: 8,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14,
    paddingHorizontal: 6, paddingVertical: 4, gap: 0,
  },
  sequenceItem: { flexDirection: 'row', alignItems: 'center' },
  sequenceConnector: { width: 10, height: 1.5, backgroundColor: C.gray2, marginHorizontal: 2 },
  sequenceIcon: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center',
  },
  sequenceIconHome: { borderWidth: 1, borderColor: C.orange },
  sequenceIconEmoji: { fontSize: 10 },
});
