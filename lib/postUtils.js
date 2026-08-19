import { supabase } from './supabase';
export { MEAL_TAGS, TAG_META } from './mealTags';

// Feather icon names (from the already-installed @expo/vector-icons) for the
// thin monochrome line-icon slot markers used in DayBoardScreen's section
// headers and SlotViewerScreen's overlay label. Kept separate from
// TAG_META.emoji, which many other screens (FeedScreen's tag badge, DayTrail
// pins, MapScreen pins) still render as-is — this map is scoped to those two
// screens only, not a replacement for the emoji everywhere.
export const TAG_ICON = { breakfast: 'sunrise', lunch: 'sun', dinner: 'moon' };

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
// Reuses today's existing post instead of creating a duplicate: if the user
// already has a post for today (any slot filled), this fills in whichever
// of breakfast/lunch/dinner the caller newly provides and bumps
// last_updated_at, leaving every other column on that row (including slots
// it already had, its caption, its tier_rank/primary meal_id, and —
// implicitly, since the row itself is never deleted/recreated — any
// post_votes tied to it) untouched. Only inserts a brand-new row when no
// post exists yet for today.
export async function createPost(slots, caption, tierRank) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const breakfastMealId = slots?.breakfast || null;
  const lunchMealId     = slots?.lunch || null;
  const dinnerMealId    = slots?.dinner || null;
  const primaryMealId   = breakfastMealId || lunchMealId || dinnerMealId;
  if (!primaryMealId) throw new Error('Pick at least one meal to post');

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const nowIso   = now.toISOString();

  const { data: existing, error: findErr } = await supabase
    .from('posts')
    .select('id')
    .eq('user_id', user.id)
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd)
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const patch = { last_updated_at: nowIso };
    if (breakfastMealId) patch.breakfast_meal_id = breakfastMealId;
    if (lunchMealId)     patch.lunch_meal_id     = lunchMealId;
    if (dinnerMealId)    patch.dinner_meal_id    = dinnerMealId;
    if (caption?.trim()) patch.caption = caption.trim();

    const { error: updateErr } = await supabase.from('posts').update(patch).eq('id', existing.id);
    if (updateErr) throw updateErr;
    return existing.id;
  }

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
      last_updated_at: nowIso,
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
