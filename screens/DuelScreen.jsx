import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  StatusBar, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { TAG_META, TAG_ICON } from '../lib/postUtils';
import { castVote, tallyMealVotes } from '../lib/postVotes';
import Avatar from '../components/Avatar';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from '../components/StripedPlaceholder';

const SLOT_CLOSE_LABEL = { breakfast: '11:00', lunch: '16:00', dinner: '21:00' };

// Splits a round into 2-up pairs. An odd contestant out gets a bye — they
// skip straight to next round instead of sitting out the whole duel.
function buildPairs(contestants) {
  const arr = [...contestants];
  const byes = arr.length % 2 === 1 ? [arr.pop()] : [];
  const pairs = [];
  for (let i = 0; i < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
  return { pairs, byes };
}

// ─── One side of a head-to-head pair ──────────────────────────────────────────
function PairCard({ tile, pct, voteCount, onPress, style }) {
  return (
    <TouchableOpacity style={[styles.pairCard, style]} onPress={onPress} activeOpacity={0.9}>
      {tile.meal.photo_url ? (
        <Image source={{ uri: tile.meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <StripedPlaceholder style={StyleSheet.absoluteFill}>
          <View style={styles.pairFallback}>
            <Text style={styles.pairFallbackEmoji}>{tile.meal.emoji || '🍽️'}</Text>
          </View>
        </StripedPlaceholder>
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.9)']}
        locations={[0.3, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.pairBottom}>
        <View style={styles.pairPosterRow}>
          <Avatar
            uri={tile.poster?.avatar_url}
            firstName={tile.poster?.first_name}
            lastName={tile.poster?.last_name}
            displayName={tile.poster?.display_name}
            username={tile.poster?.username}
            size={26}
            style={styles.pairAvatar}
            textStyle={styles.pairAvatarLetter}
          />
          <Text style={styles.pairUsername} numberOfLines={1}>@{tile.poster?.username ?? 'unknown'}</Text>
          <Text style={styles.pairPct}>{pct}%</Text>
        </View>
        <Text style={styles.pairName} numberOfLines={1}>{tile.meal.name}</Text>
        <View style={styles.pairBarTrack}>
          <View style={[styles.pairBarFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.pairVotes}>{voteCount} {voteCount === 1 ? 'vote' : 'votes'}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Results — shown once you've voted (or reached the end of the bracket) ────
function ResultsList({ people, voteCounts, myVoteMealId, onRedo }) {
  const totalVotes = people.reduce((sum, p) => sum + (voteCounts[p.mealId] || 0), 0);
  const maxCount = Math.max(0, ...people.map(p => voteCounts[p.mealId] || 0));
  const sorted = [...people].sort((a, b) => (voteCounts[b.mealId] || 0) - (voteCounts[a.mealId] || 0));

  return (
    <View style={styles.resultsWrap}>
      {sorted.map(tile => {
        const count = voteCounts[tile.mealId] || 0;
        const isLeader = count > 0 && count === maxCount;
        const isMine = tile.mealId === myVoteMealId;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        return (
          <View key={tile.mealId} style={[styles.resultRow, isLeader && styles.resultRowLeader]}>
            {tile.meal.photo_url ? (
              <Image source={{ uri: tile.meal.photo_url }} style={styles.resultThumb} resizeMode="cover" />
            ) : (
              <StripedPlaceholder style={styles.resultThumb}>
                <View style={styles.resultThumbFallback}>
                  <Text style={{ fontSize: 18 }}>{tile.meal.emoji || '🍽️'}</Text>
                </View>
              </StripedPlaceholder>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName} numberOfLines={1}>{tile.meal.name}</Text>
              <Text style={styles.resultMeta} numberOfLines={1}>
                @{tile.poster?.username ?? 'unknown'}{isMine ? ' · your vote' : ''}
              </Text>
            </View>
            {isLeader && <Ionicons name="trophy" size={16} color={C.gold} style={{ marginRight: 4 }} />}
            <Text style={[styles.resultCount, isLeader && { color: C.gold }]}>{pct}%</Text>
          </View>
        );
      })}

      <TouchableOpacity style={styles.redoBtn} onPress={onRedo} activeOpacity={0.85}>
        <Ionicons name="refresh" size={16} color={C.white} />
        <Text style={styles.redoBtnText}>Redo bracket</Text>
      </TouchableOpacity>
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

  const [currentUserId, setCurrentUserId] = useState(null);
  const [voteCounts, setVoteCounts] = useState({});     // mealId -> count
  const [myVoteMealId, setMyVoteMealId] = useState(null);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [viewMode, setViewMode] = useState(null); // 'bracket' | 'results'

  // ── Bracket state ──
  const [round, setRound] = useState(people);
  const [pairIndex, setPairIndex] = useState(0);
  const [winnersAcc, setWinnersAcc] = useState([]);
  const { pairs, byes } = useMemo(() => buildPairs(round), [round]);

  useEffect(() => {
    setWinnersAcc(byes);
    setPairIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

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
        setViewMode(tally.myVoteMealId ? 'results' : 'bracket');
      } catch (err) {
        console.warn('[Duel] failed to load votes:', err.message);
        setViewMode('bracket');
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, day]);

  // Live tally — anyone else voting (or moving their vote) while this
  // screen is open updates the deck immediately. RLS (friends_can_see_votes,
  // 019) already scopes what this channel delivers to what the viewer may
  // see, so nothing further to filter client-side beyond the slot/day match.
  useEffect(() => {
    const channel = supabase
      .channel(`duel:${day}:${tag}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_votes', filter: `slot=eq.${tag}` }, payload => {
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

  // Only the final bracket winner is ever written — post_votes is unique on
  // (voter_id, slot, day), so intermediate picks along the way are UI-only.
  async function finalizeWinner(tile) {
    const prevVoteMealId = myVoteMealId;
    const prevCounts = voteCounts;
    setVoting(true);
    setError(null);
    const nextCounts = { ...voteCounts };
    if (prevVoteMealId && prevVoteMealId !== tile.mealId) {
      nextCounts[prevVoteMealId] = Math.max(0, (nextCounts[prevVoteMealId] || 0) - 1);
    }
    nextCounts[tile.mealId] = (nextCounts[tile.mealId] || 0) + 1;
    setVoteCounts(nextCounts);
    setMyVoteMealId(tile.mealId);
    setViewMode('results');

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

  function pickWinner(tile) {
    if (voting) return;
    const nextWinners = [...winnersAcc, tile];
    const nextPairIndex = pairIndex + 1;
    if (nextPairIndex < pairs.length) {
      setWinnersAcc(nextWinners);
      setPairIndex(nextPairIndex);
      return;
    }
    // Round complete.
    if (nextWinners.length <= 1) {
      finalizeWinner(nextWinners[0] ?? tile);
    } else {
      setRound(nextWinners);
    }
  }

  function redoBracket() {
    setRound(people);
    setViewMode('bracket');
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

  const currentPair = pairs[pairIndex];
  const totalVotes = people.reduce((sum, p) => sum + (voteCounts[p.mealId] || 0), 0);
  const pctOf = mealId => totalVotes > 0 ? Math.round(((voteCounts[mealId] || 0) / totalVotes) * 100) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={C.white} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          {TAG_ICON[tag] && <Feather name={TAG_ICON[tag]} size={13} color={C.gold} />}
          <Text style={styles.title}>{meta.label} Duel</Text>
        </View>
        <View style={styles.closesChip}>
          <Text style={styles.closesChipText}>closes {SLOT_CLOSE_LABEL[tag] ?? ''}</Text>
        </View>
      </View>

      {!loaded ? (
        <View style={styles.center} />
      ) : viewMode === 'results' ? (
        <ResultsList
          people={people}
          voteCounts={voteCounts}
          myVoteMealId={myVoteMealId}
          onRedo={redoBracket}
        />
      ) : !currentPair && round.length === 1 ? (
        // Only one friend posted in this slot — nothing to bracket against,
        // just a direct confirm rather than a matchup.
        <View style={styles.bracketWrap}>
          <Text style={styles.prompt}>Vote for {round[0].meal.name}?</Text>
          <View style={styles.pairsWrap}>
            <PairCard
              tile={round[0]}
              pct={pctOf(round[0].mealId)}
              voteCount={voteCounts[round[0].mealId] || 0}
              onPress={() => finalizeWinner(round[0])}
            />
          </View>
          <Text style={styles.hint}>Tap to confirm your vote.</Text>
        </View>
      ) : currentPair ? (
        <View style={styles.bracketWrap}>
          <Text style={styles.prompt}>Which {meta.label?.toLowerCase()} wins?</Text>
          <View style={styles.pairsWrap}>
            <PairCard
              tile={currentPair[0]}
              pct={pctOf(currentPair[0].mealId)}
              voteCount={voteCounts[currentPair[0].mealId] || 0}
              onPress={() => pickWinner(currentPair[0])}
              style={{ marginBottom: 6 }}
            />
            <View style={styles.vsBadge}>
              <Text style={styles.vsBadgeText}>VS</Text>
            </View>
            <PairCard
              tile={currentPair[1]}
              pct={pctOf(currentPair[1].mealId)}
              voteCount={voteCounts[currentPair[1].mealId] || 0}
              onPress={() => pickWinner(currentPair[1])}
            />
          </View>
          <Text style={styles.hint}>Tap a meal to advance it — you can redo the bracket anytime.</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: C.gray1 },
  emptyBackBtn: { padding: 16 },

  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '700', color: C.white },
  closesChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: C.pill,
    backgroundColor: 'rgba(233,184,114,0.14)',
  },
  closesChipText: { fontSize: 11, color: C.gold, fontWeight: '600' },

  // Bracket
  bracketWrap: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  prompt: { fontFamily: C.serif, fontSize: 24, color: C.white, textAlign: 'center', marginBottom: 16 },
  pairsWrap: { flex: 1, position: 'relative' },
  hint: { fontSize: 12, color: C.gray1, textAlign: 'center', paddingVertical: 16 },

  pairCard: {
    flex: 1, borderRadius: 22, overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: C.glassBorder, backgroundColor: '#1a1a1a',
  },
  pairFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pairFallbackEmoji: { fontSize: 44 },
  pairBottom: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  pairPosterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  pairAvatar: { borderWidth: 1, borderColor: C.glassBorder },
  pairAvatarLetter: { color: C.white },
  pairUsername: { flex: 1, fontSize: 13, fontWeight: '700', color: C.white },
  pairPct: { fontFamily: C.serif, fontSize: 22, color: C.white },
  pairName: { fontFamily: C.serif, fontSize: 20, color: C.white },
  pairBarTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 8 },
  pairBarFill: { height: '100%', borderRadius: 3, backgroundColor: C.orange },
  pairVotes: { fontSize: 11, color: 'rgba(245,245,247,0.6)', marginTop: 5 },

  vsBadge: {
    position: 'absolute', top: '50%', left: '50%', marginLeft: -27, marginTop: -27,
    zIndex: 3, width: 54, height: 54, borderRadius: 27,
    backgroundColor: C.white, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },
  vsBadgeText: { fontFamily: C.serifItalic, fontSize: 18, color: C.bg },

  // Results
  resultsWrap: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.glassBg, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 16, padding: 12, marginBottom: 10,
  },
  resultRowLeader: { borderColor: C.gold },
  resultThumb: { width: 46, height: 46, borderRadius: 12, backgroundColor: C.bg },
  resultThumbFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  resultName: { fontSize: 14, fontWeight: '600', color: C.white },
  resultMeta: { fontSize: 12, color: C.gray2, marginTop: 1 },
  resultCount: { fontFamily: C.serif, fontSize: 20, color: C.white },

  redoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 8, paddingVertical: 14, borderRadius: C.pill,
    borderWidth: 1, borderColor: C.glassBorder, backgroundColor: C.glassBg,
  },
  redoBtnText: { fontSize: 14, fontWeight: '700', color: C.white },

  errorBanner: {
    position: 'absolute', bottom: 30, left: 16, right: 16,
    backgroundColor: C.redDim, borderWidth: 0.5, borderColor: C.redBorder,
    borderRadius: 10, padding: 12,
  },
  errorText: { fontSize: 13, color: C.red, lineHeight: 18, textAlign: 'center' },
});
