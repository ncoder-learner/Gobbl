import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import MealTagPicker from '../components/MealTagPicker';
import ScoreSlider from '../components/ScoreSlider';
import PlaceSearchPicker from '../components/PlaceSearchPicker';
import { isHomeMeal, displayPlaceName } from '../lib/homePrivacy';
import { THEME as C } from '../lib/theme';

// Edit any field a meal has that's actually meant to be user-editable after
// the fact: name, slot, score, notes, and location. Deliberately leaves out
// the photo (LogMealScreen's camera/upload flow is a bigger, separate
// surface — MealDetailScreen already has its own "Add photo" for extras)
// and the AI-identification metadata (description/cuisine/confidence),
// which reflect what the model saw at log time, not something to hand-edit.
export default function EditMealScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { mealId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notOwner, setNotOwner] = useState(false);

  const [name, setName] = useState('');
  const [tag, setTag] = useState('breakfast');
  const [score, setScore] = useState(5.5);
  const [notes, setNotes] = useState('');
  const [place, setPlace] = useState(null); // {place_id, name, address, lat, lng} | null
  const [userCoords, setUserCoords] = useState(null);
  const [homeLocation, setHomeLocation] = useState(null); // {lat, lng, name} | null — from profile_home_locations
  const currentUserIdRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) currentUserIdRef.current = user.id;
      const { data, error: fetchErr } = await supabase
        .from('meals')
        .select('id, user_id, name, score, tag, notes, place_id, places(name, address, lat, lng)')
        .eq('id', mealId)
        .single();
      if (fetchErr) throw fetchErr;

      if (!user || data.user_id !== user.id) {
        setNotOwner(true);
        return;
      }

      setName(data.name || '');
      setTag(data.tag || 'breakfast');
      setScore(typeof data.score === 'number' ? data.score : Number(data.score) || 5.5);
      setNotes(data.notes || '');
      setPlace(
        data.place_id
          ? {
              place_id: data.place_id,
              name: displayPlaceName(data) || data.places?.name || 'Saved place',
              address: !isHomeMeal(data) ? data.places?.address ?? null : null,
              lat: data.places?.lat ?? null,
              lng: data.places?.lng ?? null,
            }
          : null
      );
    } catch (err) {
      setError(err.message || 'Failed to load this meal.');
    } finally {
      setLoading(false);
    }
  }, [mealId]);

  useEffect(() => { load(); }, [load]);

  // Live device position just to bias the place search sensibly by default —
  // never required, non-fatal if denied.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        // non-fatal
      }
    })();
  }, []);

  // Load the user's saved home location (if any) so "This was at home" can
  // be offered here too, same as LogMealScreen — see selectHome() below.
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        currentUserIdRef.current = user.id;
        const { data, error: homeErr } = await supabase
          .from('profile_home_locations')
          .select('lat, lng, place_name')
          .eq('user_id', user.id)
          .maybeSingle();
        if (homeErr) throw homeErr;
        if (data?.lat != null && data?.lng != null) {
          setHomeLocation({ lat: data.lat, lng: data.lng, name: data.place_name || 'Home' });
        }
      } catch (err) {
        console.warn('[EditMeal] failed to load home location:', err?.message ?? err);
      }
    })();
  }, []);

  // "This was at home" — same `home:` place_id convention as LogMealScreen's
  // selectHome() (see lib/homePrivacy.js): masks the real address from
  // friends and keys off saved home coordinates when available so repeated
  // home-tagged meals share one `places` row instead of creating duplicates.
  function selectHome() {
    if (!currentUserIdRef.current) return;
    if (homeLocation) {
      const latKey = homeLocation.lat.toFixed(5);
      const lngKey = homeLocation.lng.toFixed(5);
      setPlace({
        place_id: `home:${currentUserIdRef.current}:${latKey}:${lngKey}`,
        name: homeLocation.name,
        address: null,
        lat: homeLocation.lat,
        lng: homeLocation.lng,
      });
    } else {
      setPlace({
        place_id: `home:${currentUserIdRef.current}`,
        name: 'Home',
        address: null,
        lat: null,
        lng: null,
      });
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a meal name.');
      return;
    }
    setSaving(true);
    try {
      // Upsert the (possibly new) place before pointing the meal at it —
      // same ignoreDuplicates pattern LogMealScreen uses at creation time.
      if (place?.place_id) {
        const { error: placeErr } = await supabase.from('places').upsert(
          {
            place_id: place.place_id,
            name: place.name,
            address: place.address ?? null,
            lat: place.lat ?? null,
            lng: place.lng ?? null,
          },
          { onConflict: 'place_id', ignoreDuplicates: true },
        );
        if (placeErr) throw placeErr;
      }

      const derivedRating = Math.max(1, Math.min(5, Math.round(score / 2)));
      const { error: updateErr } = await supabase
        .from('meals')
        .update({
          name: name.trim(),
          tag,
          score,
          rating: derivedRating,
          notes: notes.trim() || null,
          place_id: place?.place_id ?? null,
        })
        .eq('id', mealId);
      if (updateErr) throw updateErr;

      navigation.goBack();
    } catch (err) {
      Alert.alert('Save failed', err.message || 'Could not save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}><ActivityIndicator color={C.orange} /></View>
      </SafeAreaView>
    );
  }

  if (notOwner || error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>⚠️</Text>
          <Text style={styles.emptyTitle}>
            {notOwner ? "You can only edit your own meals" : "Couldn't load this meal"}
          </Text>
          {error ? <Text style={styles.emptySub}>{error}</Text> : null}
          <TouchableOpacity style={styles.retryBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={styles.retryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} disabled={saving}>
          <Text style={styles.navCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Edit meal</Text>
        <TouchableOpacity onPress={handleSave} hitSlop={12} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={C.orange} /> : <Text style={styles.navSave}>Save</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="Meal name"
            placeholderTextColor={C.gray4}
          />

          <Text style={styles.label}>Meal</Text>
          <MealTagPicker value={tag} onChange={setTag} />

          <Text style={styles.label}>Score</Text>
          <ScoreSlider value={score} onChange={setScore} />

          <Text style={styles.label}>Location</Text>
          <PlaceSearchPicker
            value={place}
            onChange={setPlace}
            userCoords={userCoords}
            placeholder="Search for a place"
            onSelectHome={selectHome}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={C.gray4}
            multiline
          />

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontWeight: '700', fontSize: 18, color: C.white, marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, color: C.gray1, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn: { backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: C.white },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navCancel: { fontSize: 15, color: C.gray1, fontWeight: '500' },
  navTitle: { fontSize: 16, fontWeight: '700', color: C.white },
  navSave: { fontSize: 15, color: C.orange, fontWeight: '700' },

  body: { paddingHorizontal: 20, paddingTop: 8 },
  label: {
    fontSize: 12, color: C.gray2, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 22, marginBottom: 8,
  },
  textInput: {
    backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.white,
  },
  textArea: { height: 88, textAlignVertical: 'top' },
});
