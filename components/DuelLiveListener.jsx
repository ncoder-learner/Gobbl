import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform, StatusBar as RNStatusBar } from 'react-native';
import { supabase } from '../lib/supabase';
import { MEAL_TAGS } from '../lib/postUtils';
import { isDuelUnlocked, markWinsSeen } from '../lib/postVotes';
import { emitDuelVoteReceived } from '../lib/duelEvents';

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const TOP_INSET = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 54;

// Mounted once at the app root (see App.js) so a live vote on the user's
// own meal surfaces the count-up animation/toast no matter which tab is
// open — DayBoardScreen and DuelScreen only care about the slot they're
// currently showing, but wins can land while the user is anywhere.
//
// One channel per (day, slot) the user actually has a live duel entry in
// today — same "duel:{day}:{slot}" naming DuelScreen itself subscribes to,
// just a second, independent subscription (Supabase allows multiple
// subscribers per channel name from the same client). RLS
// (friends_can_see_votes, 019) still gates what postgres_changes delivers,
// so this only ever receives votes the current user is allowed to see.
export default function DuelLiveListener() {
  const [toast, setToast] = useState(null); // { text } | null
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef(null);

  function showToast(text) {
    setToast({ text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }

  useEffect(() => {
    let channels = [];
    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const now = new Date();
      const todayKey = localDateKey(now);
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const { data: post } = await supabase
        .from('posts')
        .select('breakfast_meal_id, lunch_meal_id, dinner_meal_id')
        .eq('user_id', user.id)
        .gte('created_at', dayStart)
        .lt('created_at', dayEnd)
        .limit(1)
        .maybeSingle();
      if (!post || cancelled) return;

      const myMealIdBySlot = {
        breakfast: post.breakfast_meal_id,
        lunch: post.lunch_meal_id,
        dinner: post.dinner_meal_id,
      };

      const slotUsernameCache = new Map();
      async function usernameFor(voterId) {
        if (slotUsernameCache.has(voterId)) return slotUsernameCache.get(voterId);
        const { data } = await supabase.from('profiles').select('username').eq('id', voterId).maybeSingle();
        const uname = data?.username ?? null;
        slotUsernameCache.set(voterId, uname);
        return uname;
      }

      async function handleRow(row) {
        if (!row || row.day !== todayKey || row.voter_id === user.id) return;
        if (row.meal_id !== myMealIdBySlot[row.slot]) return;
        const voterUsername = await usernameFor(row.voter_id);
        emitDuelVoteReceived({ slot: row.slot, voterUsername, mealId: row.meal_id });
        showToast(voterUsername ? `🏆 @${voterUsername} voted for your ${row.slot}!` : `🏆 Someone voted for your ${row.slot}!`);
        markWinsSeen(user.id).catch(() => {});
      }

      channels = MEAL_TAGS
        .filter(slot => isDuelUnlocked(todayKey, slot) && myMealIdBySlot[slot])
        .map(slot =>
          supabase
            .channel(`duel-live:${todayKey}:${slot}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'post_votes', filter: `slot=eq.${slot}` }, payload => {
              handleRow(payload.new);
            })
            .subscribe()
        );
    })();

    return () => {
      cancelled = true;
      channels.forEach(ch => supabase.removeChannel(ch));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!toast) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.toastWrap, { opacity: toastOpacity }]}>
      <View style={styles.toast}>
        <Text style={styles.toastText}>{toast.text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute', top: TOP_INSET, left: 16, right: 16, zIndex: 999,
  },
  toast: {
    backgroundColor: '#2a2107', borderWidth: 1, borderColor: '#ffd16688',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  toastText: { fontSize: 13, fontWeight: '700', color: '#ffffff', textAlign: 'center' },
});
