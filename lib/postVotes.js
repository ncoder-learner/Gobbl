import { supabase } from './supabase';

// Casts (or removes) the current user's "Tier Duel" vote for a post's meal
// slot. UNIQUE(post_id, voter_id) means a voter has at most one vote per
// post — tapping the slot you already voted for removes it (undo); tapping
// a different slot moves your one vote there via upsert.
export async function castVote(postId, slot, currentSlot) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  if (currentSlot === slot) {
    const { error } = await supabase
      .from('post_votes')
      .delete()
      .eq('post_id', postId)
      .eq('voter_id', user.id);
    if (error) throw error;
    return null;
  }

  const { error } = await supabase
    .from('post_votes')
    .upsert({ post_id: postId, voter_id: user.id, slot }, { onConflict: 'post_id,voter_id' });
  if (error) throw error;
  return slot;
}

// Tallies an embedded post_votes(voter_id, slot) array (fetched alongside a
// post) into per-slot counts plus the current viewer's own vote, if any.
export function tallyVotes(votes, currentUserId) {
  const counts = { breakfast: 0, lunch: 0, dinner: 0 };
  let myVote = null;
  for (const v of votes || []) {
    if (counts[v.slot] != null) counts[v.slot]++;
    if (v.voter_id === currentUserId) myVote = v.slot;
  }
  return { counts, myVote };
}

// Per-slot color for the segmented vote-share bar — shared between
// FeedScreen and MealDetailScreen so the same slot always reads the same
// color everywhere. Reuses tones already established elsewhere in the app
// (DoneCelebration's gold, the orange brand accent, the purple accent).
export const VOTE_COLORS = { breakfast: '#FFD166', lunch: '#FF6B3D', dinner: '#8855cc' };

// Total votes across a post's filled slots, plus the slot(s) currently in
// the lead (more than one if tied). `images` is the standard [{tag, meal}]
// shape used throughout (FeedScreen's `images`, MealDetailScreen's
// `trailImages`).
export function voteSummary(images, counts) {
  const total = images.reduce((sum, { tag }) => sum + (counts[tag] || 0), 0);
  if (total === 0) return { total, leaders: [] };
  const maxCount = Math.max(...images.map(({ tag }) => counts[tag] || 0));
  const leaders = images.filter(({ tag }) => (counts[tag] || 0) === maxCount);
  return { total, leaders };
}

// "N friends voted · [meal] is winning" — or the tied/empty variants.
export function voteCaption({ total, leaders }, { canVote }) {
  if (total === 0) {
    return canVote ? 'Tap a photo to vote' : 'No votes yet';
  }
  const friendsWord = `${total} friend${total === 1 ? '' : 's'} voted`;
  if (leaders.length > 1) return `${friendsWord} · tied`;
  return `${friendsWord} · ${leaders[0].meal.name} is winning`;
}
