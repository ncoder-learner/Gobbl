import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { THEME as C } from '../lib/theme';

function validateUsername(u) {
  if (!u) return null;
  if (u.length < 3) return 'At least 3 characters';
  if (u.length > 20) return 'Max 20 characters';
  if (!/^[a-z0-9_]+$/.test(u)) return 'Letters, numbers, and underscores only';
  return null;
}

export default function UsernamePromptScreen({ onDone }) {
  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(null); // null | true | false
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const normalized = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const validationError = validateUsername(normalized);
  const canSave = !validationError && available === true && normalized.length >= 3 && !saving;

  let checkTimer = null;

  function handleChange(text) {
    const v = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(v);
    setAvailable(null);
    setError(null);

    if (checkTimer) clearTimeout(checkTimer);
    if (v.length >= 3 && !validateUsername(v)) {
      setChecking(true);
      checkTimer = setTimeout(() => checkAvailability(v), 500);
    } else {
      setChecking(false);
    }
  }

  async function checkAvailability(value) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', value)
        .maybeSingle();
      setAvailable(!data);
    } catch {
      setAvailable(null);
    } finally {
      setChecking(false);
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { error: uErr } = await supabase
        .from('profiles')
        .update({ username: normalized })
        .eq('id', user.id);
      if (uErr) throw uErr;
      onDone();
    } catch (err) {
      setError(err.message || 'Failed to save. Try again.');
      setSaving(false);
    }
  }

  const statusIndicator = checking ? null
    : normalized.length >= 3 && !validationError && available === true ? '✓'
    : normalized.length >= 3 && !validationError && available === false ? '✕'
    : null;

  const statusColor = available === true ? C.orange : C.red;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.body}>

          <Text style={styles.title}>Pick a username</Text>
          <Text style={styles.sub}>This is how friends will find you.</Text>

          <View style={[styles.inputRow, available === true && styles.inputRowAvailable]}>
            <Text style={styles.atPrefix}>@</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={handleChange}
              placeholder="yourname"
              placeholderTextColor={C.gray4}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            {checking ? (
              <ActivityIndicator size="small" color={C.gray2} style={{ marginLeft: 8 }} />
            ) : statusIndicator ? (
              <Text style={[styles.statusDot, { color: statusColor }]}>{statusIndicator}</Text>
            ) : null}
          </View>

          {normalized.length >= 3 && !validationError && available !== null ? (
            <View style={styles.availabilityRow}>
              <View style={[styles.availabilityDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.availabilityText, { color: available ? 'rgba(245,245,247,0.5)' : C.red }]}>
                {available ? 'Available' : `@${normalized} is already taken`}
              </Text>
            </View>
          ) : normalized.length > 0 && validationError ? (
            <Text style={styles.hint}>{validationError}</Text>
          ) : null}

          {error ? <Text style={[styles.hint, { color: C.red, marginTop: 4 }]}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, !canSave && styles.btnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={styles.btnText}>
                {normalized ? `Claim @${normalized}` : 'Choose a username first'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  body: {
    flex: 1, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 26,
  },
  title: {
    fontFamily: C.serif, fontSize: 30, color: C.white,
    marginBottom: 6,
  },
  sub: {
    fontSize: 13, color: 'rgba(245,245,247,0.45)',
    lineHeight: 18, marginBottom: 28,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 14, paddingHorizontal: 16, height: 54, width: '100%', marginBottom: 10,
  },
  inputRowAvailable: {
    borderWidth: 1.5, borderColor: C.orange,
    shadowColor: C.orange, shadowOpacity: 0.25, shadowRadius: 0, elevation: 0,
  },
  atPrefix: { fontSize: 18, color: C.gray2, marginRight: 4 },
  input: { flex: 1, fontSize: 18, fontWeight: '600', color: C.white, letterSpacing: 0.3 },
  statusDot: { fontSize: 18, marginLeft: 8, fontWeight: '700' },
  availabilityRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  availabilityDot: { width: 6, height: 6, borderRadius: 3 },
  availabilityText: { fontSize: 12 },
  hint: { fontSize: 12, color: C.gray2, marginBottom: 4, alignSelf: 'flex-start' },
  btn: {
    marginTop: 24, borderRadius: C.pill, paddingVertical: 16,
    alignItems: 'center', overflow: 'hidden', width: '100%',
    minHeight: 52, backgroundColor: C.white,
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { fontSize: 16, fontWeight: '700', color: C.bg, letterSpacing: 0.2 },
});
