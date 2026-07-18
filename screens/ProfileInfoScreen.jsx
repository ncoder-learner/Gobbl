import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import HomeLocationEditor from '../components/HomeLocationEditor';
import { THEME as C } from '../lib/theme';

// Skippable, not required: this sits between the intro carousel and the
// (required) username step, which is already one gate a new signup has to
// clear. Name/city are cosmetic — the initials-avatar fallback already
// degrades gracefully to username initials with nothing filled in here — so
// there's nothing broken by skipping, and adding a second required gate
// right after signup risks drop-off for no real payoff.
export default function ProfileInfoScreen({ onDone }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [city, setCity]           = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [homeLocation, setHomeLocation] = useState(null); // {lat, lng, name} | null
  const [homeSaving, setHomeSaving]     = useState(false);

  // Saves independently of Continue/Skip below — picking a home location
  // writes immediately, same as AccountScreen's copy of this field, so it
  // persists regardless of whether the rest of the screen gets skipped.
  async function handleSaveHomeLocation(place) {
    setHomeSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error: saveError } = await supabase.from('profile_home_locations').upsert({
        user_id: user.id,
        lat: place.lat,
        lng: place.lng,
        place_name: place.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (saveError) throw saveError;
      setHomeLocation(place);
    } catch (err) {
      setError(err.message || 'Failed to save home location.');
    } finally {
      setHomeSaving(false);
    }
  }

  async function handleClearHomeLocation() {
    setHomeSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error: clearError } = await supabase
        .from('profile_home_locations')
        .delete()
        .eq('user_id', user.id);
      if (clearError) throw clearError;
      setHomeLocation(null);
    } catch (err) {
      setError(err.message || 'Failed to clear home location.');
    } finally {
      setHomeSaving(false);
    }
  }

  async function persist({ skipped }) {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const first = firstName.trim();
      const last  = lastName.trim();
      const cityTrimmed = city.trim();

      const update = { profile_details_completed: true };
      if (!skipped) {
        update.first_name = first || null;
        update.last_name  = last || null;
        update.city       = cityTrimmed || null;

        // Feeds the shared Avatar's initials fallback (it reads
        // display_name) without touching every Avatar call site — only
        // backfill if the user hasn't already set a custom display name.
        if (first || last) {
          const { data: existing } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', user.id)
            .maybeSingle();
          if (!existing?.display_name) {
            update.display_name = [first, last].filter(Boolean).join(' ');
          }
        }
      }

      const { error: uErr } = await supabase
        .from('profiles')
        .update(update)
        .eq('id', user.id);
      if (uErr) throw uErr;
      onDone();
    } catch (err) {
      setError(err.message || 'Failed to save. Try again.');
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          <Text style={styles.title}>A few basics</Text>
          <Text style={styles.sub}>You can always change this later.</Text>

          <View style={styles.nameRow}>
            <View style={[styles.inputRow, styles.nameInput]}>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={C.gray4}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
            <View style={[styles.inputRow, styles.nameInput]}>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={C.gray4}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder="City"
              placeholderTextColor={C.gray4}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={() => persist({ skipped: false })}
            />
          </View>

          {/* Fully optional and saves on its own — setting it (or not) has
              no bearing on the Continue/Skip buttons below. */}
          <View style={styles.homeLocationWrap}>
            <HomeLocationEditor
              value={homeLocation}
              onSave={handleSaveHomeLocation}
              onClear={handleClearHomeLocation}
              saving={homeSaving}
              label="Home location (optional)"
              helperText="So meals you eat at home can appear on your Day Trail — your exact location is never shown to friends."
            />
          </View>

          {error ? <Text style={styles.hint}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, saving && styles.btnDisabled]}
            onPress={() => persist({ skipped: false })}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={styles.btnText}>Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => persist({ skipped: true })}
            disabled={saving}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  body: {
    flexGrow: 1, alignItems: 'flex-start', justifyContent: 'center',
    paddingHorizontal: 26, paddingVertical: 24,
  },
  homeLocationWrap: { width: '100%', marginTop: 2, marginBottom: 4 },
  title: {
    fontFamily: C.serif, fontSize: 30, color: C.white,
    marginBottom: 6,
  },
  sub: {
    fontSize: 13, color: 'rgba(245,245,247,0.45)',
    lineHeight: 18, marginBottom: 28,
  },
  nameRow: { flexDirection: 'row', gap: 10, width: '100%' },
  nameInput: { flex: 1 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 14, paddingHorizontal: 14, height: 52, width: '100%', marginBottom: 10,
  },
  input: { flex: 1, fontSize: 16, color: C.white },
  hint: { fontSize: 12, color: C.red, marginTop: 4, alignSelf: 'flex-start' },
  btn: {
    marginTop: 14, borderRadius: C.pill, paddingVertical: 16,
    alignItems: 'center', overflow: 'hidden', width: '100%',
    minHeight: 52, backgroundColor: C.white,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 16, fontWeight: '700', color: C.bg, letterSpacing: 0.2 },
  skipBtn: { marginTop: 16, padding: 4 },
  skipText: { fontSize: 14, color: C.gray2, fontWeight: '500' },
});
