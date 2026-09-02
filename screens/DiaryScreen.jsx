import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { localDateKey } from '../lib/dateKey';
import { computeWeeklyInsights } from '../lib/nutritionEngine';
import { filterDietTemplatesForUser, getDietSuggestionCopy } from '../lib/dietTemplates';
import DietSetupScreen from './DietSetupScreen';
import MealLogModal from '../components/MealLogModal';
import { THEME as C } from '../lib/theme';

export default function DiaryScreen() {
  const [userId, setUserId] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [todayMeals, setTodayMeals] = useState([]);
  const [weekMeals, setWeekMeals] = useState([]);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) { setError(authError.message); setLoading(false); return; }
    if (!user) { setLoading(false); return; }
    setUserId(user.id);
    const today = localDateKey(new Date());
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const [prefsResult, todayResult, weekResult, cameraMealsResult] = await Promise.all([
      supabase.from('user_diet_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('diet_meal_logs').select('*').eq('user_id', user.id).eq('date_key', today).order('logged_at'),
      supabase.from('diet_meal_logs').select('*').eq('user_id', user.id).gte('logged_at', sevenDaysAgo.toISOString()),
      supabase.from('meals').select('id, name, created_at, calories, protein_g, carbs_g, fat_g, sodium_mg, tag').eq('user_id', user.id).gte('created_at', sevenDaysAgo.toISOString()).order('created_at'),
    ]);

    if (prefsResult.error || todayResult.error || weekResult.error || cameraMealsResult.error) {
      setError((prefsResult.error || todayResult.error || weekResult.error || cameraMealsResult.error).message);
    }
    const prefs = prefsResult.data;
    const dietTodays = todayResult.data || [];
    const dietWeek = weekResult.data || [];
    const cameraMeals = cameraMealsResult.data || [];
    const cameraToday = cameraMeals.filter(meal => localDateKey(new Date(meal.created_at)) === today).map(meal => ({
      ...meal,
      meal_type: meal.tag || 'meal',
      calories: meal.calories || 0,
      protein: meal.protein_g || 0,
      carbs: meal.carbs_g || 0,
      fat: meal.fat_g || 0,
      sodium_mg: meal.sodium_mg || 0,
    }));
    const cameraWeek = cameraMeals.map(meal => ({
      ...meal,
      date_key: localDateKey(new Date(meal.created_at)),
      calories: meal.calories || 0,
      protein: meal.protein_g || 0,
      carbs: meal.carbs_g || 0,
      fat: meal.fat_g || 0,
      sodium_mg: meal.sodium_mg || 0,
    }));
    const todays = [...dietTodays, ...cameraToday];
    const week = [...dietWeek, ...cameraWeek];
    setPreferences(prefs || null);
    setTodayMeals(todays);
    setWeekMeals(week);
    setInsights(prefs ? computeWeeklyInsights(week, prefs) : null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = todayMeals.reduce((acc, m) => ({
    calories: acc.calories + Number(m.calories || 0),
    protein: acc.protein + Number(m.protein || 0),
    carbs: acc.carbs + Number(m.carbs || 0),
    fat: acc.fat + Number(m.fat || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#10b981" /></View>;
  }

  const templates = filterDietTemplatesForUser({
    inclusions: [...(preferences?.preferred_inclusions || []), ...(preferences?.dietary_restrictions || [])],
    exclusions: preferences?.excluded_ingredients || [],
  });
  const suggestionCopy = getDietSuggestionCopy();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Health</Text>
          <Text style={styles.subtitle}>A clearer read on your week</Text>
        </View>
        {preferences && (
          <TouchableOpacity style={styles.editButton} onPress={() => setSetupOpen(true)}>
            <Text style={styles.editButtonText}>Edit setup</Text>
          </TouchableOpacity>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {!preferences ? (
        <View style={styles.setupCard}>
          <Text style={styles.setupTitle}>Build your nutrition baseline</Text>
          <Text style={styles.setupBody}>Set goals and boundaries first. You stay in control of every suggestion.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setSetupOpen(true)}>
            <Text style={styles.primaryButtonText}>Set up health</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.totalsCard}>
            <Text style={styles.cardEyebrow}>TODAY</Text>
            <Text style={styles.totalsText}>{totals.calories} / {preferences.calories} kcal</Text>
            <Text style={styles.totalsSubText}>P {totals.protein}/{preferences.protein_grams}g  ·  C {totals.carbs}/{preferences.carbs_grams}g  ·  F {totals.fat}/{preferences.fat_grams}g</Text>
            <TouchableOpacity style={styles.logButton} onPress={() => setLogOpen(true)}>
              <Text style={styles.logButtonText}>Log a meal</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.suggestionCard}>
            <Text style={styles.cardEyebrow}>{suggestionCopy.title.toUpperCase()}</Text>
            <Text style={styles.suggestionTitle}>{templates[0]?.name || 'Balanced everyday'}</Text>
            <Text style={styles.suggestionBody}>{templates[0]?.description || 'A moderate template for general maintenance and routine energy.'}</Text>
            <Text style={styles.disclaimer}>{suggestionCopy.disclaimer[0]}</Text>
          </View>
        </>
      )}

      {preferences && <Text style={styles.sectionTitle}>Today&apos;s meals</Text>}
      {preferences && <FlatList
        data={todayMeals}
        keyExtractor={m => m.id}
        renderItem={({ item }) => (
          <View style={styles.mealRow}>
            <Text style={styles.mealName}>{item.name}</Text>
            <Text style={styles.mealMacros}>{item.calories} kcal · {item.meal_type}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No meals logged today.</Text>}
      />}

      {insights && (
        <View style={styles.insightsCard}>
          <Text style={styles.cardEyebrow}>LAST 7 DAYS</Text>
          <Text style={styles.insightsTitle}>Weekly insights</Text>
          <Text style={styles.insightsBody}>{insights.topDeficiencyInsight}</Text>
          <Text style={styles.insightsStat}>Recovery {insights.recoveryScore} · Stamina {insights.staminaScore} · Sodium {insights.avgDailySodiumMg}mg/day</Text>
        </View>
      )}

      <Modal visible={setupOpen} animationType="slide" onRequestClose={() => setSetupOpen(false)}>
        <DietSetupScreen userId={userId} onSaved={() => { setSetupOpen(false); load(); }} />
      </Modal>
      <Modal visible={logOpen} transparent animationType="slide" onRequestClose={() => setLogOpen(false)}>
        <View style={styles.modalOverlay}>
          <MealLogModal userId={userId} onSaved={load} onClose={() => setLogOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 18, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  title: { color: C.white, fontFamily: C.serif, fontSize: 34 },
  subtitle: { color: C.gray2, marginTop: 3 },
  editButton: { borderWidth: 1, borderColor: C.border, borderRadius: C.pill, paddingHorizontal: 14, paddingVertical: 8 },
  editButtonText: { color: C.gray1, fontWeight: '600' },
  error: { color: C.red, marginBottom: 12 },
  setupCard: { backgroundColor: C.glassBg, borderColor: C.glassBorder, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 18 },
  setupTitle: { color: C.white, fontFamily: C.serif, fontSize: 23, marginBottom: 8 },
  setupBody: { color: C.gray1, lineHeight: 20, marginBottom: 16 },
  primaryButton: { backgroundColor: C.orange, borderRadius: C.pill, padding: 14, alignItems: 'center' },
  primaryButtonText: { color: C.bg, fontWeight: '800' },
  cardEyebrow: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  totalsCard: { backgroundColor: C.glassBg, borderColor: C.glassBorder, borderWidth: 1, borderRadius: 18, padding: 17, marginBottom: 12 },
  totalsText: { fontFamily: C.serif, fontSize: 27, color: C.white },
  totalsSubText: { color: C.gray1, marginTop: 5, fontSize: 12 },
  logButton: { alignSelf: 'flex-start', backgroundColor: C.orange, borderRadius: C.pill, paddingHorizontal: 15, paddingVertical: 10, marginTop: 15 },
  logButtonText: { color: C.bg, fontWeight: '800' },
  suggestionCard: { backgroundColor: '#201b14', borderColor: '#5b4225', borderWidth: 1, borderRadius: 18, padding: 17, marginBottom: 17 },
  suggestionTitle: { color: C.white, fontFamily: C.serif, fontSize: 22, marginBottom: 6 },
  suggestionBody: { color: C.gray1, lineHeight: 20 },
  disclaimer: { color: C.gray3, fontSize: 11, marginTop: 12 },
  sectionTitle: { color: C.white, fontFamily: C.serif, fontSize: 22, marginBottom: 4 },
  mealRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  mealName: { color: C.white, fontWeight: '600', flex: 1 },
  mealMacros: { color: C.gray1, fontSize: 12 },
  empty: { color: C.gray2, textAlign: 'center', marginTop: 20 },
  insightsCard: { backgroundColor: C.glassBg, borderColor: C.glassBorder, borderWidth: 1, borderRadius: 18, padding: 17, marginTop: 16 },
  insightsTitle: { fontFamily: C.serif, fontSize: 22, color: C.white, marginBottom: 6 },
  insightsBody: { color: C.gray1, marginBottom: 6 },
  insightsStat: { color: C.green, fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
});