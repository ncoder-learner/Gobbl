import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  Linking,
  StyleSheet,
  StatusBar,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import {
  loadNotifPrefs,
  saveNotifPrefs,
  enableNotifications,
  disableNotifications,
  scheduleDailyReminder,
  getPermissionStatus,
} from '../lib/notifications';

const C = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  border: '#2a2a2a',
  orange: '#FF6B3D',
  purple: '#8855cc',
  purpleDim: '#1a0d1a',
  purpleBorder: '#3a2a4a',
  white: '#ffffff',
  gray1: '#888888',
  gray2: '#666666',
  gray4: '#444444',
  red: '#ff4444',
  redDim: '#2a0a0a',
  redBorder: '#5a1a1a',
};

const PROVIDER_LABELS = {
  email: 'Email & Password',
  google: 'Google',
  apple: 'Apple',
};

function Avatar({ name, email }) {
  const initials = name
    ? name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2)
    : (email?.[0]?.toUpperCase() ?? '?');

  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitials}>{initials}</Text>
    </View>
  );
}

function formatHour(hour) {
  const isPm = hour >= 12;
  const h12 = hour % 12 || 12;
  return `${h12}:00 ${isPm ? 'PM' : 'AM'}`;
}

function NotifTimePicker({ hour, onChange }) {
  function incHour() { onChange((hour + 1) % 24); }
  function decHour() { onChange((hour + 23) % 24); }
  return (
    <View style={styles.timeRow}>
      <Text style={styles.timeRowLabel}>Reminder time</Text>
      <View style={styles.timePicker}>
        <TouchableOpacity
          onPress={decHour}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.timeArrow}
        >
          <Text style={styles.timeArrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.timeValue}>{formatHour(hour)}</Text>
        <TouchableOpacity
          onPress={incHour}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.timeArrow}
        >
          <Text style={styles.timeArrowText}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      {!last && <View style={styles.rowDivider} />}
    </>
  );
}

export default function AccountScreen() {
  const navigation = useNavigation();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [error, setError] = useState(null);

  // Notification preferences
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(19);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifPermDenied, setNotifPermDenied] = useState(false);

  // Profile editing
  const [editName, setEditName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [{ data: { user: u }, error: userError }, prefs] = await Promise.all([
          supabase.auth.getUser(),
          loadNotifPrefs(),
        ]);
        if (userError) throw userError;
        setUser(u);
        setNotifEnabled(prefs.enabled);
        setReminderHour(prefs.reminderHour);
        if (u) {
          const { data } = await supabase
            .from('profiles')
            .select('display_name, username, city')
            .eq('id', u.id)
            .single();
          setProfile(data);
          setEditName(data?.display_name ?? '');
          setEditCity(data?.city ?? '');
        }
      } catch (err) {
        setError(err.message || 'Failed to load account info.');
      } finally {
        setLoadingProfile(false);
      }
    }
    load();
  }, []);

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      await supabase.from('profiles').upsert({
        id: u.id,
        display_name: editName.trim() || null,
        city: editCity.trim() || null,
        updated_at: new Date().toISOString(),
      });
      setProfile(p => ({ ...p, display_name: editName.trim() || null, city: editCity.trim() || null }));
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (err) {
      setError(err.message || 'Failed to save profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  const profileDirty =
    editName.trim() !== (profile?.display_name ?? '') ||
    editCity.trim() !== (profile?.city ?? '');

  async function handleToggleNotif(value) {
    setNotifLoading(true);
    setNotifPermDenied(false);
    try {
      if (value) {
        const granted = await enableNotifications(reminderHour, 0);
        if (!granted) {
          const status = await getPermissionStatus();
          if (status === 'denied') setNotifPermDenied(true);
          setNotifLoading(false);
          return;
        }
        setNotifEnabled(true);
        await saveNotifPrefs({ enabled: true, reminderHour, reminderMinute: 0 });
      } else {
        await disableNotifications();
        setNotifEnabled(false);
        await saveNotifPrefs({ enabled: false, reminderHour, reminderMinute: 0 });
      }
    } catch {
      // Non-fatal — toggle stays in previous state
    } finally {
      setNotifLoading(false);
    }
  }

  async function handleTimeChange(hour) {
    setReminderHour(hour);
    await saveNotifPrefs({ enabled: notifEnabled, reminderHour: hour, reminderMinute: 0 });
    if (notifEnabled) {
      scheduleDailyReminder(hour, 0).catch(() => {});
    }
  }

  async function handleDevReset() {
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      const keysToRemove = [
        '@fw_notif_nudge_v1',
        '@fw_tt_feed',
        '@fw_tt_tierlist',
        '@fw_tt_pin',
        ...(u ? [`onboarding_done_${u.id}`] : []),
      ];
      await AsyncStorage.multiRemove(keysToRemove);
      if (u) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: false, updated_at: new Date().toISOString() })
          .eq('id', u.id);
      }
      Alert.alert(
        'Dev Reset Done',
        'First-run flags cleared.\n\nForce-close the app and reopen — onboarding and all tooltips will fire again.',
      );
    } catch (err) {
      Alert.alert('Dev Reset Failed', err.message || 'Unknown error');
    }
  }

  async function handleSignOut() {
    setSignOutLoading(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      // App.js onAuthStateChange handles the redirect — no need to update state here.
    } catch (err) {
      setError(err.message || 'Sign out failed. Please try again.');
      setSignOutLoading(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleteLoading(true);
    setError(null);
    try {
      const { error: fnError } = await supabase.functions.invoke('delete-account');
      if (fnError) throw fnError;
      await supabase.auth.signOut();
    } catch (err) {
      setError(err.message || 'Failed to delete account. Please try again.');
      setDeleteLoading(false);
      setShowDeleteModal(false);
    }
  }

  if (loadingProfile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.orange} />
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 14, color: C.gray1, textAlign: 'center' }}>
            {error || 'Could not load account. Please restart the app.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName =
    profile?.display_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    null;

  const provider = user.app_metadata?.provider ?? 'email';
  const providerLabel = PROVIDER_LABELS[provider] ?? provider;

  const createdAt = user.created_at
    ? new Date(user.created_at).toLocaleDateString([], {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Account</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* Profile card */}
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <Avatar name={displayName} email={user.email} />
            <View style={styles.profileInfo}>
              {displayName ? (
                <Text style={styles.displayName}>{displayName}</Text>
              ) : null}
              {profile?.username ? (
                <Text style={styles.username}>@{profile.username}</Text>
              ) : null}
              <Text style={styles.email}>{user.email}</Text>
            </View>
          </View>
        </View>

        {/* Edit profile */}
        <View style={styles.card}>
          <View style={styles.editField}>
            <Text style={styles.editLabel}>Display name</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={v => { setEditName(v); setProfileSaved(false); }}
              placeholder="Your name"
              placeholderTextColor={C.gray4}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
          <View style={styles.rowDivider} />
          <View style={styles.editField}>
            <Text style={styles.editLabel}>City</Text>
            <TextInput
              style={styles.editInput}
              value={editCity}
              onChangeText={v => { setEditCity(v); setProfileSaved(false); }}
              placeholder="Your city"
              placeholderTextColor={C.gray4}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={profileDirty ? handleSaveProfile : undefined}
            />
          </View>
          {(profileDirty || profileSaved) && (
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.saveBtn, profileSaving && styles.btnDisabled]}
                onPress={handleSaveProfile}
                disabled={profileSaving || !profileDirty}
                activeOpacity={0.8}
              >
                <Text style={styles.saveBtnText}>
                  {profileSaving ? 'Saving…' : profileSaved ? 'Saved ✓' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Social */}
        <TouchableOpacity
          style={[styles.card, styles.friendsRow]}
          onPress={() => navigation.navigate('Friends')}
          activeOpacity={0.75}
        >
          <Text style={styles.friendsRowLabel}>Friends</Text>
          <Text style={styles.friendsRowChevron}>›</Text>
        </TouchableOpacity>

        {/* Account details */}
        <View style={styles.card}>
          <InfoRow label="Signed in with" value={providerLabel} />
          {createdAt && (
            <InfoRow label="Member since" value={createdAt} last />
          )}
        </View>

        {/* Notifications */}
        <View style={styles.card}>
          <View style={styles.notifToggleRow}>
            <View style={styles.notifToggleLeft}>
              <Text style={styles.notifToggleLabel}>Daily reminders</Text>
              <Text style={styles.notifToggleSub}>A prompt to log your meals each day</Text>
            </View>
            {notifLoading ? (
              <ActivityIndicator size="small" color={C.orange} />
            ) : (
              <Switch
                value={notifEnabled}
                onValueChange={handleToggleNotif}
                trackColor={{ false: C.gray4, true: C.orange }}
                thumbColor={C.white}
                ios_backgroundColor={C.gray4}
              />
            )}
          </View>
          {notifEnabled && (
            <>
              <View style={styles.rowDivider} />
              <NotifTimePicker hour={reminderHour} onChange={handleTimeChange} />
            </>
          )}
          {notifPermDenied && (
            <View style={styles.notifDeniedBox}>
              <Text style={styles.notifDeniedText}>
                Notifications are blocked. Enable them in your device Settings.
              </Text>
              <TouchableOpacity onPress={() => Linking.openSettings()} activeOpacity={0.7}>
                <Text style={styles.notifOpenSettings}>Open Settings →</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Sign out */}
        <TouchableOpacity
          style={[styles.btn, styles.signOutBtn, signOutLoading && styles.btnDisabled]}
          onPress={handleSignOut}
          disabled={signOutLoading}
          activeOpacity={0.8}
        >
          {signOutLoading ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={styles.btnText}>Sign out</Text>
          )}
        </TouchableOpacity>

        {/* Delete account */}
        <TouchableOpacity
          style={[styles.btn, styles.deleteBtn]}
          onPress={() => { setError(null); setShowDeleteModal(true); }}
          activeOpacity={0.8}
        >
          <Text style={[styles.btnText, styles.deleteText]}>Delete account</Text>
        </TouchableOpacity>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {__DEV__ && (
          <View style={styles.devSection}>
            <Text style={styles.devHeader}>DEV TOOLS</Text>
            <TouchableOpacity style={styles.devBtn} onPress={handleDevReset} activeOpacity={0.8}>
              <Text style={styles.devBtnText}>Reset first-run flags</Text>
            </TouchableOpacity>
            <Text style={styles.devNote}>
              Clears onboarding + all tooltip flags. Force-close & reopen to re-trigger.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Delete confirmation modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => !deleteLoading && setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete account?</Text>
            <Text style={styles.modalBody}>
              This will permanently erase your account and all your food logs,
              ratings, and data. This cannot be undone.
            </Text>

            <TouchableOpacity
              style={[styles.btn, styles.deleteBtn, { marginBottom: 10 }]}
              onPress={handleDeleteAccount}
              disabled={deleteLoading}
              activeOpacity={0.8}
            >
              {deleteLoading ? (
                <ActivityIndicator color={C.red} />
              ) : (
                <Text style={[styles.btnText, styles.deleteText]}>
                  Yes, delete my account
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn]}
              onPress={() => setShowDeleteModal(false)}
              disabled={deleteLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 24, paddingBottom: 48 },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navTitle: { fontSize: 15, fontWeight: '600', color: '#ffffff' },

  card: {
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 16,
    marginBottom: 14,
    overflow: 'hidden',
  },

  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.purpleDim,
    borderWidth: 1,
    borderColor: C.purpleBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 20,
    fontWeight: '700',
    color: '#cc99ff',
  },
  profileInfo: { flex: 1 },
  displayName: {
    fontSize: 17,
    fontWeight: '700',
    color: C.white,
    marginBottom: 2,
  },
  username: { fontSize: 13, color: C.gray2, marginBottom: 2 },
  email: { fontSize: 14, color: C.gray1 },

  friendsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 15,
  },
  friendsRowLabel: { fontSize: 15, fontWeight: '600', color: C.white },
  friendsRowChevron: { fontSize: 20, color: C.gray4, lineHeight: 22 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 14, color: C.gray2 },
  rowValue: { fontSize: 14, fontWeight: '500', color: C.white },
  rowDivider: { height: 0.5, backgroundColor: C.border, marginHorizontal: 18 },

  btn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 15, fontWeight: '600', color: C.white },

  signOutBtn: {
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    marginTop: 10,
  },
  deleteBtn: {
    backgroundColor: C.redDim,
    borderWidth: 0.5,
    borderColor: C.redBorder,
  },
  deleteText: { color: C.red },
  cancelBtn: {
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
  },

  errorBox: {
    backgroundColor: '#2a0a0a',
    borderWidth: 0.5,
    borderColor: '#5a1a1a',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  errorText: { fontSize: 13, color: '#ff6b6b', lineHeight: 18 },

  // Notifications card
  notifToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  notifToggleLeft: { flex: 1 },
  notifToggleLabel: { fontSize: 14, fontWeight: '600', color: C.white, marginBottom: 2 },
  notifToggleSub: { fontSize: 12, color: C.gray2 },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  timeRowLabel: { fontSize: 14, color: C.gray2 },
  timePicker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeArrow: { padding: 4 },
  timeArrowText: { fontSize: 22, color: C.orange, fontWeight: '300', lineHeight: 24 },
  timeValue: { fontSize: 14, fontWeight: '500', color: C.white, minWidth: 72, textAlign: 'center' },

  notifDeniedBox: {
    marginHorizontal: 14,
    marginBottom: 12,
    backgroundColor: '#1a1000',
    borderWidth: 0.5,
    borderColor: '#4a3a00',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  notifDeniedText: { fontSize: 12, color: '#ccaa44', lineHeight: 17 },
  notifOpenSettings: { fontSize: 12, color: C.orange, fontWeight: '600' },

  // DEV section
  devSection: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#3a2a00',
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#1a1400',
  },
  devHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: '#aa8800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  devBtn: {
    backgroundColor: '#2a2000',
    borderWidth: 1,
    borderColor: '#5a4400',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 8,
  },
  devBtnText: { fontSize: 14, fontWeight: '600', color: '#ffcc00' },
  devNote: { fontSize: 11, color: '#666644', lineHeight: 15, textAlign: 'center' },

  // Edit profile card
  editField: { paddingHorizontal: 18, paddingVertical: 12 },
  editLabel: { fontSize: 12, color: C.gray2, fontWeight: '500', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  editInput: {
    fontSize: 15,
    color: C.white,
    backgroundColor: '#111111',
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  editActions: { paddingHorizontal: 18, paddingBottom: 14, paddingTop: 4 },
  saveBtn: {
    backgroundColor: C.purple,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: C.white },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.white,
    marginBottom: 10,
  },
  modalBody: {
    fontSize: 14,
    color: C.gray1,
    lineHeight: 20,
    marginBottom: 24,
  },
});
