import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { checkSafeNutritionFloor } from '../lib/nutritionEngine';

const GOALS = ['muscle_hypertrophy','football_athlete','endurance_running','fat_loss_shred','clean_bulk','no_restriction','keto_adaptation','mediterranean_longevity','vegan_performance'];
const SPORTS = ['football','bodybuilding','crossfit','basketball','running','swimming','casual_fitness','hybrid_athlete'];
const TIMING = ['standard','intermittent_fasting','athlete_split'];

export default function DietSetupScreen({ userId, onSaved }) {
  const [form, setForm] = useState({
    primary_goal: 'no_restriction',
    sport: 'casual_fitness',
    calories: '', protein_grams: '', carbs_grams: '', fat_grams: '',
    sodium_mg_limit: '2300', water_liters: '3.0',
    dietary_restrictions: [], preferred_inclusions: [], excluded_ingredients: [],
    meal_frequency: '4', meal_timing_preference: 'standard',
  });
  const [safetyModal, setSafetyModal] = useState(null); // { reason, recommendation }
  const [disclaimerModal, setDisclaimerModal] = useState(false);
  const [disclaimerAcceptedAt, setDisclaimerAcceptedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('user_diet_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) { setErrorMsg(error.message); return; }
      if (data) {
        setForm({
          primary_goal: data.primary_goal,
          sport: data.sport,
          calories: String(data.calories),
          protein_grams: String(data.protein_grams),
          carbs_grams: String(data.carbs_grams),
          fat_grams: String(data.fat_grams),
          sodium_mg_limit: String(data.sodium_mg_limit),
          water_liters: String(data.water_liters),
          dietary_restrictions: data.dietary_restrictions || [],
          preferred_inclusions: data.preferred_inclusions || [],
          excluded_ingredients: data.excluded_ingredients || [],
          meal_frequency: String(data.meal_frequency),
          meal_timing_preference: data.meal_timing_preference,
        });
        setDisclaimerAcceptedAt(data.disclaimer_accepted_at || null);
      }
    })();
  }, [userId]);

  const buildPayload = () => ({
    user_id: userId,
    primary_goal: form.primary_goal,
    sport: form.sport,
    calories: Number(form.calories) || 0,
    protein_grams: Number(form.protein_grams) || 0,
    carbs_grams: Number(form.carbs_grams) || 0,
    fat_grams: Number(form.fat_grams) || 0,
    sodium_mg_limit: Number(form.sodium_mg_limit) || 2300,
    water_liters: Number(form.water_liters) || 3.0,
    dietary_restrictions: form.dietary_restrictions,
    preferred_inclusions: form.preferred_inclusions,
    excluded_ingredients: form.excluded_ingredients,
    meal_frequency: Number(form.meal_frequency) || 4,
    meal_timing_preference: form.meal_timing_preference,
    disclaimer_accepted_at: disclaimerAcceptedAt,
    updated_at: new Date().toISOString(),
  });

  const doSave = async (payload) => {
    setSaving(true);
    setErrorMsg(null);
    const { error } = await supabase
      .from('user_diet_preferences')
      .upsert(payload, { onConflict: 'user_id' });
    setSaving(false);
    if (error) { setErrorMsg(error.message); return; }
    onSaved?.();
  };

  const handleSubmit = () => {
    const payload = buildPayload();
    if (!disclaimerAcceptedAt) {
      setDisclaimerModal(true);
      return;
    }
    const safety = checkSafeNutritionFloor(payload.calories, payload.protein_grams, payload.primary_goal);

    if (!safety.isSafe) {
      setSafetyModal({ reason: safety.reason, recommendation: safety.recommendation, payload });
      return;
    }
    doSave(payload);
  };

  const acceptDisclaimer = async () => {
    const acceptedAt = new Date().toISOString();
    const { error } = await supabase.from('diet_disclaimer_audit_logs').insert({
      user_id: userId,
      terms_version: 'v1',
      consent_summary: 'User acknowledged general nutrition guidance is not medical advice.',
      accepted_at: acceptedAt,
    });
    if (error) { setErrorMsg(error.message); return; }
    setDisclaimerAcceptedAt(acceptedAt);
    setDisclaimerModal(false);
    const payload = { ...buildPayload(), disclaimer_accepted_at: acceptedAt };
    const safety = checkSafeNutritionFloor(payload.calories, payload.protein_grams, payload.primary_goal);
    if (!safety.isSafe) {
      setSafetyModal({ reason: safety.reason, recommendation: safety.recommendation, payload });
      return;
    }
    await doSave(payload);
  };

  const handleProceedAnyway = async () => {
    const { reason, recommendation, payload } = safetyModal;
    setSafetyModal(null);

    const { error: auditError } = await supabase.from('diet_disclaimer_audit_logs').insert({
      user_id: userId,
      terms_version: 'v1',
      consent_summary: `${reason} ${recommendation}`,
    });
    if (auditError) { setErrorMsg(auditError.message); return; }

    await doSave(payload);
  };

  const setField = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  return (
    <ScrollView style={styles.container}>
      {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

      <Text style={styles.label}>Primary Goal</Text>
      <View style={styles.chipRow}>
        {GOALS.map(g => (
          <TouchableOpacity key={g} onPress={() => setField('primary_goal', g)}
            style={[styles.chip, form.primary_goal === g && styles.chipActive]}>
            <Text style={form.primary_goal === g ? styles.chipTextActive : styles.chipText}>{g.replace(/_/g, ' ')}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Sport</Text>
      <View style={styles.chipRow}>
        {SPORTS.map(s => (
          <TouchableOpacity key={s} onPress={() => setField('sport', s)}
            style={[styles.chip, form.sport === s && styles.chipActive]}>
            <Text style={form.sport === s ? styles.chipTextActive : styles.chipText}>{s.replace(/_/g, ' ')}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Daily Macro Targets</Text>
      {['calories', 'protein_grams', 'carbs_grams', 'fat_grams'].map(field => (
        <TextInput
          key={field}
          style={styles.input}
          keyboardType="numeric"
          placeholder={field.replace(/_/g, ' ')}
          value={form[field]}
          onChangeText={v => setField(field, v)}
        />
      ))}

      <Text style={styles.label}>Food preferences</Text>
      {[
        ['dietary_restrictions', 'Restrictions (comma separated)'],
        ['preferred_inclusions', 'Preferred foods (comma separated)'],
        ['excluded_ingredients', 'Excluded ingredients (comma separated)'],
      ].map(([field, placeholder]) => (
        <TextInput
          key={field}
          style={styles.input}
          placeholder={placeholder}
          value={form[field].join(', ')}
          onChangeText={value => setField(field, value.split(',').map(item => item.trim()).filter(Boolean))}
        />
      ))}

      <TouchableOpacity style={styles.saveButton} onPress={handleSubmit} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Diet Setup'}</Text>
      </TouchableOpacity>

      <Modal visible={disclaimerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Before you continue</Text>
            <Text style={styles.modalBody}>This is general nutrition guidance, not medical advice.</Text>
            <Text style={styles.modalBody}>Talk to a doctor or dietitian before changing your eating pattern, especially if you have allergies, a condition, or are pregnant.</Text>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setDisclaimerModal(false)}>
              <Text style={styles.modalCancelText}>Go back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalProceed} onPress={acceptDisclaimer}>
              <Text style={styles.modalProceedText}>I understand and continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!safetyModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>This target may not be safe</Text>
            <Text style={styles.modalBody}>{safetyModal?.reason}</Text>
            <Text style={styles.modalBody}>{safetyModal?.recommendation}</Text>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setSafetyModal(null)}>
              <Text style={styles.modalCancelText}>Go back and adjust</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalProceed} onPress={handleProceedAnyway}>
              <Text style={styles.modalProceedText}>I understand, proceed anyway</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  error: { color: '#ef4444', marginBottom: 8 },
  label: { fontWeight: '700', marginTop: 16, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#334155', marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: '#10b981', borderColor: '#10b981' },
  chipText: { fontSize: 12, color: '#94a3b8' },
  chipTextActive: { fontSize: 12, color: '#020617', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 10, padding: 12, marginBottom: 10 },
  saveButton: { backgroundColor: '#10b981', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20, marginBottom: 40 },
  saveButtonText: { color: '#020617', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(2,6,23,0.8)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#0f172a', borderRadius: 16, padding: 20 },
  modalTitle: { fontWeight: '700', fontSize: 16, marginBottom: 8, color: '#f1f5f9' },
  modalBody: { color: '#94a3b8', marginBottom: 8 },
  modalCancel: { padding: 12, alignItems: 'center' },
  modalCancelText: { color: '#94a3b8' },
  modalProceed: { backgroundColor: '#ef4444', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
  modalProceedText: { color: '#fff', fontWeight: '700' },
});