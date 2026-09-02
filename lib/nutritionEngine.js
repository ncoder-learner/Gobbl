export const SAFE_NUTRITION_FLOOR = {
  MIN_CALORIES_ABSOLUTE: 1200,
  MIN_PROTEIN_GRAMS: 50,
  MAX_SAFE_SODIUM_MG: 3800,
};

export function checkSafeNutritionFloor(calories, proteinGrams, userGoal) {
  const isBelowFloor = calories < SAFE_NUTRITION_FLOOR.MIN_CALORIES_ABSOLUTE;
  const isProteinDeficient = proteinGrams < SAFE_NUTRITION_FLOOR.MIN_PROTEIN_GRAMS;
  const requiresClinicalConsult =
    isBelowFloor || isProteinDeficient || (userGoal === 'fat_loss_shred' && calories < 1350);

  return {
    isSafe: !requiresClinicalConsult,
    requiresClinicalConsult,
    reason: isBelowFloor
      ? `Target of ${calories} kcal is below the recommended safe minimum (${SAFE_NUTRITION_FLOOR.MIN_CALORIES_ABSOLUTE} kcal).`
      : isProteinDeficient
      ? `Protein target of ${proteinGrams}g is insufficient for lean tissue preservation.`
      : null,
    recommendation: 'Consult a registered dietitian or certified sports clinician before adopting ultra-low calorie diets.',
  };
}

// meals: array of diet_meal_logs rows. groupKey: 'date_key' field, from lib/dateKey.js
export function computeWeeklyInsights(meals, preferences, healthData) {
  if (!meals || meals.length === 0) {
    return {
      avgDailyCalories: 0,
      avgDailyProtein: 0,
      avgDailyCarbs: 0,
      avgDailyFat: 0,
      avgDailySodiumMg: 0,
      calorieGap: -preferences.calories,
      proteinGap: -preferences.protein_grams,
      sodiumStatus: 'optimal',
      recoveryScore: 75,
      staminaScore: 75,
      overallHealthScore: 75,
      daysLoggedCount: 0,
      topDeficiencyInsight: 'Start logging your meals to build your intake baseline.',
    };
  }

  const dayGroups = new Map();
  meals.forEach((m) => {
    if (!dayGroups.has(m.date_key)) dayGroups.set(m.date_key, []);
    dayGroups.get(m.date_key).push(m);
  });

  const daysCount = Math.max(dayGroups.size, 1);
  const totals = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat,
      sodium: acc.sodium + m.sodium_mg,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 }
  );

  const avgDailyCalories = Math.round(totals.calories / daysCount);
  const avgDailyProtein = Math.round(totals.protein / daysCount);
  const avgDailyCarbs = Math.round(totals.carbs / daysCount);
  const avgDailyFat = Math.round(totals.fat / daysCount);
  const avgDailySodiumMg = Math.round(totals.sodium / daysCount);

  const calorieGap = avgDailyCalories - preferences.calories;
  const proteinGap = avgDailyProtein - preferences.protein_grams;

  let sodiumStatus = 'optimal';
  if (avgDailySodiumMg > 3200) sodiumStatus = 'excessive';
  else if (avgDailySodiumMg > 2600) sodiumStatus = 'moderate';

  const macroAdherenceScore = Math.max(0, 100 - Math.abs(proteinGap) * 1.2 - Math.abs(calorieGap) * 0.05);
  const sleepFactor = healthData ? healthData.sleep_recovery_score ?? 85 : 85;
  const activeBurnFactor = healthData
    ? Math.min(100, Math.round((healthData.active_calories_burned / 800) * 90))
    : 80;

  const recoveryScore = Math.min(99, Math.round(macroAdherenceScore * 0.45 + sleepFactor * 0.55));
  const staminaScore = Math.min(99, Math.round(macroAdherenceScore * 0.4 + activeBurnFactor * 0.6));
  const overallHealthScore = Math.round(recoveryScore * 0.5 + staminaScore * 0.5);

  let topDeficiencyInsight = 'Protein and calorie balance are currently on target.';
  if (proteinGap < -25) {
    topDeficiencyInsight = `Average daily protein is ${Math.abs(proteinGap)}g below target.`;
  } else if (calorieGap < -400) {
    topDeficiencyInsight = `Caloric intake is trailing target by ${Math.abs(calorieGap)} kcal.`;
  } else if (sodiumStatus === 'excessive') {
    topDeficiencyInsight = `Sodium intake averaged ${avgDailySodiumMg}mg, above the recommended range.`;
  }

  return {
    avgDailyCalories,
    avgDailyProtein,
    avgDailyCarbs,
    avgDailyFat,
    avgDailySodiumMg,
    calorieGap,
    proteinGap,
    sodiumStatus,
    recoveryScore,
    staminaScore,
    overallHealthScore,
    daysLoggedCount: daysCount,
    topDeficiencyInsight,
  };
}