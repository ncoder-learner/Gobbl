import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  StatusBar, Dimensions, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import CommentSheet from '../components/CommentSheet';
import { bannerColorHex } from '../lib/profileTheme';
import { winsForMonth } from '../lib/postVotes';
import { shareProfileLink } from '../lib/profileLink';
import { fetchSkipDayKeys } from '../lib/skips';
import { localDateKey } from '../lib/dateKey';
import { MEAL_TAGS } from '../lib/postUtils';
import Avatar from '../components/Avatar';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from '../components/StripedPlaceholder';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Wins are derived (COUNT(*) of post_votes on a user's meals), never
// stored — this walks back `monthsBack` months from `now` and queries each
// independently rather than reading any counter column.
async function loadWinsByMonth(userId, now, monthsBack = 6) {
  const months = [];
  for (let i = 0; i <= monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  const counts = await Promise.all(months.map(({ year, month }) => winsForMonth(userId, year, month)));
  return months.map((m, i) => ({ ...m, wins: counts[i] }));
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_COLS  = 2;
const GRID_GAP   = 10;
const CARD_WIDTH  = (SCREEN_WIDTH - 32 - GRID_GAP) / GRID_COLS;
const CARD_HEIGHT = CARD_WIDTH * 1.4;

function scoreToneColor(score) {
  const n = typeof score === 'number' ? score : Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return C.orange;
  if (n < 9) return C.green;
  return C.gold;
}

function formatScore(score) {
  const n = typeof score === 'number' ? score : Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

// Own-profile header shows the user's real name, not the (now-removed)
// email-derived display_name — first_name/last_name come from the
// post-signup profile step; display_name only survives here as a fallback
// for whatever a user may have typed into Account Settings themselves.
function fullName(profile) {
  const first = profile?.first_name?.trim();
  const last = profile?.last_name?.trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  return profile?.display_name?.trim() || null;
}

// extraDayKeys are days resolved by a skip (not a logged meal) — merged in
// so a skipped day counts the same as a logged one for streak purposes.
function computeStreak(rows, extraDayKeys) {
  const dateSet = new Set((rows || []).map(r => localDateKey(new Date(r.created_at))));
  if (extraDayKeys) for (const k of extraDayKeys) dateSet.add(k);
  if (dateSet.size === 0) return 0;
  const todayKey = localDateKey(new Date());
  const loggedToday = dateSet.has(todayKey);
  let streak = 0;
  const cursor = new Date();
  if (!loggedToday) cursor.setDate(cursor.getDate() - 1);
  while (dateSet.has(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ─── Mini post card ───────────────────────────────────────────────────────────

function MiniPostCard({ slot, onPress }) {
  const { meal, tierRank, likeCount, cmtCount } = slot;

  return (
    <TouchableOpacity style={styles.gridCard} activeOpacity={0.85} onPress={onPress}>
      {meal.photo_url ? (
        <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <StripedPlaceholder style={StyleSheet.absoluteFill}>
          <View style={styles.gridNoPhoto}>
            <Text style={styles.gridEmoji}>{meal.emoji || '🍽️'}</Text>
          </View>
        </StripedPlaceholder>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']}
        locations={[0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.gridScoreBadge, { backgroundColor: scoreToneColor(meal.score) }]}>
        <Text style={styles.gridScoreText}>{formatScore(meal.score)}</Text>
      </View>
      {tierRank != null && tierRank <= 10 && (
        <View style={[styles.gridTierPill, { borderColor: scoreToneColor(meal.score) + 'aa' }]}>
          <Text style={[styles.gridTierText, { color: scoreToneColor(meal.score) }]}>#{tierRank}</Text>
        </View>
      )}
      <Text style={styles.gridMealName} numberOfLines={1}>{meal.name}</Text>
      {(likeCount > 0 || cmtCount > 0) && (
        <View style={styles.gridStats}>
          {likeCount > 0 && (
            <View style={styles.gridStat}>
              <Ionicons name="heart" size={10} color="#ff4d6a" />
              <Text style={styles.gridStatText}>{likeCount}</Text>
            </View>
          )}
          {cmtCount > 0 && (
            <View style={styles.gridStat}>
              <Ionicons name="chatbubble" size={10} color="rgba(255,255,255,0.6)" />
              <Text style={styles.gridStatText}>{cmtCount}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Stats row ────────────────────────────────────────────────────────────────

function StatsRow({ totalMeals, avgScore, streak }) {
  return (
    <View style={styles.statsRow}>
      <View style={styles.statCard}>
        <Text style={styles.statValue}>{totalMeals}</Text>
        <Text style={styles.statLabel}>meals</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={[styles.statValue, { color: C.orange }]}>{avgScore !== null ? avgScore.toFixed(1) : '—'}</Text>
        <Text style={styles.statLabel}>avg score</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={[styles.statValue, { color: C.orange }]}>{streak > 0 ? streak : '—'}</Text>
        <Text style={styles.statLabel}>streak</Text>
      </View>
    </View>
  );
}

// ─── Wins card ────────────────────────────────────────────────────────────────
// Tier Duel wins: current month shown prominently, past months (with any
// wins) listed below as history — nothing to show below that just renders
// nothing, since a 0-win history row isn't meaningful.

function WinsCard({ wins, history }) {
  const now = new Date();
  return (
    <View style={styles.winsCard}>
      <View style={styles.winsHeaderRow}>
        <Ionicons name="trophy" size={18} color={C.gold} />
        <Text style={styles.winsHeaderLabel}>{MONTH_NAMES[now.getMonth()]} wins</Text>
      </View>
      <Text style={styles.winsCurrentValue}>{wins}</Text>

      {history.length > 0 && (
        <View style={styles.winsHistoryList}>
          {history.map(h => (
            <View key={`${h.year}-${h.month}`} style={styles.winsHistoryRow}>
              <Text style={styles.winsHistoryMonth}>{MONTH_NAMES[h.month]} {h.year}</Text>
              <Text style={styles.winsHistoryCount}>{h.wins} win{h.wins !== 1 ? 's' : ''}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MyProfileScreen() {
  const navigation = useNavigation();

  const [profile, setProfile]       = useState(null);
  const [posts, setPosts]           = useState([]);
  const [totalMeals, setTotalMeals] = useState(0);
  const [avgScore, setAvgScore]     = useState(null);
  const [streak, setStreak]         = useState(0);
  const [currentMonthWins, setCurrentMonthWins] = useState(0);
  const [winsHistory, setWinsHistory] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedPost, setSelectedPost] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [profileResult, postsResult, mealsResult, winsResult, skipDayKeysResult] = await Promise.allSettled([
        supabase.from('profiles')
          .select('id, username, first_name, last_name, display_name, avatar_url, bio, banner_color')
          .eq('id', user.id)
          .single(),

        // meal_id only ever mirrors ONE of a post's up-to-3 filled slots
        // (breakfast/lunch/dinner) — a day where the user posted all three
        // is still a single posts row, so this needs every slot joined, not
        // just the primary one, or "Recent posts" silently drops 2 of 3.
        supabase.from('posts')
          .select(`
            id, tier_rank, created_at, meal_id,
            breakfast:meals!breakfast_meal_id(id, name, emoji, score, photo_url),
            lunch:meals!lunch_meal_id(id, name, emoji, score, photo_url),
            dinner:meals!dinner_meal_id(id, name, emoji, score, photo_url),
            post_likes(user_id), post_comments(id)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60),

        supabase.from('meals')
          .select('score, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),

        loadWinsByMonth(user.id, new Date()),

        fetchSkipDayKeys(user.id),
      ]);

      if (profileResult.status === 'fulfilled') {
        setProfile(profileResult.value.data);
      }

      if (postsResult.status === 'fulfilled') {
        setPosts(postsResult.value.data || []);
      }

      if (mealsResult.status === 'fulfilled') {
        const meals = mealsResult.value.data || [];
        setTotalMeals(meals.length);
        if (meals.length > 0) {
          const scores = meals.map(m => Number(m.score)).filter(s => !isNaN(s));
          setAvgScore(scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null);
        }
        const skipDayKeys = skipDayKeysResult.status === 'fulfilled' ? skipDayKeysResult.value : new Set();
        setStreak(computeStreak(meals, skipDayKeys));
      }

      if (winsResult.status === 'fulfilled') {
        const byMonth = winsResult.value;
        setCurrentMonthWins(byMonth[0]?.wins ?? 0);
        setWinsHistory(byMonth.slice(1).filter(m => m.wins > 0));
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }

  const bannerHex = bannerColorHex(profile?.banner_color);

  const listHeader = (
    <View style={styles.profileHeader}>
      <LinearGradient
        colors={[bannerHex, '#7a2f12']}
        style={styles.banner}
      >
        <TouchableOpacity
          onPress={() => shareProfileLink(profile?.username)}
          hitSlop={12}
          style={styles.shareBtn}
        >
          <Ionicons name="share-outline" size={20} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
      </LinearGradient>

      <View style={styles.headerRow}>
        <View style={styles.avatarWrap}>
          <Avatar
            uri={profile?.avatar_url}
            firstName={profile?.first_name}
            lastName={profile?.last_name}
            displayName={profile?.display_name}
            username={profile?.username}
            size={80}
            style={styles.bigAvatar}
            textStyle={styles.bigAvatarLetter}
          />
          {currentMonthWins > 0 && (
            <View style={styles.avatarWinsBadge}>
              <Ionicons name="trophy" size={10} color={C.bg} />
              <Text style={styles.avatarWinsBadgeText}>{currentMonthWins}</Text>
            </View>
          )}
        </View>

        <View style={styles.nameRow}>
          <View style={{ flex: 1 }}>
            {fullName(profile) ? (
              <Text style={styles.displayName}>{fullName(profile)}</Text>
            ) : null}
            <Text style={styles.username}>@{profile?.username ?? '…'}</Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('AccountSettings')}
            style={styles.editBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.profileBody}>
        {profile?.bio ? (
          <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text>
        ) : null}

        <StatsRow totalMeals={totalMeals} avgScore={avgScore} streak={streak} />

        <WinsCard wins={currentMonthWins} history={winsHistory} />

        <View style={styles.postsSectionHeader}>
          <Text style={styles.postsSectionTitle}>Recent posts</Text>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.orange} />
        </View>
      </SafeAreaView>
    );
  }

  // One card per filled slot (breakfast/lunch/dinner), not one per posts
  // row — a day where all three were posted is still a single row, so
  // flattening here is what actually surfaces all of them.
  const postSlots = posts.flatMap(post => {
    const likeCount = (post.post_likes || []).length;
    const cmtCount  = (post.post_comments || []).length;
    return MEAL_TAGS
      .map(tag => post[tag])
      .filter(Boolean)
      .map(meal => ({
        key: `${post.id}-${meal.id}`,
        postId: post.id,
        mealId: meal.id,
        meal,
        tierRank: meal.id === post.meal_id ? post.tier_rank : null,
        likeCount,
        cmtCount,
      }));
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <FlatList
        data={postSlots}
        keyExtractor={item => item.key}
        numColumns={GRID_COLS}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => <MiniPostCard slot={item} onPress={() => setSelectedPost(item)} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.noPostsBox}>
            <Text style={styles.noPostsText}>No posts yet. Share a meal from History!</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />

      <CommentSheet
        visible={selectedPost !== null}
        postId={selectedPost?.postId}
        mealId={selectedPost?.mealId}
        postOwnerId={profile?.id}
        onDismiss={() => setSelectedPost(null)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 40 },

  profileHeader: {
    width: '100%', paddingBottom: 4,
  },
  banner: {
    width: '100%', height: 130,
  },
  shareBtn: {
    position: 'absolute', top: 10, right: 16, padding: 4,
  },
  headerRow: { paddingHorizontal: 20, marginTop: -40 },
  avatarWrap: {},
  bigAvatar: {
    backgroundColor: '#242424', borderWidth: 3, borderColor: C.bg,
  },
  bigAvatarLetter: { color: C.white },
  avatarWinsBadge: {
    position: 'absolute', bottom: -2, right: -2,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.gold, borderRadius: 10,
    minWidth: 22, height: 20, paddingHorizontal: 5,
    borderWidth: 2, borderColor: C.bg,
  },
  avatarWinsBadgeText: { fontSize: 10, fontWeight: '800', color: C.bg },

  nameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  editBtn: {
    paddingVertical: 9, paddingHorizontal: 18, borderRadius: C.pill,
    borderWidth: 1, borderColor: 'rgba(245,245,247,0.2)',
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: C.white },

  profileBody: { alignItems: 'flex-start', width: '100%', paddingHorizontal: 20, paddingTop: 12 },
  displayName: { fontFamily: C.serif, fontSize: 24, color: C.white, marginBottom: 1 },
  username: { fontSize: 13, color: 'rgba(245,245,247,0.45)' },
  bio: { fontSize: 13, color: 'rgba(245,245,247,0.6)', lineHeight: 20, marginTop: 12, marginBottom: 20 },

  statsRow: {
    flexDirection: 'row', gap: 10,
    marginBottom: 24, width: '100%',
  },
  statCard: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    backgroundColor: C.glassBg, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(245,245,247,0.08)',
  },
  statValue: { fontFamily: C.serif, fontSize: 24, color: C.white, lineHeight: 26 },
  statLabel: { fontSize: 10, color: 'rgba(245,245,247,0.45)', marginTop: 4 },

  winsCard: {
    backgroundColor: C.glassBg, borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 16,
    marginBottom: 24, width: '100%',
    borderWidth: 1, borderColor: C.glassBorder,
  },
  winsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  winsHeaderLabel: { fontSize: 12, color: C.gray1, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  winsCurrentValue: { fontFamily: C.serif, fontSize: 30, color: C.orange },
  winsHistoryList: {
    marginTop: 14, paddingTop: 12,
    borderTopWidth: 0.5, borderTopColor: C.border,
    gap: 8,
  },
  winsHistoryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  winsHistoryMonth: { fontSize: 13, color: C.gray1 },
  winsHistoryCount: { fontSize: 13, color: C.white, fontWeight: '600' },

  postsSectionHeader: {
    width: '100%', marginBottom: 12,
  },
  postsSectionTitle: { fontSize: 13, color: C.white, fontWeight: '700' },

  gridRow: { paddingHorizontal: 16, gap: GRID_GAP, marginBottom: GRID_GAP },
  gridCard: {
    width: CARD_WIDTH, height: CARD_HEIGHT,
    borderRadius: 14, overflow: 'hidden', backgroundColor: '#111',
  },
  gridNoPhoto: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  gridEmoji: { fontSize: 44 },
  gridScoreBadge: {
    position: 'absolute', top: 8, right: 8,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  gridScoreText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  gridTierPill: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderRadius: 7,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  gridTierText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  gridMealName: {
    position: 'absolute', bottom: 8, left: 8, right: 8,
    fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: '500',
  },
  gridStats: {
    position: 'absolute', bottom: 26, left: 8, flexDirection: 'row', gap: 8,
  },
  gridStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridStatText: { fontSize: 10, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },

  noPostsBox: { paddingHorizontal: 24, paddingTop: 20, alignItems: 'center' },
  noPostsText: { fontSize: 14, color: C.gray2, textAlign: 'center' },
});
