import { localDateKey } from './dateKey';

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

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function mealDateKey(meal) {
  if (meal?.date_key) return meal.date_key;
  const raw = meal?.logged_at || meal?.created_at;
  return raw ? localDateKey(new Date(raw)) : null;
}

export function computeDayStatus(totals, targets) {
  const calories = Number(totals?.calories || 0);
  const protein = Number(totals?.protein || 0);
  const targetCal = Math.max(1, Number(targets?.calories || 2200));
  const targetProtein = Math.max(1, Number(targets?.protein || 100));

  if (calories <= 0) {
    return {
      score: null,
      label: 'Not started',
      detail: 'Log a meal to see today’s balance.',
      tone: 'idle',
    };
  }

  const calRatio = calories / targetCal;
  const proRatio = protein / targetProtein;
  const calScore = Math.max(0, 100 - Math.abs(1 - calRatio) * 100);
  const proScore = Math.max(0, 100 - Math.abs(1 - Math.min(proRatio, 1.25)) * 90);
  const score = Math.round(calScore * 0.65 + proScore * 0.35);

  let label = 'On track';
  let tone = 'good';
  let detail = `${Math.round(targetCal - calories)} kcal left in your budget.`;
  if (calRatio > 1.08) {
    label = 'Over target';
    tone = 'over';
    detail = `${Math.round(calories - targetCal)} kcal over your budget.`;
  } else if (calRatio < 0.45) {
    label = 'Just getting started';
    tone = 'low';
    detail = `${Math.round(targetCal - calories)} kcal still open today.`;
  } else if (calRatio < 0.82) {
    label = 'Under target';
    tone = 'low';
    detail = `${Math.round(targetCal - calories)} kcal remaining.`;
  } else if (proRatio < 0.7) {
    label = 'Low on protein';
    tone = 'low';
    detail = `${Math.max(0, Math.round(targetProtein - protein))}g protein still to go.`;
  }

  return { score, label, detail, tone };
}

// Always returns the last 7 local calendar days. Empty days stay at 0 —
// no placeholder recovery/stamina scores.
export function computeWeeklyInsights(meals, preferences) {
  const targetCal = Number(preferences?.calories || preferences?.target_calories || 2200);
  const targetProtein = Number(preferences?.protein_grams || preferences?.target_protein_g || 100);

  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({
      key: localDateKey(d),
      label: WEEKDAYS[d.getDay()],
      isToday: i === 0,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      sodium: 0,
      mealCount: 0,
    });
  }

  const byKey = new Map(days.map((day) => [day.key, day]));
  (meals || []).forEach((m) => {
    const key = mealDateKey(m);
    const day = key && byKey.get(key);
    if (!day) return;
    day.calories += Number(m.calories || 0);
    day.protein += Number(m.protein || 0);
    day.carbs += Number(m.carbs || 0);
    day.fat += Number(m.fat || 0);
    day.sodium += Number(m.sodium_mg || 0);
    day.mealCount += 1;
  });

  const loggedDays = days.filter((d) => d.mealCount > 0);
  const daysLoggedCount = loggedDays.length;
  const sum = (field) => loggedDays.reduce((acc, d) => acc + d[field], 0);

  const avgDailyCalories = daysLoggedCount ? Math.round(sum('calories') / daysLoggedCount) : 0;
  const avgDailyProtein = daysLoggedCount ? Math.round(sum('protein') / daysLoggedCount) : 0;
  const avgDailyCarbs = daysLoggedCount ? Math.round(sum('carbs') / daysLoggedCount) : 0;
  const avgDailyFat = daysLoggedCount ? Math.round(sum('fat') / daysLoggedCount) : 0;
  const avgDailySodiumMg = daysLoggedCount ? Math.round(sum('sodium') / daysLoggedCount) : 0;

  const calorieGap = avgDailyCalories - targetCal;
  const proteinGap = avgDailyProtein - targetProtein;

  let sodiumStatus = 'optimal';
  if (avgDailySodiumMg > 3200) sodiumStatus = 'excessive';
  else if (avgDailySodiumMg > 2600) sodiumStatus = 'moderate';

  let topDeficiencyInsight = 'Log a few days this week to see a real average.';
  if (daysLoggedCount === 0) {
    topDeficiencyInsight = 'Nothing logged in the last 7 days yet.';
  } else if (proteinGap < -25) {
    topDeficiencyInsight = `On logged days, protein is averaging ${Math.abs(proteinGap)}g below target.`;
  } else if (calorieGap < -400) {
    topDeficiencyInsight = `On logged days, intake is averaging ${Math.abs(calorieGap)} kcal below target.`;
  } else if (calorieGap > 400) {
    topDeficiencyInsight = `On logged days, intake is averaging ${calorieGap} kcal above target.`;
  } else if (sodiumStatus === 'excessive') {
    topDeficiencyInsight = `Sodium averaged ${avgDailySodiumMg}mg on logged days.`;
  } else {
    topDeficiencyInsight = `Across ${daysLoggedCount} logged day${daysLoggedCount === 1 ? '' : 's'}, you’re averaging ${avgDailyCalories} kcal.`;
  }

  return {
    days,
    targetCalories: targetCal,
    avgDailyCalories,
    avgDailyProtein,
    avgDailyCarbs,
    avgDailyFat,
    avgDailySodiumMg,
    calorieGap,
    proteinGap,
    sodiumStatus,
    daysLoggedCount,
    topDeficiencyInsight,
  };
}