import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableWithoutFeedback, StyleSheet, Animated, Easing, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';
import { MEAL_TAGS } from '../lib/postUtils';
import { isDuelUnlocked, markWinsSeen, getWinsSeenAt, newWinsSince, winsForMonth } from '../lib/postVotes';
import { localDateKey } from '../lib/dateKey';
import { THEME as C } from '../lib/theme';

const CONFETTI_EMOJI = ['🎉', '✨', '🏆', '⭐', '🎊'];
const CONFETTI_COUNT = 18;

// One flung particle — random angle/distance/spin computed once per piece,
// remounted (via ConfettiBurst's `key`) each time a celebration fires so it
// always starts from a clean 0.
function ConfettiPiece({ delay }) {
  const anim = useRef(new Animated.Value(0)).current;
  const angleRef = useRef(Math.random() * Math.PI * 2);
  const distanceRef = useRef(90 + Math.random() * 160);
  const spinRef = useRef((Math.random() - 0.5) * 720);
  const emojiRef = useRef(CONFETTI_EMOJI[Math.floor(Math.random() * CONFETTI_EMOJI.length)]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 1300 + Math.random() * 500, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, []);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angleRef.current) * distanceRef.current] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angleRef.current) * distanceRef.current + 60] }); // +60: gravity drift
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${spinRef.current}deg`] });
  const scale = anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0.7] });
  const opacity = anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.Text
      style={[
        styles.confettiPiece,
        { opacity, transform: [{ translateX }, { translateY }, { rotate }, { scale }] },
      ]}
    >
      {emojiRef.current}
    </Animated.Text>
  );
}

function ConfettiBurst() {
  return (
    <View style={styles.confettiOrigin} pointerEvents="none">
      {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
        <ConfettiPiece key={i} delay={i * 12} />
      ))}
    </View>
  );
}


// Mounted once at the app root (see App.js) — the single home for the wins
// celebration, covering both cases with the same full-screen overlay:
//   1. Catch-up: on mount, and again whenever the app returns to the
//      foreground (AppState), compare wins_seen_at against votes received
//      since and celebrate if any arrived.
//   2. Live: a vote landing on one of the user's meals while the app is
//      open, via one realtime channel per (day, slot) duel the user has an
//      entry in today. Same "duel:{day}:{slot}" naming DuelScreen itself
//      subscribes to — Supabase allows multiple independent subscribers per
//      channel name. RLS (friends_can_see_votes, 019) still gates what
//      postgres_changes delivers, so this only ever receives votes the
//      current user is allowed to see.
// This was previously split across MyProfileScreen (which only fired if the
// user happened to open that tab) and a small toast here — now unified so
// it always fires, right when it happens.
export default function DuelLiveListener() {
  const [celebration, setCelebration] = useState(null); // { voters: string[], burstKey: number } | null
  const countAnim = useRef(new Animated.Value(0)).current;
  const [displayedCount, setDisplayedCount] = useState(0);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const trophyScale = useRef(new Animated.Value(0)).current;
  const trophyRotate = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0.6)).current;
  const votersOpacity = useRef(new Animated.Value(0)).current;
  const userIdRef = useRef(null);
  const knownTotalRef = useRef(null); // last total we know of — base for live +1s
  const burstKeyRef = useRef(0);
  const glowLoopRef = useRef(null);

  useEffect(() => {
    const id = countAnim.addListener(({ value }) => setDisplayedCount(Math.round(value)));
    return () => countAnim.removeListener(id);
  }, []);

  function celebrate(from, to, voters) {
    knownTotalRef.current = to;
    burstKeyRef.current += 1;
    setCelebration({ voters, burstKey: burstKeyRef.current });

    countAnim.setValue(from);
    overlayOpacity.setValue(0);
    trophyScale.setValue(0);
    trophyRotate.setValue(0);
    votersOpacity.setValue(0);

    Animated.timing(overlayOpacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.spring(trophyScale, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 18 }),
    ]).start();
    Animated.timing(trophyRotate, {
      toValue: 1, duration: 700, delay: 40, easing: Easing.out(Easing.elastic(1.2)), useNativeDriver: true,
    }).start();
    Animated.timing(countAnim, {
      toValue: to, duration: 1100, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
    Animated.timing(votersOpacity, { toValue: 1, duration: 400, delay: 1300, useNativeDriver: true }).start();

    if (glowLoopRef.current) glowLoopRef.current.stop();
    glowLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0.6, duration: 900, useNativeDriver: true }),
      ])
    );
    glowLoopRef.current.start();
  }

  function dismiss() {
    if (glowLoopRef.current) { glowLoopRef.current.stop(); glowLoopRef.current = null; }
    Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setCelebration(null);
      if (userIdRef.current) markWinsSeen(userIdRef.current).catch(() => {});
    });
  }

  async function runCatchUp(userId) {
    // Same supabase-js hang risk as everywhere else a query fires right
    // around a session change — every step here is timeout-bounded so a
    // stuck client silently skips the celebration instead of never
    // resolving (previously this could hang forever with no error, no log,
    // nothing — indistinguishable from "the animation just isn't playing").
    try {
      const seenAt = await withTimeout(getWinsSeenAt(userId), 6000, 'getWinsSeenAt timed out');
      const now = new Date();
      const total = await withTimeout(
        winsForMonth(userId, now.getFullYear(), now.getMonth()), 6000, 'winsForMonth timed out',
      );

      if (!seenAt) {
        // Never seen before. If wins already exist by this first-ever check
        // (e.g. voted on before ever opening the app once), that's still
        // genuinely new information — celebrate counting up from 0 rather
        // than silently baselining and swallowing it. Only stay silent when
        // there's truly nothing to show yet.
        if (total > 0) {
          const everything = await withTimeout(
            newWinsSince(userId, new Date(0).toISOString()), 6000, 'newWinsSince timed out',
          );
          const voters = [...new Set(everything.map(a => a.voterUsername).filter(Boolean))];
          celebrate(0, total, voters);
        } else {
          knownTotalRef.current = 0;
        }
        await withTimeout(markWinsSeen(userId), 6000, 'markWinsSeen timed out').catch(() => {});
        return;
      }

      const arrived = await withTimeout(newWinsSince(userId, seenAt), 6000, 'newWinsSince timed out');
      if (arrived.length === 0) return;
      const from = Math.max(0, total - arrived.length);
      const voters = [...new Set(arrived.map(a => a.voterUsername).filter(Boolean))];
      celebrate(from, total, voters);
    } catch (err) {
      console.warn('[DuelLiveListener] catch-up check failed:', err.message);
    }
  }

  useEffect(() => {
    let channels = [];
    let cancelled = false;

    (async () => {
      let user;
      try {
        ({ data: { user } } = await withTimeout(supabase.auth.getUser(), 6000, 'getUser timed out'));
      } catch (err) {
        console.warn('[DuelLiveListener] getUser failed:', err.message);
        return;
      }
      if (!user || cancelled) return;
      userIdRef.current = user.id;

      await runCatchUp(user.id);
      if (cancelled) return;

      const now = new Date();
      const todayKey = localDateKey(now);
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      let post;
      try {
        ({ data: post } = await withTimeout(
          supabase
            .from('posts')
            .select('breakfast_meal_id, lunch_meal_id, dinner_meal_id')
            .eq('user_id', user.id)
            .gte('created_at', dayStart)
            .lt('created_at', dayEnd)
            .limit(1)
            .maybeSingle(),
          6000, "today's post lookup timed out",
        ));
      } catch (err) {
        console.warn('[DuelLiveListener] post lookup failed:', err.message);
        return;
      }
      if (!post || cancelled) return;

      const myMealIdBySlot = {
        breakfast: post.breakfast_meal_id,
        lunch: post.lunch_meal_id,
        dinner: post.dinner_meal_id,
      };

      const usernameCache = new Map();
      async function usernameFor(voterId) {
        if (usernameCache.has(voterId)) return usernameCache.get(voterId);
        try {
          const { data } = await withTimeout(
            supabase.from('profiles').select('username').eq('id', voterId).maybeSingle(),
            6000, 'username lookup timed out',
          );
          const uname = data?.username ?? null;
          usernameCache.set(voterId, uname);
          return uname;
        } catch {
          return null;
        }
      }

      async function handleRow(row) {
        if (!row || row.day !== todayKey || row.voter_id === user.id) return;
        if (row.meal_id !== myMealIdBySlot[row.slot]) return;
        const voterUsername = await usernameFor(row.voter_id);
        const from = knownTotalRef.current ?? 0;
        celebrate(from, from + 1, voterUsername ? [voterUsername] : []);
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

  // Returning from the background is the other moment votes could have
  // landed unseen (the realtime channels above only cover while the app is
  // actually foregrounded) — re-run the same catch-up check.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && userIdRef.current) runCatchUp(userIdRef.current);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!celebration) return null;

  const voters = celebration.voters;
  const trophyRotateDeg = trophyRotate.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '0deg'] });

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
      <TouchableWithoutFeedback onPress={dismiss}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      <LinearGradient
        colors={['#3a2a06', '#000000']}
        locations={[0, 0.75]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <ConfettiBurst key={celebration.burstKey} />

      <SafeAreaView style={styles.content} pointerEvents="none">
        <Animated.View style={[styles.glow, { opacity: glowPulse, transform: [{ scale: glowPulse }] }]} />

        <Animated.View
          style={[
            styles.trophyBadge,
            { transform: [{ scale: trophyScale }, { rotate: trophyRotateDeg }] },
          ]}
        >
          <Ionicons name="trophy" size={44} color={C.bg} />
        </Animated.View>

        <Text style={styles.count}>{displayedCount}</Text>
        <Text style={styles.label}>win{displayedCount !== 1 ? 's' : ''} this month</Text>

        {voters.length > 0 && (
          <Animated.Text style={[styles.voters, { opacity: votersOpacity }]}>
            {voters.slice(0, 3).map(u => `@${u}`).join(', ')}
            {voters.length > 3 ? ` +${voters.length - 3} more` : ''} voted for you
          </Animated.Text>
        )}

        <Text style={styles.hint}>Tap anywhere to dismiss</Text>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000', zIndex: 999,
  },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },

  // Soft radial-ish glow behind the trophy badge — a large blurred-looking
  // gold circle that pulses, since RN has no true radial-gradient/blur
  // primitive without a new dependency.
  glow: {
    position: 'absolute', width: 260, height: 260, borderRadius: 130,
    backgroundColor: 'rgba(233,184,114,0.2)',
  },

  trophyBadge: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 24,
    elevation: 12,
  },

  count: {
    fontFamily: C.serif, fontSize: 96, color: C.white, marginTop: 20,
    textShadowColor: 'rgba(233,184,114,0.55)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  label: {
    fontSize: 16, fontWeight: '700', color: C.gold, textTransform: 'uppercase',
    letterSpacing: 2, marginTop: 2,
  },
  voters: { fontSize: 15, color: C.white, textAlign: 'center', marginTop: 28, lineHeight: 22 },
  hint: { position: 'absolute', bottom: 40, fontSize: 12, color: C.gray1 },

  // Confetti burst — absolutely fills the screen so pieces can fly outward
  // from a fixed origin roughly where the trophy sits; each piece is
  // positioned there and animates its own offset from that point.
  confettiOrigin: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
  confettiPiece: {
    position: 'absolute', top: '38%', fontSize: 22,
  },
});
