import { supabase } from './supabase';

// Which slots the current user has skipped for one day. Returns a Set of
// slot names ('breakfast'/'lunch'/'dinner'). Own-board use only — meal_skips
// has no friend-read policy, so this can never leak into a friend's view.
export async function fetchSkippedSlots(userId, dayKey) {
  const { data, error } = await supabase
    .from('meal_skips')
    .select('slot')
    .eq('user_id', userId)
    .eq('day', dayKey);
  if (error) throw error;
  return new Set((data || []).map(r => r.slot));
}

// Day-keys (any slot skipped that day) over the same lookback window as the
// streak queries, so a day resolved purely by skipping counts the same as a
// day resolved by logging — merge the result into the meal-day Set before
// walking the streak backward.
export async function fetchSkipDayKeys(userId, limit = 500) {
  const { data, error } = await supabase
    .from('meal_skips')
    .select('day')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return new Set((data || []).map(r => r.day));
}

export async function skipMeal(userId, dayKey, slot) {
  const { error } = await supabase
    .from('meal_skips')
    .upsert({ user_id: userId, day: dayKey, slot }, { onConflict: 'user_id,day,slot' });
  if (error) throw error;
}

export async function unskipMeal(userId, dayKey, slot) {
  const { error } = await supabase
    .from('meal_skips')
    .delete()
    .eq('user_id', userId)
    .eq('day', dayKey)
    .eq('slot', slot);
  if (error) throw error;
}
