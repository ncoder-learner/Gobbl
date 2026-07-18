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
import { GobblMark } from '../components/GobblMark';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';
import { THEME as C } from '../lib/theme';

const TERMS_URL = 'https://ncoder-learner.github.io/gobbl-legal/terms.html';
const PRIVACY_URL = 'https://ncoder-learner.github.io/gobbl-legal/privacy.html';

WebBrowser.maybeCompleteAuthSession();

async function handleOAuthCallback(url) {
  // This runs the instant the browser session closes and control returns to
  // the app — exactly the moment a supabase-js client can deadlock on its
  // internal session lock if a sign-out happened earlier in the same
  // session. Unlike the browser step before it, there's no user-facing UI
  // here to "hang" — it would just silently never resolve, leaving
  // googleLoading stuck true with the button spinner spinning forever.
  const codeMatch = url.match(/[?&]code=([^&]+)/);
  if (codeMatch) {
    await withTimeout(
      supabase.auth.exchangeCodeForSession(codeMatch[1]),
      15000, 'Signing you in is taking too long. Please try again.',
    );
    return;
  }
  const hashMatch = url.match(/#(.+)/);
  if (hashMatch) {
    const params = new URLSearchParams(hashMatch[1]);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      await withTimeout(
        supabase.auth.setSession({ access_token, refresh_token }),
        15000, 'Signing you in is taking too long. Please try again.',
      );
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
  const [showEmailForm, setShowEmailForm] = useState(false);

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
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
          // Without this, the Custom Tab can silently reuse whatever
          // Google session is already cached in the browser instead of
          // showing the account picker — the exact "switching accounts
          // hangs" symptom, since the flow may never present the UI you're
          // expecting to interact with.
          queryParams: { prompt: 'select_account' },
        },
      });
      if (oauthError) throw oauthError;

      // If the redirect never lands correctly (e.g. a redirect-URL mismatch
      // in the Supabase Google provider config), this promise has no other
      // way to ever resolve — the Google button would spin forever with no
      // way to recover short of force-closing the app.
      const result = await withTimeout(
        WebBrowser.openAuthSessionAsync(data.url, redirectUri),
        60000, 'Google sign-in is taking too long. Please try again.',
      );
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
            <View style={styles.logoBadgeShadow}>
              <GobblMark size={54} bg={C.bg} />
            </View>
            <Text style={styles.appName}>
              Track every meal,{'\n'}
              <Text style={styles.appNameItalic}>together.</Text>
            </Text>
            <Text style={styles.tagline}>Log your day, see your friends' day, and settle who ate best.</Text>
          </View>

          <View style={styles.primaryStack}>
            {Platform.OS === 'ios' && (
              appleLoading ? (
                <View style={styles.appleBtnLoading}>
                  <ActivityIndicator color={C.bg} size="small" />
                  <Text style={[styles.socialText, { color: C.bg }]}>Signing in…</Text>
                </View>
              ) : (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={27}
                  style={styles.appleBtn}
                  onPress={handleApple}
                />
              )
            )}

            <TouchableOpacity
              style={[styles.socialBtn, googleLoading && styles.submitBtnDisabled]}
              onPress={handleGoogle}
              disabled={googleLoading}
            >
              {googleLoading ? (
                <ActivityIndicator color={C.white} size="small" />
              ) : (
                <Text style={styles.socialText}>Continue with Google</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowEmailForm(v => !v)} activeOpacity={0.7}>
              <Text style={styles.emailLink}>Continue with email</Text>
            </TouchableOpacity>

            <Text style={styles.footnote}>By continuing you agree to our{' '}
              <Text style={styles.consentLink} onPress={() => RNLinking.openURL(TERMS_URL)}>Terms</Text>
              {' '}&{' '}
              <Text style={styles.consentLink} onPress={() => RNLinking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
            </Text>
          </View>

          {showEmailForm && (
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
                  <ActivityIndicator color={C.bg} />
                ) : (
                  <Text style={styles.submitText}>
                    {mode === 'login' ? 'Log in' : 'Create account'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  header: { marginBottom: 32 },
  logoBadgeShadow: {
    marginBottom: 24, alignSelf: 'flex-start',
    shadowColor: C.orange, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 10 },
  },
  appName: { fontFamily: C.serif, fontSize: 38, color: C.white, lineHeight: 42 },
  appNameItalic: { fontFamily: C.serifItalic, color: C.orange },
  tagline: { fontSize: 14, color: C.gray1, marginTop: 12, lineHeight: 20, maxWidth: 280 },

  primaryStack: { marginBottom: 20 },
  emailLink: { fontSize: 13, fontWeight: '600', color: C.orange, textAlign: 'center', marginTop: 6 },
  footnote: { fontSize: 11, color: C.gray3, textAlign: 'center', marginTop: 18, lineHeight: 16 },

  card: {
    backgroundColor: C.glassBg,
    borderWidth: 1,
    borderColor: C.glassBorder,
    borderRadius: 24,
    padding: 24,
  },

  toggle: {
    flexDirection: 'row',
    backgroundColor: C.bg,
    borderRadius: C.pill,
    padding: 4,
    marginBottom: 24,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: C.pill },
  toggleBtnActive: { backgroundColor: C.orange },
  toggleText: { fontSize: 14, fontWeight: '600', color: C.gray2 },
  toggleTextActive: { color: C.white },

  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: C.gray2, marginBottom: 8, fontWeight: '500' },
  input: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.glassBorder,
    borderRadius: 14,
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
    backgroundColor: C.redDim,
    borderWidth: 0.5,
    borderColor: C.redBorder,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { fontSize: 13, color: C.red, lineHeight: 18 },

  submitBtn: {
    backgroundColor: C.white,
    borderRadius: C.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { fontSize: 16, fontWeight: '700', color: C.bg },

  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderWidth: 1,
    borderColor: 'rgba(245,245,247,0.18)',
    borderRadius: C.pill,
    marginTop: 10,
  },
  socialText: { fontSize: 15, fontWeight: '600', color: C.white },

  appleBtn: { width: '100%', height: 54 },
  appleBtnDisabled: { opacity: 0.6 },
  appleBtnLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.white,
    borderRadius: C.pill,
    height: 54,
  },
});
