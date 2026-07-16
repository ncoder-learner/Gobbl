import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  StatusBar, Dimensions, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { TAG_META, TAG_ICON } from '../lib/postUtils';
import { castVote, tallyMealVotes } from '../lib/postVotes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const WHEEL_SIZE = Math.min(SCREEN_WIDTH * 0.9, 360);
const PHOTO_SIZE = 76;
const RADIUS = WHEEL_SIZE / 2 - PHOTO_SIZE / 2 - 6;
const SPIN_DURATION = 42000; // one full slow revolution — decorative, not dizzying

const C = {
  bg: '#000', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', gold: '#ffd166', white: '#ffffff', gray1: '#888888', gray2: '#666666',
};

// One photo riding the wheel. Position is a fixed offset from the wheel's
// center (computed from its slot index); the *parent* wheel is what
// actually spins (see DuelScreen) — this just counter-rotates by the same
// amount so the photo itself stays upright while its position revolves.
function DuelPhoto({ tile, angle, counterRotate, selected, isMine, voteCount, onPress }) {
  const x = RADIUS * Math.cos(angle);
  const y = RADIUS * Math.sin(angle);
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!selected) return;
    pop.setValue(1);
    Animated.sequence([
      Animated.spring(pop, { toValue: 1.3, useNativeDriver: true, speed: 30, bounciness: 14 }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 8 }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <Animated.View
      style={[
        styles.wheelItem,
        {
          left: WHEEL_SIZE / 2 + x - PHOTO_SIZE / 2,
          top: WHEEL_SIZE / 2 + y - PHOTO_SIZE / 2,
          transform: [{ rotate: counterRotate }],
        },
      ]}
    >
      <TouchableOpacity onPress={onPress} disabled={isMine} activeOpacity={0.8} style={styles.wheelItemTouch}>
        <Animated.View
          style={[
            styles.photoRing,
            selected && styles.photoRingSelected,
            isMine && styles.photoRingMine,
            { transform: [{ scale: pop }] },
          ]}
        >
          {tile.meal.photo_url ? (
            <Image source={{ uri: tile.meal.photo_url }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={[styles.photo, styles.photoFallback]}>
              <Text style={{ fontSize: 26 }}>{tile.meal.emoji || '🍽️'}</Text>
            </View>
          )}
          {voteCount > 0 && (
            <View style={styles.voteBadge}>
              <Text style={styles.voteBadgeText}>{voteCount}</Text>
            </View>
          )}
        </Animated.View>
        <Text style={styles.photoUsername} numberOfLines={1}>
          {isMine ? 'You' : `@${tile.poster?.username ?? '?'}`}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function DuelScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { tag, day, people = [] } = route.params || {};
  const meta = TAG_META[tag] || { label: tag };

  const [currentUserId, setCurrentUserId] = useState(null);
  const [voteCounts, setVoteCounts] = useState({});     // mealId -> count
  const [myVoteMealId, setMyVoteMealId] = useState(null);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState(null);

  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: SPIN_DURATION, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);
  const wheelRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const counterRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
      try {
        const { data, error: err } = await supabase
          .from('post_votes')
          .select('voter_id, meal_id')
          .eq('slot', tag)
          .eq('day', day);
        if (err) throw err;
        const tally = tallyMealVotes(data, user?.id ?? null);
        setVoteCounts(tally.counts);
        setMyVoteMealId(tally.myVoteMealId);
      } catch (err) {
        console.warn('[Duel] failed to load votes:', err.message);
      }
    })();
  }, [tag, day]);

  // Live tally — anyone else voting (or moving their vote) while this
  // screen is open updates the wheel immediately. RLS (friends_can_see_votes,
  // 019) already scopes what this channel delivers to what the viewer may
  // see, so nothing further to filter client-side beyond the slot/day match.
  useEffect(() => {
    const channel = supabase
      .channel(`duel:${day}:${tag}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_votes', filter: `slot=eq.${tag}` }, payload => {
        // "Moving" a vote to a different meal is an UPDATE that changes
        // meal_id itself (upsert target is UNIQUE(voter_id, slot, day), not
        // the PK) — old.meal_id is still available since meal_id is part of
        // the PK, which Postgres always includes in the old tuple regardless
        // of REPLICA IDENTITY. Own votes are skipped here since the local
        // optimistic update in handleVote already accounts for them.
        if (payload.eventType === 'INSERT') {
          const row = payload.new;
          if (row.day !== day || row.voter_id === currentUserId) return;
          setVoteCounts(c => ({ ...c, [row.meal_id]: (c[row.meal_id] || 0) + 1 }));
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new;
          if (row.day !== day || row.voter_id === currentUserId) return;
          const oldMealId = payload.old?.meal_id;
          setVoteCounts(c => {
            const next = { ...c };
            if (oldMealId && oldMealId !== row.meal_id) {
              next[oldMealId] = Math.max(0, (next[oldMealId] || 0) - 1);
            }
            next[row.meal_id] = (next[row.meal_id] || 0) + 1;
            return next;
          });
        } else if (payload.eventType === 'DELETE') {
          const oldMealId = payload.old?.meal_id;
          if (!oldMealId) return;
          setVoteCounts(c => ({ ...c, [oldMealId]: Math.max(0, (c[oldMealId] || 0) - 1) }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, day, currentUserId]);

  async function handleVote(tile) {
    if (!currentUserId || tile.isMine || voting) return;
    const prevVoteMealId = myVoteMealId;
    const prevCounts = voteCounts;
    if (prevVoteMealId === tile.mealId) return; // already your pick

    setVoting(true);
    setError(null);
    const nextCounts = { ...voteCounts };
    if (prevVoteMealId) nextCounts[prevVoteMealId] = Math.max(0, (nextCounts[prevVoteMealId] || 0) - 1);
    nextCounts[tile.mealId] = (nextCounts[tile.mealId] || 0) + 1;
    setVoteCounts(nextCounts);
    setMyVoteMealId(tile.mealId);

    try {
      await castVote(currentUserId, tile.mealId, tag, day);
    } catch (err) {
      setVoteCounts(prevCounts);
      setMyVoteMealId(prevVoteMealId);
      setError(err.message || 'Could not save your vote. Try again.');
    } finally {
      setVoting(false);
    }
  }

  return (
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <LinearGradient colors={['#1a1206', C.bg]} locations={[0, 0.5]} style={StyleSheet.absoluteFill} pointerEvents="none" />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={C.white} />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            {TAG_ICON[tag] && <Feather name={TAG_ICON[tag]} size={14} color={C.gold} />}
            <Text style={styles.title}>{meta.label} Duel</Text>
          </View>
          <View style={{ width: 26 }} />
        </View>
        <Text style={styles.subtitle}>
          {myVoteMealId ? 'Tap another photo to change your vote' : 'Tap your favorite to vote'}
        </Text>

        <View style={styles.wheelWrap}>
          <Animated.View style={[styles.wheel, { transform: [{ rotate: wheelRotate }] }]}>
            {people.map((tile, i) => (
              <DuelPhoto
                key={tile.mealId}
                tile={tile}
                angle={(i / people.length) * 2 * Math.PI - Math.PI / 2}
                counterRotate={counterRotate}
                selected={myVoteMealId === tile.mealId}
                isMine={tile.isMine}
                voteCount={voteCounts[tile.mealId] || 0}
                onPress={() => handleVote(tile)}
              />
            ))}
          </Animated.View>
          <View style={styles.wheelCenter} pointerEvents="none">
            <Ionicons name="trophy" size={26} color={C.gold} />
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Text style={styles.footerHint}>
          Can't vote for your own meal · one vote per day, changeable anytime
        </Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4,
  },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16, fontWeight: '700', color: C.white },
  subtitle: { fontSize: 13, color: C.gray1, textAlign: 'center', marginTop: 6 },

  wheelWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },
  wheel: { width: WHEEL_SIZE, height: WHEEL_SIZE },
  wheelCenter: {
    position: 'absolute', width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,209,102,0.12)', borderWidth: 1, borderColor: C.gold + '55',
    alignItems: 'center', justifyContent: 'center',
  },

  wheelItem: { position: 'absolute', width: PHOTO_SIZE, alignItems: 'center' },
  wheelItemTouch: { alignItems: 'center', gap: 5 },
  photoRing: {
    width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2,
    borderWidth: 2, borderColor: C.border, overflow: 'hidden',
    backgroundColor: '#111',
  },
  photoRingSelected: { borderColor: C.gold, borderWidth: 3 },
  photoRingMine: { opacity: 0.55, borderColor: C.border },
  photo: { width: '100%', height: '100%' },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoUsername: { fontSize: 11, fontWeight: '600', color: C.white, maxWidth: PHOTO_SIZE + 14 },

  voteBadge: {
    position: 'absolute', bottom: -4, right: -4,
    backgroundColor: C.gold, borderRadius: 10,
    minWidth: 20, height: 20, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.bg,
  },
  voteBadgeText: { fontSize: 10, fontWeight: '800', color: '#3a2c00' },

  errorText: { fontSize: 12, color: '#ff6b6b', textAlign: 'center', marginBottom: 8 },
  footerHint: { fontSize: 11, color: C.gray2, textAlign: 'center', paddingBottom: 14, paddingHorizontal: 24 },
});
