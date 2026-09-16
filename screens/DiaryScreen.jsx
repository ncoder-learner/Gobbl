import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { localDateKey } from '../lib/dateKey';
import { computeWeeklyInsights, computeDayStatus } from '../lib/nutritionEngine';
import { getHealthGuidance } from '../lib/healthGuidance';
import DietSetupScreen, { GOAL_OPTIONS, RESTRICTION_OPTIONS, SPORT_OPTIONS } from './DietSetupScreen';
import MealLogModal from '../components/MealLogModal';
import ProgressRing from '../components/ProgressRing';
import { THEME as C } from '../lib/theme';
import { useAppForeground } from '../lib/useAppForeground';


const compact = false;

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function MacroRow({ label, value, target, color }) {
  const progress = Math.min(1, (Number(value) || 0) / Math.max(1, Number(target) || 1));
  return (
    <View style={styles.macroBlock}>
      <View style={styles.macroBlockHeader}>
        <View style={styles.macroLabelLeft}>
          <View style={[styles.macroColorDot, { backgroundColor: color }]} />
          <Text style={styles.macroTitle}>{label}</Text>
        </View>
        <Text style={styles.macroNumbers}>
          <Text style={{ color: C.white, fontWeight: '700' }}>{Math.round(value || 0)}</Text>
          <Text style={{ color: C.gray2 }}> / {target}g</Text>
        </Text>
      </View>
      <View style={styles.macroBarBg}>
        <View
          style={[
            styles.macroBarFill,
            { width: `${Math.round(progress * 100)}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

export default function DiaryScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 380;
  const pagePad = compact ? 16 : 20;

  const [userId, setUserId] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [todayMeals, setTodayMeals] = useState([]);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

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
      const weekStart = localDateKey(sevenDaysAgo);

      const [prefsResult, todayResult, weekResult, cameraMealsResult] = await Promise.all([
        supabase.from('user_diet_preferences').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('diet_meal_logs').select('*').eq('user_id', user.id).eq('date_key', today).order('logged_at', { ascending: false }),
        supabase.from('diet_meal_logs').select('*').eq('user_id', user.id).gte('date_key', weekStart),
        supabase.from('meals').select('id, name, created_at, calories, protein_g, carbs_g, fat_g, sodium_mg, tag').eq('user_id', user.id).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }),
      ]);

      const prefs = prefsResult.data;
      const dietTodays = (todayResult.data || []).map((m) => ({ ...m, source: 'manual' }));
      const dietWeek = weekResult.data || [];
      const cameraMeals = cameraMealsResult.data || [];

      const cameraToday = cameraMeals
        .filter((meal) => localDateKey(new Date(meal.created_at)) === today)
        .map((meal) => ({
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

      const cameraWeek = cameraMeals.map((meal) => ({
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
      setInsights(prefs ? computeWeeklyInsights(week, prefs) : null);
    } catch (err) {
      console.log('Error loading health data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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

  if (!loading && (!preferences || !preferences.plan_completed_at)) {
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

  const calProgress = totals.calories / Math.max(1, targetCal);
  const remainingCal = targetCal - totals.calories;
  const dayStatus = computeDayStatus(totals, {
    calories: targetCal,
    protein: targetProtein,
  });

  const mealBreakdown = todayMeals.reduce((acc, m) => {
    const type = m.meal_type || 'snack';
    acc[type] = (acc[type] || 0) + Number(m.calories || 0);
    return acc;
  }, {});

  const currentGoalObj = GOAL_OPTIONS.find((g) => g.id === preferences?.primary_goal);
  const selectedSport = SPORT_OPTIONS.find((sport) => sport.id === preferences?.sport);
  const guidance = getHealthGuidance(preferences?.primary_goal, preferences?.sport);
  const activeRestrictions = (preferences?.dietary_restrictions || preferences?.inclusions || [])
    .filter((rId) => rId && rId !== 'none')
    .map((rId) => RESTRICTION_OPTIONS.find((r) => r.id === rId) || { label: rId, icon: 'shield-outline' });

  const lastMeal = todayMeals[0];
  const ringSize = compact ? 104 : 118;
  const statusTone = {
    idle: { bg: '#1a1a1e', border: '#2a2a2e', text: C.gray1 },
    good: { bg: '#142017', border: '#24452a', text: '#30d158' },
    low: { bg: '#24180d', border: '#4d3314', text: C.gold },
    over: { bg: '#2a1212', border: '#5a1a1a', text: '#f87171' },
  }[dayStatus.tone] || { bg: '#1a1a1e', border: '#2a2a2e', text: C.gray1 };

  const weekMax = Math.max(
    targetCal,
    ...(insights?.days || []).map((d) => d.calories),
    1
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.orange} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.headerRow, { paddingTop: Math.max(insets.top + 6, 14), paddingHorizontal: pagePad }, compact && styles.headerRowCompact]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.title, compact && styles.titleCompact]}>Health</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {currentGoalObj?.label || 'Your daily log'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.editButton}
          onPress={() => setSetupOpen(true)}
          activeOpacity={0.75}
        >
          <Ionicons name="options-outline" size={15} color={C.gold} />
          <Text style={styles.editButtonText}>Plan</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: pagePad, paddingBottom: 28 + insets.bottom }]}
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
          {selectedSport && (
            <View style={styles.badgeItemGoal}>
              <Ionicons name={selectedSport.icon} size={14} color={C.gold} />
              <Text style={styles.badgeTextGoal}>{selectedSport.label}</Text>
            </View>
          )}
          {activeRestrictions.map((r, idx) => (
            <View key={`${r.label}-${idx}`} style={styles.badgeItem}>
              <Ionicons name={r.icon || 'shield-checkmark-outline'} size={13} color="#30d158" />
              <Text style={styles.badgeText}>{r.label}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <ProgressRing
              progress={calProgress}
              size={ringSize}
              color={C.orange}
              overColor="#ef4444"
              trackColor="#2a211c"
            >
              <Text style={[styles.ringNumber, compact && { fontSize: 24 }]}>{Math.round(totals.calories)}</Text>
              <Text style={styles.ringLabel}>kcal</Text>
            </ProgressRing>

            <View style={styles.heroCopy}>
              <Text style={styles.cardEyebrow}>TODAY</Text>
              <Text style={styles.heroTitle}>
                {totals.calories === 0
                  ? 'Nothing logged yet'
                  : remainingCal >= 0
                    ? `${remainingCal} left`
                    : `${Math.abs(remainingCal)} over`}
              </Text>
              <Text style={styles.heroTarget}>of {targetCal} kcal</Text>
              <View style={[styles.statusPill, { backgroundColor: statusTone.bg, borderColor: statusTone.border }]}>
                <Text style={[styles.statusPillText, { color: statusTone.text }]}>
                  {dayStatus.label}
                  {dayStatus.score != null ? ` · ${dayStatus.score}` : ''}
                </Text>
              </View>
              <Text style={styles.heroDetail}>{dayStatus.detail}</Text>
              {lastMeal ? (
                <Text style={styles.lastMealLine} numberOfLines={1}>
                  Last: {lastMeal.name} · {formatTime(lastMeal.logged_at || lastMeal.created_at)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min(100, Math.round(Math.max(0, calProgress) * 100))}%`,
                  backgroundColor: remainingCal < 0 ? '#ef4444' : C.orange,
                },
              ]}
            />
          </View>

          <View style={styles.mealDistRow}>
            {[
              ['Breakfast', mealBreakdown.breakfast || 0],
              ['Lunch', mealBreakdown.lunch || 0],
              ['Dinner', mealBreakdown.dinner || 0],
              ['Snacks', (mealBreakdown.snack || 0) + (mealBreakdown.pre_workout || 0) + (mealBreakdown.post_workout || 0)],
            ].map(([label, val]) => (
              <View key={label} style={styles.mealDistChip}>
                <Text style={styles.mealDistLabel}>{label}</Text>
                <Text style={styles.mealDistVal}>{val}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.macrosCard}>
          <Text style={styles.cardEyebrow}>MACROS</Text>
          <MacroRow label="Protein" value={totals.protein} target={targetProtein} color="#30d158" />
          <MacroRow label="Carbs" value={totals.carbs} target={targetCarbs} color="#f5a524" />
          <MacroRow label="Fat" value={totals.fat} target={targetFat} color="#ff6321" />
        </View>

        {insights && (
          <View style={styles.weekCard}>
            <View style={styles.weekHeader}>
              <View>
                <Text style={styles.cardEyebrow}>THIS WEEK</Text>
                <Text style={styles.weekTitle}>
                  {insights.daysLoggedCount}/7 days logged
                </Text>
              </View>
              <Text style={styles.weekAvg}>
                {insights.daysLoggedCount ? `${insights.avgDailyCalories} avg kcal` : 'No days yet'}
              </Text>
            </View>

            <View style={styles.weekBars}>
              {insights.days.map((day) => {
                const h = Math.max(4, Math.round((day.calories / weekMax) * 72));
                const over = day.calories > targetCal;
                return (
                  <View key={day.key} style={styles.weekCol}>
                    <Text style={styles.weekCal}>{day.calories ? Math.round(day.calories / 100) / 10 : ''}</Text>
                    <View style={styles.weekTrack}>
                      <View
                        style={[
                          styles.weekFill,
                          {
                            height: day.calories ? h : 4,
                            backgroundColor: day.calories
                              ? (over ? '#ef4444' : day.isToday ? C.orange : '#8a5a3a')
                              : '#2a2a2e',
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.weekDay, day.isToday && styles.weekDayToday]}>{day.label}</Text>
                  </View>
                );
              })}
            </View>

            <Text style={styles.weekInsight}>{insights.topDeficiencyInsight}</Text>
            <View style={styles.insightsStatsRow}>
              <View style={styles.insightsStatBox}>
                <Text style={styles.insightsStatVal}>{insights.avgDailyCalories || '—'}</Text>
                <Text style={styles.insightsStatLabel}>Avg kcal</Text>
              </View>
              <View style={styles.insightsStatBox}>
                <Text style={styles.insightsStatVal}>{insights.avgDailyProtein ? `${insights.avgDailyProtein}g` : '—'}</Text>
                <Text style={styles.insightsStatLabel}>Avg protein</Text>
              </View>
              <View style={styles.insightsStatBox}>
                <Text style={styles.insightsStatVal}>{Math.round(targetProtein - totals.protein)}g</Text>
                <Text style={styles.insightsStatLabel}>Protein left today</Text>
              </View>
            </View>
          </View>
        )}

        {guidance?.meal ? (
          <View style={styles.tipCard}>
            <Ionicons name="restaurant-outline" size={16} color={C.gold} />
            <Text style={styles.tipText}>{guidance.meal}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.quickLogBar}
          onPress={() => setLogOpen(true)}
          activeOpacity={0.85}
        >
          <View style={styles.quickLogLeft}>
            <View style={styles.quickLogIcon}>
              <Ionicons name="add" size={22} color="#000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickLogTitle}>Log a meal</Text>
              <Text style={styles.quickLogSub}>Calories and macros for today</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.gray2} />
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Today</Text>
          <Text style={styles.sectionCountBadge}>{todayMeals.length} logged</Text>
        </View>

        {todayMeals.length === 0 ? (
          <View style={styles.emptyMealsCard}>
            <Ionicons name="restaurant-outline" size={28} color={C.gray4} />
            <Text style={styles.emptyMealsTitle}>No meals yet</Text>
            <Text style={styles.emptyMealsSub}>
              Quick-log above or post from Camera to fill today’s ring.
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
                            <Text style={styles.cameraTag}>Camera</Text>
                          )}
                          <Text style={styles.cameraTag}>{formatTime(item.logged_at || item.created_at)}</Text>
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

                  <View style={styles.mealMacroPills}>
                    <Text style={styles.mealMacroPill}>P <Text style={{ color: '#30d158' }}>{item.protein || 0}g</Text></Text>
                    <Text style={styles.mealMacroPill}>C <Text style={{ color: '#f5a524' }}>{item.carbs || 0}g</Text></Text>
                    <Text style={styles.mealMacroPill}>F <Text style={{ color: '#ff6321' }}>{item.fat || 0}g</Text></Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

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
    backgroundColor: C.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  headerRowCompact: {
    paddingBottom: 8,
  },
  title: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 34,
  },
  titleCompact: {
    fontSize: 28,
  },
  subtitle: {
    color: C.gray2,
    fontSize: 13,
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
    paddingTop: 8,
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
    paddingHorizontal: 12,
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
  heroCard: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 28,
    padding: 16,
    marginBottom: 12,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  heroCopy: { flex: 1, minWidth: 0 },
  heroTitle: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 26,
    lineHeight: 30,
  },
  heroTarget: {
    color: C.gray2,
    fontSize: 13,
    marginTop: 2,
    marginBottom: 8,
  },
  heroDetail: {
    color: C.gray1,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  lastMealLine: {
    color: C.gray3,
    fontSize: 11,
    marginTop: 6,
  },
  ringNumber: { color: C.white, fontFamily: C.serif, fontSize: 28, lineHeight: 30 },
  ringLabel: { color: C.gray2, fontSize: 11, fontWeight: '700' },
  statusPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  cardEyebrow: {
    color: C.gold,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#222226',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  mealDistRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  mealDistChip: {
    flex: 1,
    backgroundColor: '#1a1a1e',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  mealDistLabel: {
    color: C.gray2,
    fontSize: 9,
    fontWeight: '600',
  },
  mealDistVal: {
    color: C.white,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  macrosCard: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
    gap: 12,
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
  weekCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 8,
  },
  weekTitle: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 22,
  },
  weekAvg: {
    color: C.gray1,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  weekBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 96,
    marginBottom: 12,
  },
  weekCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  weekCal: {
    color: C.gray3,
    fontSize: 8,
    height: 10,
  },
  weekTrack: {
    width: 14,
    height: 72,
    borderRadius: 7,
    backgroundColor: '#1a1a1e',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  weekFill: {
    width: '100%',
    borderRadius: 7,
  },
  weekDay: {
    color: C.gray2,
    fontSize: 11,
    fontWeight: '600',
  },
  weekDayToday: {
    color: C.orange,
    fontWeight: '800',
  },
  weekInsight: {
    color: C.gray1,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  insightsStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  insightsStatBox: {
    flex: 1,
    backgroundColor: '#1a1a1e',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  insightsStatVal: {
    color: C.white,
    fontFamily: C.serif,
    fontSize: 16,
    fontWeight: '700',
  },
  insightsStatLabel: {
    color: C.gray2,
    fontSize: 9,
    marginTop: 2,
    textAlign: 'center',
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#161310',
    borderWidth: 1,
    borderColor: '#3a2d22',
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
  },
  tipText: {
    color: C.gray1,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  quickLogBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1610',
    borderWidth: 1,
    borderColor: '#4d2e1b',
    borderRadius: 22,
    padding: 14,
    marginBottom: 18,
  },
  quickLogLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
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
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    padding: 24,
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
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 14,
  },
  mealCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
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
    flexWrap: 'wrap',
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
    marginLeft: 2,
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
});
