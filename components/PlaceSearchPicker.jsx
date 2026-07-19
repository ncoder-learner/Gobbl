import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { THEME as C } from '../lib/theme';

const DEFAULT_MAP_REGION = {
  latitude: 39.5, longitude: -98.35, latitudeDelta: 40, longitudeDelta: 40,
};

// General-purpose place picker — search (places-search edge function, biased
// but not restricted to a 5km radius around userCoords when given) or drop a
// pin anywhere on the map. The pin-drop path has zero distance bias, so it's
// the clean answer for "I want a place far from here": search text specific
// enough to beat the bias, or just drop the pin where you actually mean.
//
// Resolves to {place_id, name, address, lat, lng} — for a searched place this
// is a real Google place_id; for a dropped pin it's a synthetic
// `pin:<lat>:<lng>` id (deterministic per-coordinate, same convention as
// LogMealScreen's `home:<userId>:<lat>:<lng>` for home-tagged meals).
// Callers are responsible for upserting the result into `places` at save
// time (this component only resolves values, it never writes to the DB) —
// same division of responsibility LogMealScreen already uses.
export default function PlaceSearchPicker({ value, onChange, userCoords, placeholder = 'Search for a place', helperText }) {
  const [query, setQuery]           = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching]   = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinRegion, setPinRegion]   = useState(
    userCoords ? { latitude: userCoords.lat, longitude: userCoords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 } : DEFAULT_MAP_REGION
  );
  const [pinCoord, setPinCoord]     = useState(null);
  const [pinResolving, setPinResolving] = useState(false);
  const sessionRef  = useRef(null);
  const debounceRef = useRef(null);

  function handleQueryChange(text) {
    setQuery(text);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim() || text.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => runAutocomplete(text.trim()), 300);
  }

  async function runAutocomplete(q) {
    if (!sessionRef.current) sessionRef.current = Crypto.randomUUID();
    try {
      const body = { query: q, sessionToken: sessionRef.current };
      if (userCoords) { body.lat = userCoords.lat; body.lng = userCoords.lng; }
      const { data, error } = await supabase.functions.invoke('places-search', { body });
      if (error) throw error;
      setSuggestions(data.suggestions ?? []);
    } catch {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectSuggestion(s) {
    setSuggestions([]);
    setQuery('');
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('places-search', {
        body: { placeId: s.place_id, sessionToken: sessionRef.current },
      });
      if (error) throw error;
      onChange(data);
    } catch {
      onChange({ place_id: s.place_id, name: s.main_text, address: s.secondary_text ?? null, lat: null, lng: null });
    } finally {
      sessionRef.current = null;
      setSearching(false);
    }
  }

  async function openPinModal() {
    setPinCoord(null);
    setPinModalVisible(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      if (!userCoords) {
        const pos = await Location.getCurrentPositionAsync({});
        setPinRegion({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      }
    } catch {
      // non-fatal — keep default/current region
    }
  }

  async function confirmPin() {
    const coord = pinCoord || { latitude: pinRegion.latitude, longitude: pinRegion.longitude };
    setPinResolving(true);
    try {
      let name = 'Dropped pin';
      let address = null;
      try {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: coord.latitude, longitude: coord.longitude,
        });
        if (place) {
          name = place.name || place.street || name;
          address = [place.street, place.city, place.region].filter(Boolean).join(', ') || null;
        }
      } catch {
        // fall back to generic label
      }
      const placeId = `pin:${coord.latitude.toFixed(6)}:${coord.longitude.toFixed(6)}`;
      onChange({ place_id: placeId, name, address, lat: coord.latitude, lng: coord.longitude });
      setPinModalVisible(false);
    } finally {
      setPinResolving(false);
    }
  }

  if (value) {
    return (
      <View style={styles.wrap}>
        {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
        <View style={styles.placeChip}>
          <Ionicons name="location" size={16} color={C.orange} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.placeChipName} numberOfLines={1}>{value.name}</Text>
            {value.address ? (
              <Text style={styles.placeChipAddr} numberOfLines={1}>{value.address}</Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={12}>
            <Ionicons name="close-circle" size={20} color={C.gray4} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      <View style={styles.inputRow}>
        <Ionicons name="search" size={16} color={C.gray4} style={{ marginLeft: 12 }} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleQueryChange}
          placeholder={placeholder}
          placeholderTextColor={C.gray4}
          autoCorrect={false}
        />
        {searching && <ActivityIndicator size="small" color={C.gray2} style={{ marginRight: 12 }} />}
      </View>
      {suggestions.length > 0 && (
        <View style={styles.suggestionsList}>
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={s.place_id}
              style={[styles.suggestionRow, i > 0 && styles.suggestionDivider]}
              onPress={() => handleSelectSuggestion(s)}
              activeOpacity={0.7}
            >
              <Ionicons name="location-outline" size={14} color={C.gray2} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestionMain} numberOfLines={1}>{s.main_text}</Text>
                {s.secondary_text ? (
                  <Text style={styles.suggestionSub} numberOfLines={1}>{s.secondary_text}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TouchableOpacity style={styles.pinDropBtn} onPress={openPinModal} activeOpacity={0.75}>
        <Ionicons name="pin-outline" size={14} color={C.orange} />
        <Text style={styles.pinDropBtnText}>Or drop a pin anywhere on the map</Text>
      </TouchableOpacity>

      <Modal visible={pinModalVisible} animationType="slide" onRequestClose={() => setPinModalVisible(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.navBar}>
            <TouchableOpacity onPress={() => setPinModalVisible(false)} hitSlop={12}>
              <Text style={{ color: C.gray1, fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.navTitle}>Drop a pin</Text>
            <View style={{ width: 50 }} />
          </View>
          <View style={{ flex: 1 }}>
            <MapView
              style={StyleSheet.absoluteFill}
              provider={PROVIDER_GOOGLE}
              initialRegion={pinRegion}
              onRegionChangeComplete={setPinRegion}
              onPress={(e) => setPinCoord(e.nativeEvent.coordinate)}
            >
              <Marker
                coordinate={pinCoord || { latitude: pinRegion.latitude, longitude: pinRegion.longitude }}
                draggable
                onDragEnd={(e) => setPinCoord(e.nativeEvent.coordinate)}
              />
            </MapView>
          </View>
          <View style={{ padding: 20 }}>
            <TouchableOpacity
              style={[styles.saveBtn, pinResolving && styles.btnDisabled]}
              onPress={confirmPin}
              disabled={pinResolving}
              activeOpacity={0.85}
            >
              {pinResolving ? (
                <ActivityIndicator color={C.white} />
              ) : (
                <Text style={styles.saveBtnText}>Use this location</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navTitle: { fontSize: 15, fontWeight: '600', color: '#ffffff' },

  wrap: {},
  helperText: { fontSize: 12, color: C.gray1, lineHeight: 17, marginBottom: 10 },

  placeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: C.orange,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  placeChipName: { fontSize: 14, fontWeight: '500', color: C.white },
  placeChipAddr: { fontSize: 12, color: C.gray2, marginTop: 1 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: C.border, borderRadius: 10,
  },
  input: { flex: 1, paddingVertical: 10, paddingRight: 12, fontSize: 14, color: C.white },
  suggestionsList: {
    marginTop: 4, backgroundColor: '#111111', borderWidth: 0.5, borderColor: C.border,
    borderRadius: 10, overflow: 'hidden',
  },
  suggestionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  suggestionDivider: { borderTopWidth: 0.5, borderTopColor: C.border },
  suggestionMain: { fontSize: 13, color: C.white, fontWeight: '500', marginBottom: 1 },
  suggestionSub: { fontSize: 11, color: C.gray2 },
  pinDropBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
  pinDropBtnText: { fontSize: 12, color: C.orange, fontWeight: '600' },
  saveBtn: {
    backgroundColor: C.orange,
    borderRadius: C.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: C.white },
});
