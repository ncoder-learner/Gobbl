/**
 * RestrictiveDietModal
 *
 * Checkpoint modal triggered when a user selects a restrictive preset (e.g. Keto at 30g carbs)
 * or sets calories below the safe nutrition floor (< 1200 kcal).
 *
 * Explains the concern in neutral, non-prescriptive wording, recommends consulting a
 * physician or registered dietitian, and requires an explicit tap on "I understand, continue".
 * Logs the restrictive diet acknowledgment to diet_disclaimer_audit_logs.
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { THEME as C } from '../lib/theme';
import { CURRENT_DISCLAIMER_VERSION } from './HealthDisclaimerModal';

export default function RestrictiveDietModal({
  visible,
  userId,
  concerns = [],
  recommendation,
  onConfirm,
  onCancel,
}) {
  const insets = useSafeAreaInsets();
  const [logging, setLogging] = useState(false);

  if (!visible) return null;

  const handleConfirm = async () => {
    setLogging(true);
    try {
      let uid = userId;
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser();
        uid = user?.id || null;
      }

      if (uid) {
        const summary = `Restrictive diet acknowledged: ${concerns.join('; ')}`;
        await supabase
          .from('diet_disclaimer_audit_logs')
          .insert({
            user_id: uid,
            terms_version: CURRENT_DISCLAIMER_VERSION,
            consent_summary: summary.slice(0, 500),
            accepted_at: new Date().toISOString(),
          });
      }

      onConfirm && onConfirm();
    } catch (err) {
      console.warn('[RestrictiveDietModal] Audit logging error:', err);
      // Proceed on error so user is not stuck
      onConfirm && onConfirm();
    } finally {
      setLogging(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: Math.max(20, insets.bottom + 12) }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="alert-circle" size={26} color={C.gold} />
            </View>
            <Text style={styles.title}>Nutrition Checkpoint</Text>
            <Text style={styles.subtitle}>
              Review important guidance regarding your chosen dietary configuration.
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Concern Notice */}
            <View style={styles.concernsBox}>
              <Text style={styles.sectionHeader}>SPECIFIC CONSIDERATIONS</Text>
              {concerns.map((item, idx) => (
                <View key={idx} style={styles.concernRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.concernText}>{item}</Text>
                </View>
              ))}
            </View>

            {/* Informational Guidance */}
            <View style={styles.guidanceBox}>
              <Ionicons name="medical-outline" size={18} color="#30d158" style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.guidanceTitle}>Professional Guidance Recommended</Text>
                <Text style={styles.guidanceBody}>
                  {recommendation || 'Consult a physician or registered dietitian before adopting ultra-low calorie or significant elimination diets.'}
                </Text>
                <Text style={[styles.guidanceBody, { marginTop: 6 }]}>
                  Severe caloric restriction or eliminating major macronutrient groups can impact daily energy, metabolic balance, and micronutrient adequacy.
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* Action buttons */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.confirmBtn, logging && styles.btnDisabled]}
              onPress={handleConfirm}
              disabled={logging}
              activeOpacity={0.85}
            >
              {logging ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.confirmBtnText}>I Understand, Continue</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.adjustBtn}
              onPress={onCancel}
              disabled={logging}
              activeOpacity={0.7}
            >
              <Text style={styles.adjustBtnText}>Go Back & Adjust Targets</Text>
            </TouchableOpacity>
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
    backgroundColor: 'rgba(233, 184, 114, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(233, 184, 114, 0.35)',
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
    maxHeight: 260,
    marginVertical: 4,
  },
  scrollContent: {
    paddingVertical: 4,
    gap: 12,
  },
  concernsBox: {
    backgroundColor: '#1b1b1e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(233, 184, 114, 0.25)',
    padding: 14,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: C.gold,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  concernRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  bullet: {
    color: C.gold,
    fontSize: 14,
    lineHeight: 16,
  },
  concernText: {
    flex: 1,
    fontSize: 12,
    color: '#e4e4e7',
    lineHeight: 17,
  },
  guidanceBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#161d18',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.25)',
    padding: 14,
    gap: 12,
  },
  guidanceTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 3,
  },
  guidanceBody: {
    fontSize: 11.5,
    color: '#a1a1aa',
    lineHeight: 16,
  },
  footer: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    gap: 10,
  },
  confirmBtn: {
    width: '100%',
    backgroundColor: C.gold,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.gold,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 0.2,
  },
  adjustBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  adjustBtnText: {
    fontSize: 12.5,
    color: '#a1a1aa',
    fontWeight: '600',
  },
});
