import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { TAG_META } from '../lib/postUtils';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', white: '#ffffff', gray1: '#888888', gray2: '#666666',
};

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

const MS_PER_SEGMENT = 550;

export default function DayTrailDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  // [{tag, kind: 'mapped'|'home', lat, lng, placeName, mealName, photoUrl}],
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

  if (locations.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={C.white} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Day Trail</Text>
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
        <Text style={styles.navTitle}>Day Trail</Text>
        {hasMap ? (
          <TouchableOpacity onPress={replay} hitSlop={12}>
            <Ionicons name="refresh" size={20} color={C.orange} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      {hasMap ? (
        <View style={styles.mapWrap}>
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
        <View style={styles.noMapBox}>
          <Ionicons name="home" size={40} color={C.orange} />
          <Text style={styles.noMapText}>This day was spent at home</Text>
        </View>
      )}

      <View style={styles.legend}>
        {locations.map(loc => (
          <View key={loc.tag} style={styles.legendRow}>
            <View style={[styles.legendIconWrap, loc.kind === 'home' && styles.legendIconWrapHome]}>
              <Text style={styles.legendEmoji}>{loc.kind === 'home' ? '🏠' : (TAG_META[loc.tag]?.emoji ?? '📍')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.legendName} numberOfLines={1}>{loc.mealName}</Text>
              {loc.placeName ? <Text style={styles.legendPlace} numberOfLines={1}>{loc.placeName}</Text> : null}
            </View>
          </View>
        ))}
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

  mapWrap: { flex: 1 },
  pin: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.orange,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  pinPhoto: { width: '100%', height: '100%' },
  pinEmoji: { fontSize: 14 },

  noMapBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  noMapText: { fontSize: 14, color: C.gray1 },

  legend: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, gap: 10,
    borderTopWidth: 0.5, borderTopColor: C.border,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendIconWrap: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
  legendIconWrapHome: { borderWidth: 1, borderColor: C.orange },
  legendEmoji: { fontSize: 16 },
  legendName: { fontSize: 14, fontWeight: '600', color: C.white },
  legendPlace: { fontSize: 12, color: C.gray2, marginTop: 1 },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: C.gray1 },
});
