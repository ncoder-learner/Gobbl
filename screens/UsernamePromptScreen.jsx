import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc', purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a',
  white: '#ffffff', gray1: '#888888', gray2: '#666666', gray4: '#444444',
  inputBg: '#161616', green: '#00c896', red: '#ff4444',
};

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

  const statusColor = available === true ? C.green : C.red;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.body}>

          <View style={styles.artBox}>
            <LinearGradient colors={['#1e0a38', '#2a0d4a']} style={StyleSheet.absoluteFill} />
            <Text style={styles.artAt}>@</Text>
          </View>

          <Text style={styles.title}>Pick a username</Text>
          <Text style={styles.sub}>
            Friends find you by this handle. Choose wisely — it can't be changed later.
          </Text>

          <View style={styles.inputRow}>
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

          {normalized.length > 0 && validationError ? (
            <Text style={styles.hint}>{validationError}</Text>
          ) : available === false ? (
            <Text style={[styles.hint, { color: C.red }]}>@{normalized} is already taken</Text>
          ) : available === true ? (
            <Text style={[styles.hint, { color: C.green }]}>@{normalized} is available</Text>
          ) : null}

          {error ? <Text style={[styles.hint, { color: C.red, marginTop: 4 }]}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, !canSave && styles.btnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#8855cc', '#6633aa']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            {saving ? (
              <ActivityIndicator color={C.white} />
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
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
  },
  artBox: {
    width: 110, height: 110, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 28, overflow: 'hidden',
    borderWidth: 1, borderColor: '#3a1a5a',
  },
  artAt: {
    fontSize: 54, color: '#ddb8ff', fontWeight: '800', lineHeight: 60,
  },
  title: {
    fontSize: 26, fontWeight: '800', color: C.white,
    letterSpacing: -0.5, marginBottom: 10, textAlign: 'center',
  },
  sub: {
    fontSize: 14, color: C.gray1, textAlign: 'center',
    lineHeight: 20, marginBottom: 28, paddingHorizontal: 8,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 14, paddingHorizontal: 14, height: 52, width: '100%', marginBottom: 6,
  },
  atPrefix: { fontSize: 18, color: C.gray2, marginRight: 4 },
  input: { flex: 1, fontSize: 18, color: C.white, letterSpacing: 0.3 },
  statusDot: { fontSize: 18, marginLeft: 8, fontWeight: '700' },
  hint: { fontSize: 12, color: C.gray2, marginBottom: 4, alignSelf: 'flex-start' },
  btn: {
    marginTop: 24, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', overflow: 'hidden', width: '100%',
    minHeight: 52,
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { fontSize: 16, fontWeight: '700', color: C.white, letterSpacing: 0.2 },
});
