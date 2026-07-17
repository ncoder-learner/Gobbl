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

const C = {
  bg: '#0d0d0d', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc',
  white: '#ffffff', gray1: '#888888', gray2: '#666666', gray4: '#444444',
};

const DEFAULT_MAP_REGION = {
  latitude: 39.5, longitude: -98.35, latitudeDelta: 40, longitudeDelta: 40,
};

// Search (places-search edge function, same one LogMealScreen uses) or a
// manual pin drop on a map, for the one-time "home" a meal can be tagged
// against via "This was at home" in LogMealScreen. Shared between
// AccountScreen (edit any time) and ProfileInfoScreen (set during
// onboarding) — one implementation so the two never drift apart.
export default function HomeLocationEditor({ value, onSave, onClear, saving, label = 'Home location', helperText }) {
  const [query, setQuery]           = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching]   = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinRegion, setPinRegion]   = useState(DEFAULT_MAP_REGION);
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
      const { data, error } = await supabase.functions.invoke('places-search', {
        body: { query: q, sessionToken: sessionRef.current },
      });
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
      onSave({ lat: data.lat, lng: data.lng, name: data.name || s.main_text });
    } catch {
      onSave({ lat: null, lng: null, name: s.main_text });
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
      const pos = await Location.getCurrentPositionAsync({});
      setPinRegion({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    } catch {
      // non-fatal — keep default region
    }
  }

  async function confirmPin() {
    const coord = pinCoord || { latitude: pinRegion.latitude, longitude: pinRegion.longitude };
    setPinResolving(true);
    try {
      let label = 'Dropped pin';
      try {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: coord.latitude, longitude: coord.longitude,
        });
        if (place) {
          label = [place.name || place.street, place.city].filter(Boolean).join(', ') || label;
        }
      } catch {
        // fall back to generic label
      }
      onSave({ lat: coord.latitude, lng: coord.longitude, name: label });
      setPinModalVisible(false);
    } finally {
      setPinResolving(false);
    }
  }

  if (value) {
    return (
      <View style={styles.editField}>
        <Text style={styles.editLabel}>{label}</Text>
        {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
        <View style={styles.placeChip}>
          <Ionicons name="home" size={16} color={C.orange} style={{ marginTop: 1 }} />
          <Text style={styles.placeChipName} numberOfLines={1}>{value.name}</Text>
          <TouchableOpacity onPress={onClear} hitSlop={12} disabled={saving}>
            <Ionicons name="close-circle" size={20} color={C.gray4} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.editField}>
      <Text style={styles.editLabel}>{label}</Text>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      <View style={styles.placeInputRow}>
        <Ionicons name="search" size={16} color={C.gray4} style={{ marginLeft: 12 }} />
        <TextInput
          style={styles.placeInput}
          value={query}
          onChangeText={handleQueryChange}
          placeholder="Search your address"
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
        <Ionicons name="pin-outline" size={14} color={C.purple} />
        <Text style={styles.pinDropBtnText}>Or drop a pin on the map</Text>
      </TouchableOpacity>

      <Modal visible={pinModalVisible} animationType="slide" onRequestClose={() => setPinModalVisible(false)}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.navBar}>
            <TouchableOpacity onPress={() => setPinModalVisible(false)} hitSlop={12}>
              <Text style={{ color: C.gray1, fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.navTitle}>Drop your home pin</Text>
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

  editField: { paddingHorizontal: 18, paddingVertical: 12 },
  editLabel: { fontSize: 12, color: C.gray2, fontWeight: '500', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  helperText: { fontSize: 12, color: C.gray1, lineHeight: 17, marginBottom: 10 },

  placeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: C.orange,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  placeChipName: { flex: 1, fontSize: 14, fontWeight: '500', color: C.white },
  placeInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: C.border, borderRadius: 10,
  },
  placeInput: { flex: 1, paddingVertical: 10, paddingRight: 12, fontSize: 14, color: C.white },
  suggestionsList: {
    marginTop: 4, backgroundColor: '#111111', borderWidth: 0.5, borderColor: C.border,
    borderRadius: 10, overflow: 'hidden',
  },
  suggestionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  suggestionDivider: { borderTopWidth: 0.5, borderTopColor: C.border },
  suggestionMain: { fontSize: 13, color: C.white, fontWeight: '500', marginBottom: 1 },
  suggestionSub: { fontSize: 11, color: C.gray2 },
  pinDropBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
  pinDropBtnText: { fontSize: 12, color: C.purple, fontWeight: '600' },
  saveBtn: {
    backgroundColor: C.purple,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: C.white },
});
