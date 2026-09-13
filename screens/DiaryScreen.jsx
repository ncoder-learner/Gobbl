import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
  ScrollView,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { localDateKey } from '../lib/dateKey';
import { computeWeeklyInsights } from '../lib/nutritionEngine';
import DietSetupScreen, { GOAL_OPTIONS, RESTRICTION_OPTIONS } from './DietSetupScreen';
import MealLogModal from '../components/MealLogModal';
import { THEME as C } from '../lib/theme';
import { useAppForeground } from '../lib/useAppForeground';

export default function DiaryScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 380;

  const [userId, setUserId] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [todayMeals, setTodayMeals] = useState([]);
  const [weekMeals, setWeekMeals] = useState([]);
  const [waterMl, setWaterMl] = useState(0);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // Animated water wave pulse
  const waterScaleAnim = useRef(new Animated.Value(1)).current;

  const getWaterStorageKey = (uid, dateKey) => `@gobbl_water_${uid}_${dateKey}`;

  const loadWater = useCallback(async (uid, dateKey) => {
    if (!uid) return;
    try {
      const stored = await AsyncStorage.getItem(getWaterStorageKey(uid, dateKey));
      if (stored !== null) {
        setWaterMl(Number(stored) || 0);
      } else {
        setWaterMl(0);
      }
    } catch (_) {}
  }, []);

  const saveWater = async (newVal) => {
    const clamped = Math.max(0, newVal);
    setWaterMl(clamped);
    if (userId) {
      const today = localDateKey(new Date());
      try {
        await AsyncStorage.setItem(getWaterStorageKey(userId, today), String(clamped));
      } catch (_) {}
    }
  };

  const addWater = (deltaMl) => {
    Animated.sequence([
      Animated.timing(waterScaleAnim, {
        toValue: 1.08,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(waterScaleAnim, {
        toValue: 1.0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    saveWater(waterMl + deltaMl);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const today = localDateKey(new Date());
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

      await loadWater(user.id, today);

      const [prefsResult, todayResult, weekResult, cameraMealsResult] = await Promise.all([
        supabase.from('user_diet_preferences').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('diet_meal_logs').select('*').eq('user_id', user.id).eq('date_key', today).order('logged_at', { ascending: false }),
        supabase.from('diet_meal_logs').select('*').eq('user_id', user.id).gte('logged_at', sevenDaysAgo.toISOString()),
        supabase.from('meals').select('id, name, created_at, calories, protein_g, carbs_g, fat_g, sodium_mg, tag').eq('user_id', user.id).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }),
      ]);

      const prefs = prefsResult.data;
      const dietTodays = (todayResult.data || []).map(m => ({ ...m, source: 'manual' }));
      const dietWeek = weekResult.data || [];
      const cameraMeals = cameraMealsResult.data || [];

      const cameraToday = cameraMeals
        .filter(meal => localDateKey(new Date(meal.created_at)) === today)
        .map(meal => ({
          ...meal,
          source: 'camera',
          meal_type: meal.tag || 'lunch',
          logged_at: meal.created_at,
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

      const todays = [...dietTodays, ...cameraToday].sort(
        (a, b) => new Date(b.logged_at || b.created_at) - new Date(a.logged_at || a.created_at)
      );
      const week = [...dietWeek, ...cameraWeek];

      setPreferences(prefs || null);
      setTodayMeals(todays);
      setWeekMeals(week);
      setInsights(prefs ? computeWeeklyInsights(week, prefs) : null);
    } catch (err) {
      console.log('Error loading health data:', err);
    } finally {
      setLoading(false);
    }
  }, [loadWater]);

  useEffect(() => {
    load();
  }, [load]);

  useAppForeground(load);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleDeleteMeal = (item) => {
    if (item.source === 'camera') {
      Alert.alert(
        'Camera Logged Meal',
        'This meal was recorded via photo posts. You can manage it from the Feed or History tab.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Remove Entry',
      `Delete "${item.name}" from today's diary?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('diet_meal_logs').delete().eq('id', item.id);
              load();
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  // If no diet setup exists yet, display setup wizard directly first!
  if (!loading && !preferences) {
    return (
      <DietSetupScreen
        userId={userId}
        onSaved={load}
        onClose={null}
      />
    );
  }

  const totals = todayMeals.reduce(
    (acc, m) => ({
      calories: acc.calories + Number(m.calories || 0),
      protein: acc.protein + Number(m.protein || 0),
      carbs: acc.carbs + Number(m.carbs || 0),
      fat: acc.fat + Number(m.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const targetCal = preferences?.calories || preferences?.target_calories || 2200;
  const targetProtein = preferences?.protein_grams || preferences?.target_protein_g || 120;
  const targetCarbs = preferences?.carbs_grams || 250;
  const targetFat = preferences?.fat_grams || 70;
  const targetWaterL = preferences?.water_liters || 3.0;
  const targetWaterMl = Math.round(targetWaterL * 1000);

  const calProgress = Math.min(1, totals.calories / (targetCal || 1));
  const remainingCal = targetCal - totals.calories;

  const proteinProgress = Math.min(1, totals.protein / (targetProtein || 1));
  const carbsProgress = Math.min(1, totals.carbs / (targetCarbs || 1));
  const fatProgress = Math.min(1, totals.fat / (targetFat || 1));
  const waterProgress = Math.min(1, waterMl / (targetWaterMl || 1));

  // Meal breakdown calories
  const mealBreakdown = todayMeals.reduce((acc, m) => {
    const type = m.meal_type || 'snack';
    acc[type] = (acc[type] || 0) + Number(m.calories || 0);
    return acc;
  }, {});

  // Goal & Badges info
  const currentGoalObj = GOAL_OPTIONS.find((g) => g.id === preferences?.primary_goal);
  const activeRestrictions = (preferences?.dietary_restrictions || preferences?.inclusions || []).map((rId) => {
    return RESTRICTION_OPTIONS.find((r) => r.id === rId) || { label: rId, icon: 'shield-outline' };
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.orange} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={[styles.headerRow, { paddingTop: Math.max(insets.top + 8, 18) }, compact && styles.headerRowCompact]}>
        <View>
          <Text style={[styles.title, compact && styles.titleCompact]}>Health</Text>
          <Text style={styles.subtitle}>Daily Nutrition & Metabolism</Text>
        </View>

        <TouchableOpacity
          style={styles.editButton}
          onPress={() => setSetupOpen(true)}
          activeOpacity={0.75}
        >
          <Ionicons name="options-outline" size={15} color={C.gold} />
          <Text style={styles.editButtonText}>Edit Plan</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.orange} />
        }
      >
        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color={C.red} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ACTIVE BADGES STRIP */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.badgeStrip}
        >
          {currentGoalObj && (
            <View style={styles.badgeItemGoal}>
              <Ionicons name={currentGoalObj.icon} size={14} color={C.orange} />
              <Text style={styles.badgeTextGoal}>{currentGoalObj.label}</Text>
            </View>
          )}

          {activeRestrictions.map((r, idx) => (
            <View key={idx} style={styles.badgeItem}>
              <Ionicons name={r.icon || 'shield-checkmark-outline'} size={13} color="#30d158" />
              <Text style={styles.badgeText}>{r.label}</Text>
            </View>
          ))}

          <View style={styles.badgeItemWater}>
            <Ionicons name="water-outline" size={13} color="#38bdf8" />
            <Text style={styles.badgeTextWater}>{targetWaterL}L Target</Text>
          </View>
        </ScrollView>

        {/* TOP SUMMARY CARD: CALORIE BUDGET & WATER */}
        <View style={styles.dashboardCard}>
          <View style={styles.cardHeaderRow}>
            <View>
              <Text style={styles.cardEyebrow}>ENERGY BUDGET</Text>
              <Text style={styles.cardMainHeading}>Daily Caloric Balance</Text>
            </View>
            <View
              style={[
                styles.remainingPill,
                remainingCal < 0 && styles.remainingPillOver,
              ]}
            >
              <Ionicons
                name={remainingCal >= 0 ? 'flame-outline' : 'alert-circle-outline'}
                size={13}
                color={remainingCal >= 0 ? C.orange : '#f87171'}
              />
              <Text
                style={[
                  styles.remainingPillText,
                  remainingCal < 0 && styles.remainingPillTextOver,
                ]}
              >
                {remainingCal >= 0 ? `${remainingCal} kcal left` : `${Math.abs(remainingCal)} kcal over`}
              </Text>
            </View>
          </View>

          {/* Calorie Stats */}
          <View style={styles.calRow}>
            <Text style={styles.calConsumed}>{totals.calories}</Text>
            <Text style={styles.calDivider}>/</Text>
            <Text style={styles.calTarget}>{targetCal} kcal</Text>
            <Text style={styles.calPercent}>{Math.round(calProgress * 100)}%</Text>
          </View>

          {/* Glowing Calorie Bar */}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min(100, Math.round(calProgress * 100))}%`,
                  backgroundColor: remainingCal < 0 ? '#ef4444' : C.orange,
                },
              ]}
            />
          </View>

          {/* Meal-by-Meal Distribution Chips */}
          <View style={styles.mealDistRow}>
            <View style={styles.mealDistChip}>
              <Text style={styles.mealDistLabel}>Breakfast</Text>
              <Text style={styles.mealDistVal}>{mealBreakdown.breakfast || 0} kcal</Text>
            </View>
            <View style={styles.mealDistChip}>
              <Text style={styles.mealDistLabel}>Lunch</Text>
              <Text style={styles.mealDistVal}>{mealBreakdown.lunch || 0} kcal</Text>
            </View>
            <View style={styles.mealDistChip}>
              <Text style={styles.mealDistLabel}>Dinner</Text>
              <Text style={styles.mealDistVal}>{mealBreakdown.dinner || 0} kcal</Text>
            </View>
            <View style={styles.mealDistChip}>
              <Text style={styles.mealDistLabel}>Snacks</Text>
              <Text style={styles.mealDistVal}>{(mealBreakdown.snack || 0) + (mealBreakdown.pre_workout || 0) + (mealBreakdown.post_workout || 0)} kcal</Text>
            </View>
          </View>

          {/* HYDRATION SECTION */}
          <View style={styles.hydrationDivider} />
          <View style={styles.hydrationHeaderRow}>
            <View style={styles.hydrationTitleLeft}>
              <Ionicons name="water-outline" size={18} color="#38bdf8" />
              <Text style={styles.hydrationTitle}>Hydration Tracker</Text>
            </View>
            <Text style={styles.hydrationNumbers}>
              {(waterMl / 1000).toFixed(2)} / {targetWaterL} L ({Math.round(waterProgress * 100)}%)
            </Text>
          </View>

          {/* Water Progress Bar */}
          <View style={styles.waterProgressBarBg}>
            <View
              style={[
                styles.waterProgressBarFill,
                { width: `${Math.min(100, Math.round(waterProgress * 100))}%` },
              ]}
            />
          </View>

          {/* Quick Water Action Buttons */}
          <View style={styles.waterActionRow}>
            <Animated.View style={{ transform: [{ scale: waterScaleAnim }], flex: 1 }}>
              <TouchableOpacity
                style={styles.waterAddBtn}
                onPress={() => addWater(250)}
                activeOpacity={0.75}
              >
                <Ionicons name="add" size={16} color="#000" />
                <Text style={styles.waterAddBtnText}>+250 ml</Text>
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              style={styles.waterQuickBtn}
              onPress={() => addWater(500)}
              activeOpacity={0.75}
            >
              <Text style={styles.waterQuickBtnText}>+500 ml</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.waterQuickBtn}
              onPress={() => addWater(1000)}
              activeOpacity={0.75}
            >
              <Text style={styles.waterQuickBtnText}>+1.0 L</Text>
            </TouchableOpacity>

            {waterMl > 0 && (
              <TouchableOpacity
                style={styles.waterMinusBtn}
                onPress={() => saveWater(waterMl - 250)}
                activeOpacity={0.75}
              >
                <Ionicons name="remove" size={16} color={C.gray2} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* MACRO DISTRIBUTION BARS */}
        <View style={styles.macrosCard}>
          <Text style={styles.cardEyebrow}>MACRONUTRIENT TARGETS</Text>

          {/* Protein */}
          <View style={styles.macroBlock}>
            <View style={styles.macroBlockHeader}>
              <View style={styles.macroLabelLeft}>
                <View style={[styles.macroColorDot, { backgroundColor: '#30d158' }]} />
                <Text style={styles.macroTitle}>Protein</Text>
              </View>
              <Text style={styles.macroNumbers}>
                <Text style={{ color: C.white, fontWeight: '700' }}>{Math.round(totals.protein)}</Text>
                <Text style={{ color: C.gray2 }}> / {targetProtein}g</Text>
                <Text style={[styles.macroPercent, { color: '#30d158' }]}> ({Math.round(proteinProgress * 100)}%)</Text>
              </Text>
            </View>
            <View style={styles.macroBarBg}>
              <View
                style={[
                  styles.macroBarFill,
                  {
                    width: `${Math.min(100, Math.round(proteinProgress * 100))}%`,
                    backgroundColor: '#30d158',
                  },
                ]}
              />
            </View>
          </View>

          {/* Carbs */}
          <View style={styles.macroBlock}>
            <View style={styles.macroBlockHeader}>
              <View style={styles.macroLabelLeft}>
                <View style={[styles.macroColorDot, { backgroundColor: '#f5a524' }]} />
                <Text style={styles.macroTitle}>Carbohydrates</Text>
              </View>
              <Text style={styles.macroNumbers}>
                <Text style={{ color: C.white, fontWeight: '700' }}>{Math.round(totals.carbs)}</Text>
                <Text style={{ color: C.gray2 }}> / {targetCarbs}g</Text>
                <Text style={[styles.macroPercent, { color: '#f5a524' }]}> ({Math.round(carbsProgress * 100)}%)</Text>
              </Text>
            </View>
            <View style={styles.macroBarBg}>
              <View
                style={[
                  styles.macroBarFill,
                  {
                    width: `${Math.min(100, Math.round(carbsProgress * 100))}%`,
                    backgroundColor: '#f5a524',
                  },
                ]}
              />
            </View>
          </View>

          {/* Fat */}
          <View style={styles.macroBlock}>
            <View style={styles.macroBlockHeader}>
              <View style={styles.macroLabelLeft}>
                <View style={[styles.macroColorDot, { backgroundColor: '#ff6321' }]} />
                <Text style={styles.macroTitle}>Fats</Text>
              </View>
              <Text style={styles.macroNumbers}>
                <Text style={{ color: C.white, fontWeight: '700' }}>{Math.round(totals.fat)}</Text>
                <Text style={{ color: C.gray2 }}> / {targetFat}g</Text>
                <Text style={[styles.macroPercent, { color: '#ff6321' }]}> ({Math.round(fatProgress * 100)}%)</Text>
              </Text>
            </View>
            <View style={styles.macroBarBg}>
              <View
                style={[
                  styles.macroBarFill,
                  {
                    width: `${Math.min(100, Math.round(fatProgress * 100))}%`,
                    backgroundColor: '#ff6321',
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* QUICK LOG ACTION BUTTON */}
        <TouchableOpacity
          style={styles.quickLogBar}
          onPress={() => setLogOpen(true)}
          activeOpacity={0.85}
        >
          <View style={styles.quickLogLeft}>
            <View style={styles.quickLogIcon}>
              <Ionicons name="add" size={22} color="#000" />
            </View>
            <View>
              <Text style={styles.quickLogTitle}>Quick Log Meal or Snack</Text>
              <Text style={styles.quickLogSub}>Record calories and macros into today&apos;s diary</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.gray2} />
        </TouchableOpacity>

        {/* TODAY'S MEALS LIST */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Today&apos;s Meals</Text>
          <Text style={styles.sectionCountBadge}>{todayMeals.length} recorded</Text>
        </View>

        {todayMeals.length === 0 ? (
          <View style={styles.emptyMealsCard}>
            <Ionicons name="restaurant-outline" size={32} color={C.gray4} />
            <Text style={styles.emptyMealsTitle}>No meals logged yet today</Text>
            <Text style={styles.emptyMealsSub}>
              Use Quick Log above or post a meal from the Camera tab to record your nutrition.
            </Text>
          </View>
        ) : (
          <View style={styles.mealsList}>
            {todayMeals.map((item, index) => {
              const mealIconMap = {
                breakfast: 'sunny-outline',
                lunch: 'restaurant-outline',
                dinner: 'moon-outline',
                snack: 'cafe-outline',
                pre_workout: 'flash-outline',
                post_workout: 'barbell-outline',
              };
              const iconName = mealIconMap[item.meal_type] || 'restaurant-outline';

              return (
                <View key={item.id || index} style={styles.mealCard}>
                  <View style={styles.mealCardTop}>
                    <View style={styles.mealCardLeft}>
                      <View style={styles.mealIconBadge}>
                        <Ionicons name={iconName} size={16} color={C.orange} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mealName}>{item.name}</Text>
                        <View style={styles.mealMetaRow}>
                          <Text style={styles.mealTypeTag}>{item.meal_type?.replace('_', ' ')}</Text>
                          {item.source === 'camera' && (
                            <Text style={styles.cameraTag}>Camera Log</Text>
                          )}
                        </View>
                      </View>
                    </View>

                    <View style={styles.mealCaloriesWrap}>
                      <Text style={styles.mealCalories}>{item.calories}</Text>
                      <Text style={styles.mealCalUnit}>kcal</Text>
                    </View>

                    {item.source === 'manual' && (
                      <TouchableOpacity
                        style={styles.mealDeleteBtn}
                        onPress={() => handleDeleteMeal(item)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="trash-outline" size={16} color={C.gray3} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Macro Pills */}
                  <View style={styles.mealMacroPills}>
                    <Text style={styles.mealMacroPill}>Protein: <Text style={{ color: '#30d158' }}>{item.protein || 0}g</Text></Text>
                    <Text style={styles.mealMacroPill}>Carbs: <Text style={{ color: '#f5a524' }}>{item.carbs || 0}g</Text></Text>
                    <Text style={styles.mealMacroPill}>Fat: <Text style={{ color: '#ff6321' }}>{item.fat || 0}g</Text></Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* WEEKLY INSIGHTS CARD */}
        {insights && (
          <View style={styles.insightsCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardEyebrow}>7-DAY SUMMARY</Text>
              <View style={styles.scorePill}>
                <Text style={styles.scorePillText}>Recovery Score {insights.recoveryScore}/100</Text>
              </View>
            </View>
            <Text style={styles.insightsTitle}>Weekly Nutrition Coach</Text>
            <Text style={styles.insightsBody}>{insights.topDeficiencyInsight}</Text>

            <View style={styles.insightsStatsRow}>
              <View style={styles.insightsStatBox}>
                <Text style={styles.insightsStatVal}>{insights.avgDailyCalories}</Text>
                <Text style={styles.insightsStatLabel}>Avg Daily kcal</Text>
              </View>
              <View style={styles.insightsStatBox}>
                <Text style={styles.insightsStatVal}>{insights.avgDailyProtein}g</Text>
                <Text style={styles.insightsStatLabel}>Avg Protein</Text>
              </View>
              <View style={styles.insightsStatBox}>
                <Text style={styles.insightsStatVal}>{insights.daysLoggedCount}/7</Text>
                <Text style={styles.insightsStatLabel}>Days Tracked</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* DIET SETUP / QUIZ MODAL */}
      <Modal
        visible={setupOpen}
        animationType="slide"
        onRequestClose={() => setSetupOpen(false)}
      >
        <DietSetupScreen
          userId={userId}
          onSaved={() => {
            setSetupOpen(false);
            load();
          }}
          onClose={() => setSetupOpen(false)}
        />
      </Modal>

      {/* QUICK MEAL LOG MODAL */}
      <Modal
        visible={logOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLogOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <MealLogModal
            userId={userId}
            onSaved={load}
            onClose={() => setLogOpen(false)}
          />
        </View>
      </Modal>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1d',
  },
  headerRowCompact: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  title: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 34,
  },
  titleCompact: {
    fontSize: 30,
  },
  subtitle: {
    color: C.gray2,
    fontSize: 12,
    marginTop: 2,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#382f27',
    backgroundColor: '#1b1713',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  editButtonText: {
    color: C.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    flex: 1,
  },
  badgeStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 14,
  },
  badgeItemGoal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#26160d',
    borderWidth: 1,
    borderColor: '#4d2914',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  badgeTextGoal: {
    color: C.orange,
    fontSize: 12,
    fontWeight: '700',
  },
  badgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#142017',
    borderWidth: 1,
    borderColor: '#213a26',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeText: {
    color: '#30d158',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeItemWater: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0f202b',
    borderWidth: 1,
    borderColor: '#19394f',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeTextWater: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  dashboardCard: {
    backgroundColor: '#141416',
    borderColor: '#242428',
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardEyebrow: {
    color: C.gold,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  cardMainHeading: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 22,
  },
  remainingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#2b1b11',
    borderWidth: 1,
    borderColor: '#4d2d18',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  remainingPillOver: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  remainingPillText: {
    color: C.orange,
    fontSize: 11,
    fontWeight: '700',
  },
  remainingPillTextOver: {
    color: '#f87171',
  },
  calRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 4,
    marginBottom: 12,
  },
  calConsumed: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 34,
    fontWeight: '700',
  },
  calDivider: {
    color: C.gray3,
    fontSize: 18,
  },
  calTarget: {
    color: C.gray2,
    fontSize: 16,
    fontWeight: '600',
  },
  calPercent: {
    color: C.orange,
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  progressBarBg: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#222226',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  mealDistRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  mealDistChip: {
    flex: 1,
    backgroundColor: '#1a1a1e',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  mealDistLabel: {
    color: C.gray2,
    fontSize: 10,
    fontWeight: '600',
  },
  mealDistVal: {
    color: C.white,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  hydrationDivider: {
    height: 1,
    backgroundColor: '#222226',
    marginVertical: 16,
  },
  hydrationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  hydrationTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hydrationTitle: {
    color: C.white,
    fontSize: 15,
    fontWeight: '700',
  },
  hydrationNumbers: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
  },
  waterProgressBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0f222e',
    overflow: 'hidden',
    marginBottom: 14,
  },
  waterProgressBarFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#38bdf8',
  },
  waterActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waterAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#38bdf8',
    borderRadius: 999,
    paddingVertical: 10,
  },
  waterAddBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 13,
  },
  waterQuickBtn: {
    backgroundColor: '#132836',
    borderWidth: 1,
    borderColor: '#20475f',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waterQuickBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  waterMinusBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1a1a1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  macrosCard: {
    backgroundColor: '#141416',
    borderColor: '#242428',
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
    gap: 14,
  },
  macroBlock: {
    gap: 6,
  },
  macroBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  macroLabelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  macroColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroTitle: {
    color: C.white,
    fontSize: 14,
    fontWeight: '600',
  },
  macroNumbers: {
    fontSize: 13,
  },
  macroPercent: {
    fontWeight: '700',
  },
  macroBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#222226',
    overflow: 'hidden',
  },
  macroBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  quickLogBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1610',
    borderWidth: 1,
    borderColor: '#4d2e1b',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
  },
  quickLogLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickLogIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLogTitle: {
    color: C.white,
    fontSize: 15,
    fontWeight: '700',
  },
  quickLogSub: {
    color: C.gray2,
    fontSize: 11,
    marginTop: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 22,
  },
  sectionCountBadge: {
    color: C.gray2,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyMealsCard: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 20,
    padding: 26,
    alignItems: 'center',
    marginBottom: 18,
    gap: 8,
  },
  emptyMealsTitle: {
    color: C.white,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyMealsSub: {
    color: C.gray2,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  mealsList: {
    gap: 10,
    marginBottom: 18,
  },
  mealCard: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 18,
    padding: 16,
  },
  mealCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mealCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  mealIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#261910',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealName: {
    color: C.white,
    fontSize: 15,
    fontWeight: '700',
  },
  mealMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  mealTypeTag: {
    color: C.gold,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cameraTag: {
    color: C.gray2,
    fontSize: 10,
    fontWeight: '600',
  },
  mealCaloriesWrap: {
    alignItems: 'flex-end',
  },
  mealCalories: {
    color: C.orange,
    fontFamily: C.serif,
    fontSize: 20,
    fontWeight: '700',
  },
  mealCalUnit: {
    color: C.gray3,
    fontSize: 10,
  },
  mealDeleteBtn: {
    padding: 6,
    marginLeft: 4,
  },
  mealMacroPills: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#202024',
  },
  mealMacroPill: {
    color: C.gray2,
    fontSize: 11,
    fontWeight: '600',
  },
  insightsCard: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#242428',
    borderRadius: 24,
    padding: 20,
    marginTop: 6,
    marginBottom: 20,
  },
  scorePill: {
    backgroundColor: '#142418',
    borderWidth: 1,
    borderColor: '#24452a',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  scorePillText: {
    color: '#30d158',
    fontSize: 11,
    fontWeight: '700',
  },
  insightsTitle: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 20,
    marginTop: 6,
    marginBottom: 6,
  },
  insightsBody: {
    color: C.gray1,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  insightsStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  insightsStatBox: {
    flex: 1,
    backgroundColor: '#1a1a1e',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
  },
  insightsStatVal: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 18,
    fontWeight: '700',
  },
  insightsStatLabel: {
    color: C.gray2,
    fontSize: 10,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
});