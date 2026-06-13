import { supabase } from './supabase';

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

export async function createPost(mealId, caption, tierRank) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: user.id,
      meal_id: mealId,
      caption: caption?.trim() || null,
      tier_rank: tierRank,
      visibility: 'friends',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}
