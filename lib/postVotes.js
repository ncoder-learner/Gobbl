import { supabase } from './supabase';

// Local calendar day (not UTC) — matches the "day" every other per-day
// feature in this app already keys off (DayBoardScreen, streak calc).
export function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Casts or moves the current user's vote for a slot on a given day —
// UNIQUE(voter_id, slot, day) means there's always at most one active vote
// per voter per slot per day, so voting for a different meal in the same
// slot just moves it via upsert rather than needing a separate "clear the
// old one" step.
export async function castVote(voterId, mealId, slot, day = localDateKey(new Date())) {
  const { error } = await supabase
    .from('post_votes')
    .upsert({ voter_id: voterId, meal_id: mealId, slot, day }, { onConflict: 'voter_id,slot,day' });
  if (error) throw error;
}

// Tallies an embedded post_votes(voter_id, meal_id) array (fetched
// alongside a set of meals in the same slot) into per-meal counts plus
// which meal_id (if any) the current viewer voted for.
export function tallyMealVotes(votes, currentUserId) {
  const counts = {};
  let myVoteMealId = null;
  for (const v of votes || []) {
    counts[v.meal_id] = (counts[v.meal_id] || 0) + 1;
    if (v.voter_id === currentUserId) myVoteMealId = v.meal_id;
  }
  return { counts, myVoteMealId };
}

// ─── Scheduled duel unlock ──────────────────────────────────────────────────
// A slot's duel opens once that slot's window has closed. Breakfast and
// lunch reuse LogMealScreen's guessMealTag() boundaries directly (11am,
// 4pm). Dinner deliberately does NOT reuse that boundary (midnight) — this
// board only ever shows *today's* tiles, so a literal "end of day" close
// time would land exactly when "today" rolls over into tomorrow, meaning
// the dinner duel could never actually be seen. 9pm instead: late enough
// that essentially everyone eating dinner has already posted, early enough
// that the duel is live for a few hours before the day resets.
export const SLOT_CLOSE_HOUR = { breakfast: 11, lunch: 16, dinner: 21 };

// The Date a given local day's slot duel unlocks. `day` is a localDateKey
// ("YYYY-MM-DD").
export function duelCloseBoundary(day, slot) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, SLOT_CLOSE_HOUR[slot] ?? 21, 0, 0, 0);
}

export function isDuelUnlocked(day, slot, now = new Date()) {
  return now.getTime() >= duelCloseBoundary(day, slot).getTime();
}

// [start, end) ISO bounds for a given month, for the "wins" date-range
// query below — wins are derived (COUNT(*) of votes on a user's meals in
// that range), never stored or reset.
export function monthRange(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Win count for one user in one month — every vote received on any of
// their meals counts as a win, regardless of slot.
export async function winsForMonth(userId, year, month) {
  const { start, end } = monthRange(year, month);
  const { count, error } = await supabase
    .from('post_votes')
    .select('meal_id, meals!inner(user_id)', { count: 'exact', head: true })
    .eq('meals.user_id', userId)
    .gte('created_at', start)
    .lt('created_at', end);
  if (error) throw error;
  return count ?? 0;
}

// ─── Wins-seen tracking ─────────────────────────────────────────────────────
// Drives the count-up-on-open animation: compare the last time the user
// looked at their win count against votes that landed since, so the profile
// can animate from their old total to their new one instead of just
// snapping to a static number.

export async function getWinsSeenAt(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('wins_seen_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.wins_seen_at ?? null;
}

export async function markWinsSeen(userId, at = new Date()) {
  const { error } = await supabase
    .from('profiles')
    .update({ wins_seen_at: at.toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// Votes received on the user's own meals since `sinceIso` (exclusive),
// newest first, with the voter's username for the "who voted" reveal.
// `sinceIso` of null means "never seen before" — callers should treat that
// as no baseline to count up from, not as "everything is new".
export async function newWinsSince(userId, sinceIso) {
  if (!sinceIso) return [];
  const { data, error } = await supabase
    .from('post_votes')
    .select('voter_id, meal_id, created_at, meals!inner(user_id), profiles!post_votes_voter_id_fkey(username)')
    .eq('meals.user_id', userId)
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    voterId: row.voter_id,
    mealId: row.meal_id,
    createdAt: row.created_at,
    voterUsername: row.profiles?.username ?? null,
  }));
}
