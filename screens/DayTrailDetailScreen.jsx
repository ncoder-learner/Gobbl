import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { TAG_META } from '../lib/postUtils';
import { THEME as C } from '../lib/theme';

const MAP_CARD_HEIGHT = 260;

function regionFromCoords(coords) {
  const lats = coords.map(c => c.latitude);
  const lngs = coords.map(c => c.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(maxLat - minLat, 0.01) * 1.8,
    longitudeDelta: Math.max(maxLng - minLng, 0.01) * 1.8,
  };
}

// Linear interpolation between two points along a straight segment — good
// enough at city scale where great-circle curvature is imperceptible.
function lerpCoord(a, b, t) {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

function formatStopTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const MS_PER_SEGMENT = 550;

export default function DayTrailDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  // [{tag, kind: 'mapped'|'home', lat, lng, placeName, mealName, photoUrl, createdAt}],
  // breakfast→lunch→dinner order. `kind: 'home'` stops carry no lat/lng —
  // see lib/homePrivacy.js — and must never be plotted on the map, only
  // listed below it in sequence.
  const locations = route.params?.locations || [];
  const mapped = locations.filter(l => l.kind === 'mapped');

  // The animated line only ever routes through mapped coordinates. A home
  // stop sitting between two mapped stops (breakfast → home → dinner) simply
  // isn't a vertex in the geographic path — there's nothing to draw it to.
  const coords = mapped.map(l => ({ latitude: l.lat, longitude: l.lng }));
  const segmentCount = Math.max(coords.length - 1, 1);

  const [drawnCoords, setDrawnCoords] = useState(coords.length >= 2 ? [coords[0]] : coords);
  const rafRef = useRef(null);

  function runAnimation() {
    if (coords.length < 2) return;
    const start = Date.now();
    const totalDuration = MS_PER_SEGMENT * segmentCount;

    function tick() {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / totalDuration);
      const posFloat = t * segmentCount;
      const segIndex = Math.min(Math.floor(posFloat), segmentCount - 1);
      const segT = posFloat - segIndex;

      const next = coords.slice(0, segIndex + 1);
      if (segIndex + 1 < coords.length) {
        next.push(lerpCoord(coords[segIndex], coords[segIndex + 1], segT));
      }
      setDrawnCoords(next);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    runAnimation();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function replay() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setDrawnCoords(coords.length >= 2 ? [coords[0]] : coords);
    // Let the reset paint before starting the next frame loop.
    requestAnimationFrame(() => runAnimation());
  }

  const dayLabel = `${new Date().toLocaleDateString([], { weekday: 'long' })}'s Trail`;

  if (locations.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={C.white} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>{dayLabel}</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No located meals to show.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasMap = mapped.length > 0;
  const region = hasMap ? regionFromCoords(coords) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>{dayLabel}</Text>
        {hasMap ? (
          <TouchableOpacity onPress={replay} hitSlop={12}>
            <Ionicons name="refresh" size={20} color={C.orange} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {hasMap ? (
          <View style={styles.mapCard}>
            <MapView
              style={StyleSheet.absoluteFill}
              provider={PROVIDER_GOOGLE}
              initialRegion={region}
            >
              {drawnCoords.length >= 2 && (
                <Polyline coordinates={drawnCoords} strokeColor={C.orange} strokeWidth={3.5} />
              )}
              {mapped.map(loc => (
                <Marker key={loc.tag} coordinate={{ latitude: loc.lat, longitude: loc.lng }} title={loc.mealName} description={loc.placeName}>
                  <View style={styles.pin}>
                    {loc.photoUrl ? (
                      <Image source={{ uri: loc.photoUrl }} style={styles.pinPhoto} />
                    ) : (
                      <Text style={styles.pinEmoji}>{TAG_META[loc.tag]?.emoji ?? '📍'}</Text>
                    )}
                  </View>
                </Marker>
              ))}
            </MapView>
          </View>
        ) : (
          <View style={styles.mapCard}>
            <View style={styles.noMapBox}>
              <Ionicons name="home" size={36} color={C.orange} />
              <Text style={styles.noMapText}>This day was spent at home</Text>
            </View>
          </View>
        )}

        {/* Connected timeline — dot + line per stop, in order */}
        <View style={styles.timeline}>
          {locations.map((loc, i) => {
            const isLast = i === locations.length - 1;
            const dotColor = isLast ? C.orange : C.white;
            return (
              <View key={loc.tag} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, { backgroundColor: dotColor }, isLast && styles.timelineDotActive]} />
                  {!isLast && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineBody}>
                  {formatStopTime(loc.createdAt) ? (
                    <Text style={styles.timelineTime}>{formatStopTime(loc.createdAt)}</Text>
                  ) : null}
                  <Text style={styles.timelinePlace} numberOfLines={1}>
                    {loc.kind === 'home' ? '🏠 Home' : (loc.placeName || TAG_META[loc.tag]?.label || 'Somewhere')}
                  </Text>
                  <Text style={styles.timelineMeal} numberOfLines={1}>{loc.mealName}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 40 },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navTitle: { fontFamily: C.serif, fontSize: 20, color: C.white },

  mapCard: {
    height: MAP_CARD_HEIGHT, marginHorizontal: 20, marginTop: 4,
    borderRadius: 22, overflow: 'hidden', position: 'relative',
    backgroundColor: '#161616',
  },
  pin: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.orange,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  pinPhoto: { width: '100%', height: '100%' },
  pinEmoji: { fontSize: 14 },

  noMapBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  noMapText: { fontSize: 14, color: C.gray1 },

  // Connected timeline
  timeline: { paddingHorizontal: 20, paddingTop: 26 },
  timelineRow: { flexDirection: 'row', gap: 14 },
  timelineRail: { alignItems: 'center', width: 10 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  timelineDotActive: { shadowColor: C.orange, shadowOpacity: 0.6, shadowRadius: 5, elevation: 4 },
  timelineLine: { width: 1, flex: 1, backgroundColor: C.glassBorder, minHeight: 40 },
  timelineBody: { flex: 1, paddingBottom: 24 },
  timelineTime: { fontSize: 12, color: 'rgba(245,245,247,0.4)' },
  timelinePlace: { fontSize: 15, fontWeight: '700', color: C.white, marginTop: 2 },
  timelineMeal: { fontSize: 12, color: 'rgba(245,245,247,0.5)', marginTop: 1 },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: C.gray1 },
});
