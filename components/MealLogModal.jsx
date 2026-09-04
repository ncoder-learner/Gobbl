import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, useSafeAreaInsets, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { localDateKey } from '../lib/dateKey';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout'];

export default function MealLogModal({ userId, onSaved, onClose }) {
  const insets = useSafeAreaInsets();
  const [mealType, setMealType] = useState('lunch');
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [sodiumMg, setSodiumMg] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !calories) {
      setError('Name and calories are required.');
      return;
    }
    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from('diet_meal_logs').insert({
      user_id: userId,
      name: name.trim(),
      meal_type: mealType,
      logged_at: new Date().toISOString(),
      date_key: localDateKey(new Date()),
      calories: Number(calories) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fat: Number(fat) || 0,
      sodium_mg: Number(sodiumMg) || 0,
    });

    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    onSaved?.();
    onClose?.();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardLayer}
    >
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.chipRow}>
            {MEAL_TYPES.map(t => (
              <TouchableOpacity key={t} onPress={() => setMealType(t)}
                style={[styles.chip, mealType === t && styles.chipActive]}>
                <Text style={mealType === t ? styles.chipTextActive : styles.chipText}>{t.replace('_', ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} placeholder="Meal name" value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Calories" keyboardType="numeric" value={calories} onChangeText={setCalories} />
          <TextInput style={styles.input} placeholder="Protein (g)" keyboardType="numeric" value={protein} onChangeText={setProtein} />
          <TextInput style={styles.input} placeholder="Carbs (g)" keyboardType="numeric" value={carbs} onChangeText={setCarbs} />
          <TextInput style={styles.input} placeholder="Fat (g)" keyboardType="numeric" value={fat} onChangeText={setFat} />
          <TextInput style={styles.input} placeholder="Sodium (mg)" keyboardType="numeric" value={sodiumMg} onChangeText={setSodiumMg} />
          <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Log Meal'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardLayer: { maxHeight: '88%' },
  container: { padding: 16, backgroundColor: '#0f172a', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  content: { paddingBottom: 4 },
  error: { color: '#ef4444', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#334155' },
  chipActive: { backgroundColor: '#10b981', borderColor: '#10b981' },
  chipText: { fontSize: 12, color: '#94a3b8' },
  chipTextActive: { fontSize: 12, color: '#020617', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 10, padding: 12, marginBottom: 10, color: '#f1f5f9' },
  saveButton: { backgroundColor: '#10b981', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 6 },
  saveButtonText: { color: '#020617', fontWeight: '700' },
});