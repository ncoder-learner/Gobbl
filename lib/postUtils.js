import { supabase } from './supabase';

export const MEAL_TAGS = ['breakfast', 'lunch', 'dinner'];
export const TAG_META = {
  breakfast: { emoji: '🌅', label: 'Breakfast' },
  lunch:     { emoji: '☀️', label: 'Lunch' },
  dinner:    { emoji: '🌙', label: 'Dinner' },
};

// Which post slot a meal belongs in, based on its own breakfast/lunch/dinner
// tag. Meals with no tag (or an unrecognized one) default to breakfast, same
// fallback rule as the migration 009 backfill.
export function mealTagSlot(tag) {
  if (tag === 'lunch' || tag === 'dinner') return tag;
  return 'breakfast';
}

export async function computeTierRank(mealId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const yearEnd   = new Date(new Date().getFullYear() + 1, 0, 1).toISOString();
  const { data } = await supabase
    .from('meals')
    .select('id, score')
    .eq('user_id', user.id)
    .gte('created_at', yearStart)
    .lt('created_at', yearEnd)
    .order('score', { ascending: false });
  const idx = (data || []).findIndex(m => m.id === mealId);
  const rank = idx >= 0 ? idx + 1 : null;
  return rank != null && rank <= 10 ? rank : null;
}

// slots: { breakfast: mealId|null, lunch: mealId|null, dinner: mealId|null }.
// At least one slot must be filled. meal_id (still NOT NULL/UNIQUE) is set to
// whichever slot is filled first, breakfast > lunch > dinner, so it always
// points at a real meal on the post — existing code reading post.meal_id
// (e.g. the "already posted" reverse-embed) keeps working for that slot.
// tier_rank is a single snapshot (as before) computed for that same primary
// meal; it's what the primary image's inline tier badge reads from.
export async function createPost(slots, caption, tierRank) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const breakfastMealId = slots?.breakfast || null;
  const lunchMealId     = slots?.lunch || null;
  const dinnerMealId    = slots?.dinner || null;
  const primaryMealId   = breakfastMealId || lunchMealId || dinnerMealId;
  if (!primaryMealId) throw new Error('Pick at least one meal to post');

  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: user.id,
      meal_id: primaryMealId,
      breakfast_meal_id: breakfastMealId,
      lunch_meal_id: lunchMealId,
      dinner_meal_id: dinnerMealId,
      caption: caption?.trim() || null,
      tier_rank: tierRank,
      visibility: 'friends',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// Meal ids already attached to any of the current user's posts, across all
// three slot columns (plus legacy meal_id, which always mirrors one slot).
// Used to filter "already posted" meals out of pickers now that a meal can
// be attached to a post via any of the 3 slot columns, not just meal_id.
export async function fetchPostedMealIds(userId) {
  const { data, error } = await supabase
    .from('posts')
    .select('meal_id, breakfast_meal_id, lunch_meal_id, dinner_meal_id')
    .eq('user_id', userId);
  if (error) throw error;
  const ids = new Set();
  for (const row of data || []) {
    [row.meal_id, row.breakfast_meal_id, row.lunch_meal_id, row.dinner_meal_id]
      .forEach(id => { if (id) ids.add(id); });
  }
  return ids;
}
