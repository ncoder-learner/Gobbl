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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_COLS  = 2;
const GRID_GAP   = 10;
const CARD_WIDTH  = (SCREEN_WIDTH - 32 - GRID_GAP) / GRID_COLS;
const CARD_HEIGHT = CARD_WIDTH * 1.4;

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc', purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a',
  purpleText: '#ddb8ff', white: '#ffffff', gray1: '#888888', gray2: '#666666',
  gray4: '#444444', green: '#00c896',
};

function scoreToneColor(score) {
  const n = typeof score === 'number' ? score : Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return '#FF6B3D';
  if (n < 9) return '#00c896';
  return '#ffd166';
}

function formatScore(score) {
  const n = typeof score === 'number' ? score : Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computeStreak(rows) {
  if (!rows?.length) return 0;
  const dateSet = new Set(rows.map(r => localDateKey(new Date(r.created_at))));
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

function MiniPostCard({ post, onPress }) {
  const meal = post.meals;
  if (!meal) return null;
  const color     = scoreToneColor(meal.score);
  const likeCount = (post.post_likes || []).length;
  const cmtCount  = (post.post_comments || []).length;

  return (
    <TouchableOpacity style={styles.gridCard} activeOpacity={0.85} onPress={onPress}>
      {meal.photo_url ? (
        <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.gridNoPhoto]}>
          <Text style={styles.gridEmoji}>{meal.emoji || '🍽️'}</Text>
        </View>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']}
        locations={[0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.gridScoreBadge, { backgroundColor: color }]}>
        <Text style={styles.gridScoreText}>{formatScore(meal.score)}</Text>
      </View>
      {post.tier_rank != null && post.tier_rank <= 10 && (
        <View style={[styles.gridTierPill, { borderColor: color + 'aa' }]}>
          <Text style={[styles.gridTierText, { color }]}>#{post.tier_rank}</Text>
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
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{totalMeals}</Text>
        <Text style={styles.statLabel}>meals</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{avgScore !== null ? avgScore.toFixed(1) : '—'}</Text>
        <Text style={styles.statLabel}>avg score</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{streak > 0 ? `${streak} 🔥` : '—'}</Text>
        <Text style={styles.statLabel}>streak</Text>
      </View>
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

      const [profileResult, postsResult, mealsResult] = await Promise.allSettled([
        supabase.from('profiles')
          .select('id, username, display_name, avatar_url, bio, banner_color')
          .eq('id', user.id)
          .single(),

        supabase.from('posts')
          .select('id, tier_rank, created_at, meals!meal_id(id, name, emoji, score, photo_url), post_likes(user_id), post_comments(id)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60),

        supabase.from('meals')
          .select('score, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),
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
        setStreak(computeStreak(meals));
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }

  const initials = (profile?.username?.[0] ?? profile?.display_name?.[0] ?? '?').toUpperCase();
  const bannerHex = bannerColorHex(profile?.banner_color);

  const listHeader = (
    <View style={styles.profileHeader}>
      <View style={[styles.banner, { backgroundColor: bannerHex }]}>
        <TouchableOpacity
          onPress={() => navigation.navigate('AccountSettings')}
          hitSlop={12}
          style={styles.gearBtn}
        >
          <Ionicons name="settings-outline" size={22} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
      </View>

      <View style={styles.bigAvatar}>
        {profile?.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.bigAvatarImage} />
        ) : (
          <Text style={styles.bigAvatarLetter}>{initials}</Text>
        )}
      </View>

      <View style={styles.profileBody}>
        {profile?.display_name ? (
          <Text style={styles.displayName}>{profile.display_name}</Text>
        ) : null}
        <Text style={styles.username}>@{profile?.username ?? '…'}</Text>
        {profile?.bio ? (
          <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text>
        ) : null}

        <StatsRow totalMeals={totalMeals} avgScore={avgScore} streak={streak} />

        <View style={styles.postsSectionHeader}>
          <Text style={styles.postsSectionTitle}>
            {posts.length} post{posts.length !== 1 ? 's' : ''}
          </Text>
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <FlatList
        data={posts}
        keyExtractor={item => item.id}
        numColumns={GRID_COLS}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => <MiniPostCard post={item} onPress={() => setSelectedPost(item)} />}
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
        postId={selectedPost?.id}
        postOwnerId={selectedPost?.user_id}
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
    alignItems: 'center', paddingBottom: 4,
  },
  banner: {
    width: '100%', height: 88, justifyContent: 'flex-start', alignItems: 'flex-end',
    paddingTop: 10, paddingHorizontal: 16,
  },
  gearBtn: { padding: 4 },
  bigAvatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.purpleDim, borderWidth: 3, borderColor: C.bg,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    marginTop: -40,
  },
  bigAvatarImage: { width: '100%', height: '100%' },
  bigAvatarLetter: { fontSize: 30, fontWeight: '800', color: C.purpleText },
  profileBody: { alignItems: 'center', width: '100%', paddingHorizontal: 24, paddingTop: 10 },
  displayName: { fontSize: 18, fontWeight: '700', color: C.white, marginBottom: 4 },
  username: { fontSize: 14, color: C.gray1, marginBottom: 12 },
  bio: { fontSize: 13, color: C.gray1, textAlign: 'center', lineHeight: 18, marginTop: -6, marginBottom: 16, paddingHorizontal: 8 },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 12,
    marginBottom: 24, width: '100%',
    borderWidth: 0.5, borderColor: C.border,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: C.white, marginBottom: 2 },
  statLabel: { fontSize: 11, color: C.gray2, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 0.5, height: 32, backgroundColor: C.border },

  postsSectionHeader: {
    width: '100%', paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: C.border,
    marginBottom: 4,
  },
  postsSectionTitle: { fontSize: 13, color: C.gray2, fontWeight: '600' },

  gridRow: { paddingHorizontal: 16, gap: GRID_GAP, marginBottom: GRID_GAP },
  gridCard: {
    width: CARD_WIDTH, height: CARD_HEIGHT,
    borderRadius: 14, overflow: 'hidden', backgroundColor: '#111',
  },
  gridNoPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
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
