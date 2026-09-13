import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useSafeAreaInsets,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { localDateKey } from '../lib/dateKey';
import { THEME as C } from '../lib/theme';

const MEAL_TYPES = [
  { id: 'breakfast', label: 'Breakfast', icon: 'sunny-outline' },
  { id: 'lunch', label: 'Lunch', icon: 'restaurant-outline' },
  { id: 'dinner', label: 'Dinner', icon: 'moon-outline' },
  { id: 'snack', label: 'Snack', icon: 'cafe-outline' },
  { id: 'pre_workout', label: 'Pre-Workout', icon: 'flash-outline' },
  { id: 'post_workout', label: 'Post-Workout', icon: 'barbell-outline' },
];

const QUICK_PRESETS = [
  { name: 'Protein Shake', type: 'post_workout', calories: 240, protein: 30, carbs: 8, fat: 3 },
  { name: 'Light Snack', type: 'snack', calories: 180, protein: 6, carbs: 22, fat: 8 },
  { name: 'Balanced Meal', type: 'lunch', calories: 550, protein: 42, carbs: 55, fat: 16 },
  { name: 'Black Coffee / Tea', type: 'breakfast', calories: 15, protein: 0, carbs: 2, fat: 0 },
];

export default function MealLogModal({ userId, onSaved, onClose }) {
  const insets = useSafeAreaInsets();
  const [mealType, setMealType] = useState('lunch');
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const applyPreset = (preset) => {
    setName(preset.name);
    setMealType(preset.type);
    setCalories(String(preset.calories));
    setProtein(String(preset.protein));
    setCarbs(String(preset.carbs));
    setFat(String(preset.fat));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a meal description.');
      return;
    }
    if (!calories || isNaN(Number(calories)) || Number(calories) < 0) {
      setError('Please enter valid calories.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let uid = userId;
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser();
        uid = user?.id || null;
      }

      if (!uid) {
        setError('Please sign in to log meals.');
        setSaving(false);
        return;
      }

      const now = new Date();
      const { error: insertError } = await supabase.from('diet_meal_logs').insert({
        user_id: uid,
        name: name.trim(),
        meal_type: mealType,
        logged_at: now.toISOString(),
        date_key: localDateKey(now),
        calories: Math.round(Number(calories) || 0),
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
        sodium_mg: 0,
      });

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }

      setSaving(false);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardLayer}
    >
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 18) }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Ionicons name="nutrition-outline" size={18} color={C.orange} />
            </View>
            <Text style={styles.title}>Quick Meal Log</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={18} color={C.gray1} />
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={C.red} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Quick Presets */}
          <Text style={styles.sectionLabel}>QUICK PRESETS</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetRow}
          >
            {QUICK_PRESETS.map((preset, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.presetChip}
                onPress={() => applyPreset(preset)}
                activeOpacity={0.7}
              >
                <Text style={styles.presetName}>{preset.name}</Text>
                <Text style={styles.presetSub}>{preset.calories} kcal · {preset.protein}g P</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Meal Type Selector */}
          <Text style={styles.sectionLabel}>MEAL CATEGORY</Text>
          <View style={styles.typeGrid}>
            {MEAL_TYPES.map((t) => {
              const active = mealType === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setMealType(t.id)}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={t.icon}
                    size={15}
                    color={active ? C.orange : C.gray2}
                  />
                  <Text style={[styles.typeText, active && styles.typeTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Meal Name Input */}
          <Text style={styles.sectionLabel}>ITEM NAME</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="create-outline" size={18} color={C.gray2} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Grilled Chicken & Quinoa"
              placeholderTextColor={C.gray3}
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Calories and Macros Grid */}
          <View style={styles.macrosRow}>
            {/* Calories */}
            <View style={styles.macroBox}>
              <Text style={[styles.macroBoxLabel, { color: C.orange }]}>Calories</Text>
              <TextInput
                style={[styles.macroBoxInput, { color: C.orange }]}
                placeholder="0"
                placeholderTextColor={C.gray4}
                keyboardType="numeric"
                value={calories}
                onChangeText={setCalories}
              />
              <Text style={styles.macroBoxUnit}>kcal</Text>
            </View>

            {/* Protein */}
            <View style={styles.macroBox}>
              <Text style={[styles.macroBoxLabel, { color: '#30d158' }]}>Protein</Text>
              <TextInput
                style={[styles.macroBoxInput, { color: '#30d158' }]}
                placeholder="0"
                placeholderTextColor={C.gray4}
                keyboardType="numeric"
                value={protein}
                onChangeText={setProtein}
              />
              <Text style={styles.macroBoxUnit}>g</Text>
            </View>

            {/* Carbs */}
            <View style={styles.macroBox}>
              <Text style={[styles.macroBoxLabel, { color: '#f5a524' }]}>Carbs</Text>
              <TextInput
                style={[styles.macroBoxInput, { color: '#f5a524' }]}
                placeholder="0"
                placeholderTextColor={C.gray4}
                keyboardType="numeric"
                value={carbs}
                onChangeText={setCarbs}
              />
              <Text style={styles.macroBoxUnit}>g</Text>
            </View>

            {/* Fat */}
            <View style={styles.macroBox}>
              <Text style={[styles.macroBoxLabel, { color: '#ff6321' }]}>Fat</Text>
              <TextInput
                style={[styles.macroBoxInput, { color: '#ff6321' }]}
                placeholder="0"
                placeholderTextColor={C.gray4}
                keyboardType="numeric"
                value={fat}
                onChangeText={setFat}
              />
              <Text style={styles.macroBoxUnit}>g</Text>
            </View>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.saveButtonText}>Log Meal Now ✓</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardLayer: {
    maxHeight: '90%',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 18,
    backgroundColor: '#141416',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#27272a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#202024',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2e180d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 22,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1f1f23',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingTop: 14,
    paddingBottom: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    flex: 1,
  },
  sectionLabel: {
    color: C.gold,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 6,
    marginBottom: 8,
  },
  presetRow: {
    gap: 8,
    paddingBottom: 12,
  },
  presetChip: {
    backgroundColor: '#1c1c20',
    borderWidth: 1,
    borderColor: '#2e2e34',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  presetName: {
    color: C.white,
    fontSize: 12,
    fontWeight: '700',
  },
  presetSub: {
    color: C.gray2,
    fontSize: 10,
    marginTop: 2,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1c1c20',
    borderWidth: 1,
    borderColor: '#2e2e34',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typeChipActive: {
    backgroundColor: '#2e180d',
    borderColor: C.orange,
  },
  typeText: {
    color: C.gray2,
    fontSize: 12,
    fontWeight: '600',
  },
  typeTextActive: {
    color: C.orange,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: C.white,
    fontSize: 14,
    paddingVertical: 12,
  },
  macrosRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  macroBox: {
    flex: 1,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    padding: 10,
    alignItems: 'center',
  },
  macroBoxLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  macroBoxInput: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    padding: 0,
    width: '100%',
  },
  macroBoxUnit: {
    color: C.gray3,
    fontSize: 10,
    marginTop: 2,
  },
  saveButton: {
    backgroundColor: C.orange,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: C.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});