import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking as RNLinking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '../lib/supabase';

const TERMS_URL = 'https://ncoder-learner.github.io/gobbl-legal/terms.html';
const PRIVACY_URL = 'https://ncoder-learner.github.io/gobbl-legal/privacy.html';

WebBrowser.maybeCompleteAuthSession();

const C = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  border: '#2a2a2a',
  orange: '#FF6B3D',
  white: '#ffffff',
  gray1: '#888888',
  gray2: '#666666',
  gray4: '#444444',
  inputBg: '#161616',
};

async function handleOAuthCallback(url) {
  const codeMatch = url.match(/[?&]code=([^&]+)/);
  if (codeMatch) {
    await supabase.auth.exchangeCodeForSession(codeMatch[1]);
    return;
  }
  const hashMatch = url.match(/#(.+)/);
  if (hashMatch) {
    const params = new URLSearchParams(hashMatch[1]);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
    }
  }
}

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const signupBlocked = mode === 'signup' && !agreedToTerms;

  async function handleSubmit() {
    if (signupBlocked) return;
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    setError(null);

    const { error: authError } =
      mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });

    setLoading(false);
    if (authError) { setError(authError.message); return; }
  }

  async function handleGoogle() {
    if (signupBlocked) return;
    setGoogleLoading(true);
    setError(null);
    try {
      const redirectUri = Linking.createURL('/');
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUri, skipBrowserRedirect: true },
      });
      if (oauthError) throw oauthError;
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
      if (result.type === 'success') {
        await handleOAuthCallback(result.url);
      }
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleApple() {
    if (signupBlocked) return;
    setError(null);
    setAppleLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const { error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (authError) throw authError;
    } catch (err) {
      if (err.code === 'ERR_REQUEST_CANCELED') { setAppleLoading(false); return; }
      setError(err.message || 'Apple sign-in failed.');
      setAppleLoading(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError(null);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.logo}>🍽️</Text>
            <Text style={styles.appName}>FoodWrapped</Text>
            <Text style={styles.tagline}>Your year in food</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.toggle}>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'login' && styles.toggleBtnActive]}
                onPress={() => switchMode('login')}
              >
                <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
                  Log in
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'signup' && styles.toggleBtnActive]}
                onPress={() => switchMode('signup')}
              >
                <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
                  Sign up
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={C.gray4}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                placeholderTextColor={C.gray4}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            {mode === 'signup' && (
              <TouchableOpacity
                style={styles.consentRow}
                onPress={() => setAgreedToTerms(v => !v)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                  {agreedToTerms && <Text style={styles.checkboxMark}>✓</Text>}
                </View>
                <Text style={styles.consentText}>
                  I agree to the{' '}
                  <Text style={styles.consentLink} onPress={() => RNLinking.openURL(TERMS_URL)}>
                    Terms of Service
                  </Text>{' '}
                  and{' '}
                  <Text style={styles.consentLink} onPress={() => RNLinking.openURL(PRIVACY_URL)}>
                    Privacy Policy
                  </Text>
                </Text>
              </TouchableOpacity>
            )}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.submitBtn, (loading || signupBlocked) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading || signupBlocked}
            >
              {loading ? (
                <ActivityIndicator color={C.white} />
              ) : (
                <Text style={styles.submitText}>
                  {mode === 'login' ? 'Log in' : 'Create account'}
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={[styles.socialBtn, (googleLoading || signupBlocked) && styles.submitBtnDisabled]}
              onPress={handleGoogle}
              disabled={googleLoading || signupBlocked}
            >
              {googleLoading ? (
                <ActivityIndicator color={C.white} size="small" />
              ) : (
                <>
                  <Text style={styles.socialIcon}>G</Text>
                  <Text style={styles.socialText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              appleLoading ? (
                <View style={styles.appleBtnLoading}>
                  <ActivityIndicator color={C.white} size="small" />
                  <Text style={styles.socialText}>Signing in…</Text>
                </View>
              ) : (
                <View
                  style={signupBlocked && styles.appleBtnDisabled}
                  pointerEvents={signupBlocked ? 'none' : 'auto'}
                >
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={14}
                    style={styles.appleBtn}
                    onPress={handleApple}
                  />
                </View>
              )
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 52, marginBottom: 12 },
  appName: { fontSize: 28, fontWeight: '800', color: C.white, letterSpacing: -0.5, marginBottom: 6 },
  tagline: { fontSize: 14, color: C.gray1 },

  card: {
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 20,
    padding: 24,
  },

  toggle: {
    flexDirection: 'row',
    backgroundColor: C.bg,
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: C.orange },
  toggleText: { fontSize: 14, fontWeight: '600', color: C.gray2 },
  toggleTextActive: { color: C.white },

  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: C.gray2, marginBottom: 8, fontWeight: '500' },
  input: {
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.white,
  },

  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: C.gray4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: C.orange,
    borderColor: C.orange,
  },
  checkboxMark: { fontSize: 13, fontWeight: '800', color: C.white, lineHeight: 14 },
  consentText: { flex: 1, fontSize: 13, color: C.gray1, lineHeight: 19 },
  consentLink: { color: C.orange, fontWeight: '600' },

  errorBox: {
    backgroundColor: '#2a0a0a',
    borderWidth: 0.5,
    borderColor: '#5a1a1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { fontSize: 13, color: '#ff6b6b', lineHeight: 18 },

  submitBtn: {
    backgroundColor: C.orange,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { fontSize: 16, fontWeight: '700', color: C.white },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 10 },
  dividerLine: { flex: 1, height: 0.5, backgroundColor: C.border },
  dividerText: { fontSize: 12, color: C.gray2 },

  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  socialIcon: { fontSize: 15, fontWeight: '800', color: C.white, width: 20, textAlign: 'center' },
  socialText: { fontSize: 15, fontWeight: '600', color: C.white },

  appleBtn: { width: '100%', height: 48 },
  appleBtnDisabled: { opacity: 0.6 },
  appleBtnLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 14,
    height: 48,
  },
});
