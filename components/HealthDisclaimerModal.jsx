/**
 * HealthDisclaimerModal
 *
 * Mandatory disclaimer gate shown before first use of any diet/health features.
 * Displays non-prescriptive, neutral disclaimer text clarifying that Gobbl provides
 * general educational information, is not medical advice, and does not replace a doctor or dietitian.
 *
 * Requires an explicit tap on "I Understand & Acknowledge".
 * On acknowledge:
 *  - Writes disclaimer_accepted_at to user_diet_preferences
 *  - Inserts audit row into diet_disclaimer_audit_logs (user_id, terms_version, consent_summary, accepted_at)
 *  - Persists acknowledgment locally to prevent repeated popups for this terms_version
 */

import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { DIET_DISCLAIMER_TEXT } from '../lib/dietTemplates';
import { THEME as C } from '../lib/theme';

export const CURRENT_DISCLAIMER_VERSION = '2026.1';

export default function HealthDisclaimerModal({
  visible,
  userId,
  onAcknowledge,
}) {
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!visible) return null;

  const handleAccept = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      let uid = userId;
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser();
        uid = user?.id || null;
      }

      const nowIso = new Date().toISOString();

      if (uid) {
        // 1. Insert into diet_disclaimer_audit_logs
        const { error: auditError } = await supabase
          .from('diet_disclaimer_audit_logs')
          .insert({
            user_id: uid,
            terms_version: CURRENT_DISCLAIMER_VERSION,
            consent_summary: 'Accepted general health & nutrition medical disclaimer: informational only, not medical advice, consult physician or dietitian.',
            accepted_at: nowIso,
          });

        if (auditError) {
          console.warn('[HealthDisclaimer] Audit log error (non-fatal):', auditError.message);
        }

        // 2. Persist disclaimer_accepted_at in user_diet_preferences
        const { error: prefError } = await supabase
          .from('user_diet_preferences')
          .upsert(
            {
              user_id: uid,
              disclaimer_accepted_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'user_id' }
          );

        if (prefError) {
          console.warn('[HealthDisclaimer] Pref save error (non-fatal):', prefError.message);
        }

        // 3. Cache locally to avoid any network latency or re-render flicker
        try {
          await AsyncStorage.setItem(`@fw_diet_disclaimer_${CURRENT_DISCLAIMER_VERSION}_${uid}`, nowIso);
        } catch (_) {}
      }

      onAcknowledge && onAcknowledge();
    } catch (err) {
      console.error('[HealthDisclaimer] Exception on accept:', err);
      setErrorMsg('Could not save acknowledgment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {}} // Non-dismissible without explicit acknowledgment
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: Math.max(20, insets.bottom + 12) }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="shield-checkmark" size={26} color={C.orange} />
            </View>
            <Text style={styles.title}>Important Health Information</Text>
            <Text style={styles.subtitle}>
              Please review and acknowledge before using Gobbl’s nutrition and wellness features.
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Core Informational Points */}
            <View style={styles.pointsList}>
              <View style={styles.pointRow}>
                <Ionicons name="information-circle-outline" size={20} color={C.gold} style={styles.pointIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointTitle}>Informational Tracking Only</Text>
                  <Text style={styles.pointBody}>
                    Gobbl provides general wellness tracking, calorie estimates, and nutritional summaries. All data is for educational reference only.
                  </Text>
                </View>
              </View>

              <View style={styles.pointRow}>
                <Ionicons name="medkit-outline" size={20} color="#30d158" style={styles.pointIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointTitle}>Not Medical or Clinical Advice</Text>
                  <Text style={styles.pointBody}>
                    {DIET_DISCLAIMER_TEXT[0]} The app does not diagnose, treat, or replace care from licensed medical doctors or registered dietitians.
                  </Text>
                </View>
              </View>

              <View style={styles.pointRow}>
                <Ionicons name="fitness-outline" size={20} color={C.orange} style={styles.pointIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointTitle}>Consult a Healthcare Professional</Text>
                  <Text style={styles.pointBody}>
                    {DIET_DISCLAIMER_TEXT[1]}
                  </Text>
                </View>
              </View>

              <View style={styles.pointRow}>
                <Ionicons name="body-outline" size={20} color="#60a5fa" style={styles.pointIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointTitle}>Individual Variability</Text>
                  <Text style={styles.pointBody}>
                    {DIET_DISCLAIMER_TEXT[2]}
                  </Text>
                </View>
              </View>
            </View>

            {errorMsg ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Action button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.ackBtn, saving && styles.ackBtnDisabled]}
              onPress={handleAccept}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.ackBtnText}>I Understand & Acknowledge</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.versionTag}>Version {CURRENT_DISCLAIMER_VERSION} · General Wellness Policy</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '88%',
    backgroundColor: '#141416',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingTop: 24,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(251, 114, 56, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(251, 114, 56, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: C.serif,
    fontSize: 24,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12.5,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  scroll: {
    maxHeight: 280,
    marginVertical: 4,
  },
  scrollContent: {
    paddingVertical: 6,
  },
  pointsList: {
    gap: 14,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1b1b1e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 12,
    gap: 12,
  },
  pointIcon: {
    marginTop: 2,
  },
  pointTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 3,
  },
  pointBody: {
    fontSize: 11.5,
    color: '#a1a1aa',
    lineHeight: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
  },
  footer: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  ackBtn: {
    width: '100%',
    backgroundColor: C.orange,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.orange,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  ackBtnDisabled: {
    opacity: 0.6,
  },
  ackBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 0.3,
  },
  versionTag: {
    fontSize: 10,
    color: '#71717a',
    marginTop: 10,
    fontWeight: '500',
  },
});
