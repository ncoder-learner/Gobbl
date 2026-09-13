import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { THEME as C } from '../lib/theme';

export const GOAL_OPTIONS = [
  {
    id: 'maintenance',
    label: 'Maintenance & Energy',
    icon: 'flash-outline',
    subtitle: 'Balanced caloric fuel for daily energy and steady performance',
    defaults: { calories: 2200, protein: 120, carbs: 250, fat: 70, water: 3.0, sodium: 2300 },
  },
  {
    id: 'muscle_gain',
    label: 'Build Muscle',
    icon: 'barbell-outline',
    subtitle: 'High-protein surplus to power strength, hypertrophy, and recovery',
    defaults: { calories: 2600, protein: 160, carbs: 300, fat: 80, water: 3.5, sodium: 2400 },
  },
  {
    id: 'weight_loss',
    label: 'Lean / Deficit',
    icon: 'trending-down-outline',
    subtitle: 'Targeted caloric deficit optimized to shed fat while preserving lean muscle',
    defaults: { calories: 1800, protein: 140, carbs: 160, fat: 55, water: 3.0, sodium: 2000 },
  },
  {
    id: 'keto',
    label: 'Keto / Low Carb',
    icon: 'leaf-outline',
    subtitle: 'High healthy fats, moderate protein, and ultra-low carbohydrate intake',
    defaults: { calories: 2000, protein: 120, carbs: 30, fat: 155, water: 3.5, sodium: 2500 },
  },
  {
    id: 'clean_eating',
    label: 'Clean & Balanced',
    icon: 'nutrition-outline',
    subtitle: 'Nutrient-rich whole foods, high micronutrient density, and mindful portions',
    defaults: { calories: 2100, protein: 110, carbs: 240, fat: 65, water: 3.0, sodium: 2000 },
  },
  {
    id: 'no_restriction',
    label: 'Flexible Tracking',
    icon: 'infinite-outline',
    subtitle: 'Track macros and calories with full freedom across all food types',
    defaults: { calories: 2200, protein: 100, carbs: 250, fat: 70, water: 3.0, sodium: 2300 },
  },
];

export const RESTRICTION_OPTIONS = [
  { id: 'gluten_free', label: 'Gluten-Free', icon: 'shield-checkmark-outline' },
  { id: 'dairy_free', label: 'Dairy-Free', icon: 'water-outline' },
  { id: 'nut_free', label: 'Nut Allergy', icon: 'alert-circle-outline' },
  { id: 'vegetarian', label: 'Vegetarian', icon: 'leaf-outline' },
  { id: 'vegan', label: 'Vegan', icon: 'flower-outline' },
  { id: 'halal', label: 'Halal', icon: 'moon-outline' },
  { id: 'kosher', label: 'Kosher', icon: 'star-outline' },
  { id: 'none', label: 'No Restrictions', icon: 'checkmark-circle-outline' },
];

export default function DietSetupScreen({ userId, onSaved, onClose }) {
  const { width } = useWindowDimensions();
  const compact = width < 380;

  const [resolvedUserId, setResolvedUserId] = useState(userId || null);
  const [step, setStep] = useState(1); // 1: Goal, 2: Restrictions, 3: Daily Target Presets
  const [selectedGoal, setSelectedGoal] = useState('maintenance');
  const [selectedRestrictions, setSelectedRestrictions] = useState([]);
  const [calories, setCalories] = useState('2200');
  const [protein, setProtein] = useState('120');
  const [carbs, setCarbs] = useState('250');
  const [fat, setFat] = useState('70');
  const [water, setWater] = useState('3.0');
  const [sodium, setSodium] = useState('2300');

  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        let uid = userId;
        if (!uid) {
          const { data: { user } } = await supabase.auth.getUser();
          uid = user?.id || null;
          if (isMounted) setResolvedUserId(uid);
        }

        if (!uid) {
          if (isMounted) setInitialLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('user_diet_preferences')
          .select('*')
          .eq('user_id', uid)
          .maybeSingle();

        if (error) {
          // Non-fatal, fallback to default presets
          console.log('Error fetching user_diet_preferences:', error.message);
        }

        if (data && isMounted) {
          setSelectedGoal(data.primary_goal || 'maintenance');
          setSelectedRestrictions(data.dietary_restrictions || data.inclusions || []);
          setCalories(String(data.calories || data.target_calories || 2200));
          setProtein(String(data.protein_grams || data.target_protein_g || 120));
          setCarbs(String(data.carbs_grams || 250));
          setFat(String(data.fat_grams || 70));
          setWater(String(data.water_liters || 3.0));
          setSodium(String(data.sodium_mg_limit || data.target_sodium_mg || 2300));
        }
      } catch (err) {
        console.log('Error in DietSetupScreen init:', err);
      } finally {
        if (isMounted) setInitialLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [userId]);

  const handleSelectGoal = (goalId) => {
    setSelectedGoal(goalId);
    const goalObj = GOAL_OPTIONS.find((g) => g.id === goalId);
    if (goalObj?.defaults) {
      setCalories(String(goalObj.defaults.calories));
      setProtein(String(goalObj.defaults.protein));
      setCarbs(String(goalObj.defaults.carbs));
      setFat(String(goalObj.defaults.fat));
      setWater(String(goalObj.defaults.water));
      setSodium(String(goalObj.defaults.sodium));
    }
  };

  const toggleRestriction = (restId) => {
    if (restId === 'none') {
      setSelectedRestrictions([]);
      return;
    }
    setSelectedRestrictions((prev) => {
      const filtered = prev.filter((r) => r !== 'none');
      if (filtered.includes(restId)) {
        return filtered.filter((r) => r !== restId);
      } else {
        return [...filtered, restId];
      }
    });
  };

  const adjustValue = (setter, currentStr, delta, min = 0, stepSize = 1) => {
    const curr = Number(currentStr) || 0;
    const next = Math.max(min, curr + delta);
    if (stepSize < 1) {
      setter(next.toFixed(1));
    } else {
      setter(String(Math.round(next)));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);

    try {
      let uid = resolvedUserId;
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser();
        uid = user?.id || null;
      }

      if (!uid) {
        setErrorMsg('Please sign in to save your diet preferences.');
        setSaving(false);
        return;
      }

      const numCal = Math.max(800, Number(calories) || 2200);
      const numProtein = Math.max(20, Number(protein) || 120);
      const numCarbs = Math.max(0, Number(carbs) || 200);
      const numFat = Math.max(10, Number(fat) || 60);
      const numWater = Math.max(0.5, Number(water) || 3.0);
      const numSodium = Math.max(500, Number(sodium) || 2300);
      const nowIso = new Date().toISOString();

      // Send both current schema and legacy schema columns to ensure 100% save success
      const payload = {
        user_id: uid,
        primary_goal: selectedGoal,
        calories: numCal,
        target_calories: numCal,
        protein_grams: numProtein,
        target_protein_g: numProtein,
        carbs_grams: numCarbs,
        fat_grams: numFat,
        water_liters: numWater,
        sodium_mg_limit: numSodium,
        target_sodium_mg: numSodium,
        dietary_restrictions: selectedRestrictions,
        inclusions: selectedRestrictions,
        disclaimer_accepted_at: nowIso,
        updated_at: nowIso,
      };

      const { error } = await supabase
        .from('user_diet_preferences')
        .upsert(payload, { onConflict: 'user_id' });

      if (error) {
        // If some column didn't exist in older migration, try with standard subset
        const fallbackPayload = {
          user_id: uid,
          primary_goal: selectedGoal,
          calories: numCal,
          protein_grams: numProtein,
          carbs_grams: numCarbs,
          fat_grams: numFat,
          water_liters: numWater,
          sodium_mg_limit: numSodium,
          dietary_restrictions: selectedRestrictions,
          updated_at: nowIso,
        };
        const { error: fallbackError } = await supabase
          .from('user_diet_preferences')
          .upsert(fallbackPayload, { onConflict: 'user_id' });

        if (fallbackError) {
          setErrorMsg(fallbackError.message);
          setSaving(false);
          return;
        }
      }

      setSaving(false);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to save diet preferences.');
      setSaving(false);
    }
  };

  if (initialLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.orange} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Bar with Step Indicators */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.navIconBtn}
          onPress={() => (step > 1 ? setStep(step - 1) : onClose?.())}
          activeOpacity={0.7}
        >
          <Ionicons
            name={step > 1 ? 'chevron-back' : 'close'}
            size={20}
            color={C.white}
          />
        </TouchableOpacity>

        <View style={styles.stepIndicatorRow}>
          {[1, 2, 3].map((s) => (
            <View
              key={s}
              style={[
                styles.stepDot,
                step === s && styles.stepDotActive,
                step > s && styles.stepDotCompleted,
              ]}
            />
          ))}
        </View>

        {onClose ? (
          <TouchableOpacity style={styles.skipBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.skipBtnText}>Close</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {errorMsg && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color={C.red} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* STEP 1: PRIMARY GOAL */}
        {step === 1 && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEyebrow}>STEP 1 OF 3</Text>
            <Text style={styles.stepTitle}>Primary Health Goal</Text>
            <Text style={styles.stepSubtitle}>
              Select your nutritional focus to calculate your daily energy budget and macro ratio.
            </Text>

            <View style={styles.goalList}>
              {GOAL_OPTIONS.map((g) => {
                const isActive = selectedGoal === g.id;
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.goalCard, isActive && styles.goalCardActive]}
                    onPress={() => handleSelectGoal(g.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.goalCardLeft}>
                      <View style={[styles.goalIconWrap, isActive && styles.goalIconWrapActive]}>
                        <Ionicons
                          name={g.icon}
                          size={22}
                          color={isActive ? C.orange : C.gray1}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.goalLabel, isActive && styles.goalLabelActive]}>
                          {g.label}
                        </Text>
                        <Text style={styles.goalSub}>{g.subtitle}</Text>
                      </View>
                    </View>
                    <View style={[styles.radioCircle, isActive && styles.radioCircleActive]}>
                      {isActive && <View style={styles.radioInner} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setStep(2)}
              activeOpacity={0.85}
            >
              <Text style={styles.actionButtonText}>Next: Allergens & Diet →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STEP 2: DIETARY RESTRICTIONS */}
        {step === 2 && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEyebrow}>STEP 2 OF 3</Text>
            <Text style={styles.stepTitle}>Dietary Preferences & Allergens</Text>
            <Text style={styles.stepSubtitle}>
              Choose any diet boundaries or food allergies to filter recommendations.
            </Text>

            <View style={styles.chipGrid}>
              {RESTRICTION_OPTIONS.map((r) => {
                const isSelected =
                  r.id === 'none'
                    ? selectedRestrictions.length === 0
                    : selectedRestrictions.includes(r.id);
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.restrictionChip, isSelected && styles.restrictionChipActive]}
                    onPress={() => toggleRestriction(r.id)}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={r.icon}
                      size={16}
                      color={isSelected ? '#30d158' : C.gray2}
                    />
                    <Text
                      style={[
                        styles.restrictionText,
                        isSelected && styles.restrictionTextActive,
                      ]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setStep(3)}
              activeOpacity={0.85}
            >
              <Text style={styles.actionButtonText}>Next: Review Daily Targets →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STEP 3: PRESETS & FINE TUNING */}
        {step === 3 && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepEyebrow}>STEP 3 OF 3</Text>
            <Text style={styles.stepTitle}>Daily Nutrition Targets</Text>
            <Text style={styles.stepSubtitle}>
              Tailored for {GOAL_OPTIONS.find((g) => g.id === selectedGoal)?.label || 'your goal'}. Adjust any metric to match your routine.
            </Text>

            {/* Calorie Budget Card */}
            <View style={styles.targetCard}>
              <View style={styles.targetHeader}>
                <View style={styles.targetIconWrap}>
                  <Ionicons name="flame-outline" size={20} color={C.orange} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.targetTitle}>Calorie Budget</Text>
                  <Text style={styles.targetHint}>Target daily energy intake</Text>
                </View>
                <View style={styles.targetValueWrap}>
                  <TextInput
                    style={styles.targetInput}
                    keyboardType="numeric"
                    value={calories}
                    onChangeText={setCalories}
                  />
                  <Text style={styles.targetUnit}>kcal</Text>
                </View>
              </View>
              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => adjustValue(setCalories, calories, -50, 800)}
                >
                  <Text style={styles.stepperBtnText}>-50</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => adjustValue(setCalories, calories, +50)}
                >
                  <Text style={styles.stepperBtnText}>+50</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => adjustValue(setCalories, calories, +100)}
                >
                  <Text style={styles.stepperBtnText}>+100</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Macro Breakdown */}
            <View style={styles.macrosCard}>
              <Text style={styles.macrosCardTitle}>MACRONUTRIENT DISTRIBUTION</Text>

              {/* Protein */}
              <View style={styles.macroRow}>
                <View style={[styles.macroDot, { backgroundColor: '#30d158' }]} />
                <Text style={styles.macroName}>Protein</Text>
                <View style={styles.macroInputWrap}>
                  <TextInput
                    style={styles.macroInput}
                    keyboardType="numeric"
                    value={protein}
                    onChangeText={setProtein}
                  />
                  <Text style={styles.macroUnit}>g</Text>
                </View>
                <View style={styles.miniStepperRow}>
                  <TouchableOpacity
                    style={styles.miniStepBtn}
                    onPress={() => adjustValue(setProtein, protein, -5, 20)}
                  >
                    <Ionicons name="remove" size={14} color={C.gray1} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.miniStepBtn}
                    onPress={() => adjustValue(setProtein, protein, +5)}
                  >
                    <Ionicons name="add" size={14} color={C.gray1} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Carbs */}
              <View style={styles.macroRow}>
                <View style={[styles.macroDot, { backgroundColor: '#f5a524' }]} />
                <Text style={styles.macroName}>Carbohydrates</Text>
                <View style={styles.macroInputWrap}>
                  <TextInput
                    style={styles.macroInput}
                    keyboardType="numeric"
                    value={carbs}
                    onChangeText={setCarbs}
                  />
                  <Text style={styles.macroUnit}>g</Text>
                </View>
                <View style={styles.miniStepperRow}>
                  <TouchableOpacity
                    style={styles.miniStepBtn}
                    onPress={() => adjustValue(setCarbs, carbs, -5, 0)}
                  >
                    <Ionicons name="remove" size={14} color={C.gray1} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.miniStepBtn}
                    onPress={() => adjustValue(setCarbs, carbs, +5)}
                  >
                    <Ionicons name="add" size={14} color={C.gray1} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Fat */}
              <View style={styles.macroRow}>
                <View style={[styles.macroDot, { backgroundColor: '#ff6321' }]} />
                <Text style={styles.macroName}>Fats</Text>
                <View style={styles.macroInputWrap}>
                  <TextInput
                    style={styles.macroInput}
                    keyboardType="numeric"
                    value={fat}
                    onChangeText={setFat}
                  />
                  <Text style={styles.macroUnit}>g</Text>
                </View>
                <View style={styles.miniStepperRow}>
                  <TouchableOpacity
                    style={styles.miniStepBtn}
                    onPress={() => adjustValue(setFat, fat, -5, 10)}
                  >
                    <Ionicons name="remove" size={14} color={C.gray1} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.miniStepBtn}
                    onPress={() => adjustValue(setFat, fat, +5)}
                  >
                    <Ionicons name="add" size={14} color={C.gray1} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Hydration Goal */}
            <View style={styles.targetCard}>
              <View style={styles.targetHeader}>
                <View style={[styles.targetIconWrap, { backgroundColor: '#0e2b3d' }]}>
                  <Ionicons name="water-outline" size={20} color="#38bdf8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.targetTitle}>Hydration Target</Text>
                  <Text style={styles.targetHint}>Recommended daily fluid intake</Text>
                </View>
                <View style={styles.targetValueWrap}>
                  <TextInput
                    style={styles.targetInput}
                    keyboardType="numeric"
                    value={water}
                    onChangeText={setWater}
                  />
                  <Text style={styles.targetUnit}>L</Text>
                </View>
              </View>
              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => adjustValue(setWater, water, -0.25, 1.0, 0.1)}
                >
                  <Text style={styles.stepperBtnText}>-0.25L</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => adjustValue(setWater, water, +0.25, 1.0, 0.1)}
                >
                  <Text style={styles.stepperBtnText}>+0.25L</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => adjustValue(setWater, water, +0.5, 1.0, 0.1)}
                >
                  <Text style={styles.stepperBtnText}>+0.5L</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.actionButton, saving && styles.actionButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.actionButtonText}>Save Plan & Open Dashboard ✓</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.disclaimerFootnote}>
              Estimates are provided for general wellness tracking and educational purposes. Consult a physician or registered dietitian for specialized medical needs.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e20',
  },
  navIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepDot: {
    width: 24,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#27272a',
  },
  stepDotActive: {
    backgroundColor: C.orange,
    width: 36,
  },
  stepDotCompleted: {
    backgroundColor: '#30d158',
  },
  skipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  skipBtnText: {
    color: C.gray1,
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    flex: 1,
  },
  stepContainer: {
    flex: 1,
  },
  stepEyebrow: {
    color: C.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  stepTitle: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 28,
    lineHeight: 34,
    marginBottom: 8,
  },
  stepSubtitle: {
    color: C.gray1,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 22,
  },
  goalList: {
    gap: 12,
    marginBottom: 26,
  },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 20,
    padding: 16,
  },
  goalCardActive: {
    borderColor: C.orange,
    backgroundColor: '#1e1610',
  },
  goalCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    paddingRight: 10,
  },
  goalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1f1f23',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalIconWrapActive: {
    backgroundColor: '#381c10',
  },
  goalLabel: {
    color: C.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 3,
  },
  goalLabelActive: {
    color: C.orange,
  },
  goalSub: {
    color: C.gray2,
    fontSize: 12,
    lineHeight: 16,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: C.orange,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.orange,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 28,
  },
  restrictionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  restrictionChipActive: {
    backgroundColor: '#112918',
    borderColor: '#30d158',
  },
  restrictionText: {
    color: C.gray1,
    fontSize: 13,
    fontWeight: '600',
  },
  restrictionTextActive: {
    color: C.white,
  },
  targetCard: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  targetIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2e180d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetTitle: {
    color: C.white,
    fontSize: 15,
    fontWeight: '700',
  },
  targetHint: {
    color: C.gray2,
    fontSize: 11,
    marginTop: 1,
  },
  targetValueWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  targetInput: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 26,
    minWidth: 50,
    textAlign: 'right',
    padding: 0,
  },
  targetUnit: {
    color: C.gray2,
    fontSize: 12,
    fontWeight: '700',
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#222226',
  },
  stepperBtn: {
    backgroundColor: '#1c1c20',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#2e2e34',
  },
  stepperBtnText: {
    color: C.gray1,
    fontSize: 12,
    fontWeight: '600',
  },
  macrosCard: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  macrosCardTitle: {
    color: C.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  macroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#202024',
    gap: 10,
  },
  macroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroName: {
    color: C.white,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  macroInputWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  macroInput: {
    color: C.white,
    fontSize: 16,
    fontWeight: '700',
    minWidth: 36,
    textAlign: 'right',
    padding: 0,
  },
  macroUnit: {
    color: C.gray2,
    fontSize: 12,
  },
  miniStepperRow: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 8,
  },
  miniStepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#222226',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    backgroundColor: C.orange,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    shadowColor: C.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  disclaimerFootnote: {
    color: C.gray3,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 12,
  },
});