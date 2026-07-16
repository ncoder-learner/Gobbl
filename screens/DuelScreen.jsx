import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Image, FlatList, StyleSheet,
  StatusBar, Dimensions, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { TAG_META, TAG_ICON } from '../lib/postUtils';
import { castVote, tallyMealVotes } from '../lib/postVotes';
import Avatar from '../components/Avatar';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const C = {
  bg: '#000', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', gold: '#ffd166', white: '#ffffff', gray1: '#888888', gray2: '#666666',
};

// ─── One meal's page — full-bleed photo, same vertical-pager model as
// SlotViewerScreen (this *is* that screen's interaction pattern, just with
// a vote button instead of like/comment). ──────────────────────────────────
function DuelPage({ tile, selected, voteCount, voting, onVote }) {
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!selected) return;
    pop.setValue(1);
    Animated.sequence([
      Animated.spring(pop, { toValue: 1.15, useNativeDriver: true, speed: 26, bounciness: 16 }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 8 }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
      {tile.meal.photo_url ? (
        <Image source={{ uri: tile.meal.photo_url }} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }} resizeMode="cover" />
      ) : (
        <View style={[{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }, styles.photoFallback]}>
          <Text style={styles.photoFallbackEmoji}>{tile.meal.emoji || '🍽️'}</Text>
        </View>
      )}

      <View style={styles.bottomOverlay}>
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.posterRow}>
          <Avatar
            uri={tile.poster?.avatar_url}
            firstName={tile.poster?.first_name}
            lastName={tile.poster?.last_name}
            displayName={tile.poster?.display_name}
            username={tile.poster?.username}
            size={30}
            style={styles.posterAvatar}
            textStyle={styles.posterInitial}
          />
          <Text style={styles.posterUsername}>@{tile.poster?.username ?? 'unknown'}</Text>
          <View style={styles.voteCountBadge}>
            <Ionicons name="trophy" size={13} color="#3a2c00" />
            <Text style={styles.voteCountText}>{voteCount}</Text>
          </View>
        </View>
        <Text style={styles.mealName} numberOfLines={1}>{tile.meal.name}</Text>

        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <TouchableOpacity
            style={[styles.voteBtn, selected && styles.voteBtnSelected]}
            onPress={onVote}
            disabled={voting}
            activeOpacity={0.85}
          >
            <Ionicons name={selected ? 'trophy' : 'trophy-outline'} size={20} color={selected ? '#3a2c00' : C.white} />
            <Text style={[styles.voteBtnText, selected && styles.voteBtnTextSelected]}>
              {selected ? 'Your vote' : 'Vote for this'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

export default function DuelScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { tag, day, people: allPeople = [] } = route.params || {};
  const meta = TAG_META[tag] || { label: tag };

  // Own meal never appears in the deck — there's nothing to vote for there.
  const people = allPeople.filter(p => !p.isMine);

  const [activeIndex, setActiveIndex] = useState(0);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [voteCounts, setVoteCounts] = useState({});     // mealId -> count
  const [myVoteMealId, setMyVoteMealId] = useState(null);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState(null);

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
  // screen is open updates the deck immediately. RLS (friends_can_see_votes,
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

  function onMomentumEnd(e) {
    const idx = Math.round(e.nativeEvent.contentOffset.y / SCREEN_HEIGHT);
    setActiveIndex(idx);
  }

  if (people.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <TouchableOpacity style={styles.emptyBackBtn} onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={C.white} />
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Nothing to vote on.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <FlatList
        data={people}
        keyExtractor={t => t.mealId}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * i, index: i })}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item }) => (
          <DuelPage
            tile={item}
            selected={myVoteMealId === item.mealId}
            voteCount={voteCounts[item.mealId] || 0}
            voting={voting}
            onVote={() => handleVote(item)}
          />
        )}
      />

      <SafeAreaView style={styles.topOverlay} edges={['top']} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Position across the meals in this duel — the one progress axis
            that exists here (each meal is a single full-bleed page, so
            there's no per-photo sub-bar the way SlotViewerScreen has). */}
        <View style={styles.segmentRow}>
          {people.map((_, i) => (
            <View key={i} style={[styles.segment, i <= activeIndex && styles.segmentActive]} />
          ))}
        </View>
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
      </SafeAreaView>

      {error ? (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: C.gray1 },
  emptyBackBtn: { padding: 16 },

  // Top overlay
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  segmentRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 10 },
  segment: { flex: 1, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.25)' },
  segmentActive: { backgroundColor: C.gold },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10,
  },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '700', color: C.white },

  // Photo
  photoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#151515' },
  photoFallbackEmoji: { fontSize: 64 },

  // Bottom overlay
  bottomOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 40, paddingBottom: 28,
  },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 6 },
  posterAvatar: { borderWidth: 1, borderColor: C.border },
  posterInitial: { color: C.white },
  posterUsername: { fontSize: 15, fontWeight: '700', color: C.white, flex: 1 },
  voteCountBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.gold, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  voteCountText: { fontSize: 12, fontWeight: '800', color: '#3a2c00' },
  mealName: { fontSize: 17, fontWeight: '700', color: C.white, marginBottom: 16 },

  voteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 16, paddingVertical: 15,
  },
  voteBtnSelected: { backgroundColor: C.gold, borderColor: C.gold },
  voteBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
  voteBtnTextSelected: { color: '#3a2c00' },

  errorBanner: {
    position: 'absolute', bottom: 110, left: 16, right: 16,
    backgroundColor: 'rgba(42,10,10,0.9)', borderWidth: 0.5, borderColor: '#5a1a1a',
    borderRadius: 10, padding: 12,
  },
  errorText: { fontSize: 13, color: '#ff6b6b', lineHeight: 18, textAlign: 'center' },
});
