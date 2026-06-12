import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Dimensions, ActivityIndicator, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH  = SCREEN_WIDTH - 32;
const CARD_HEIGHT = 340;
const PAGE_SIZE   = 15;

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc', purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a',
  purpleText: '#ddb8ff', white: '#ffffff', gray1: '#888888', gray2: '#666666',
  gray3: '#555555', gray4: '#444444', green: '#00c896',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computeStreak(rows) {
  if (!rows?.length) return { streak: 0, loggedToday: false };
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
  return { streak, loggedToday };
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

function PostCard({ post, onPressUser }) {
  const meal   = post.meals;
  const poster = post.profiles;
  if (!meal || !poster) return null;
  const color  = scoreToneColor(meal.score);

  return (
    <View style={styles.card}>
      {/* Photo background */}
      {meal.photo_url ? (
        <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cardNoPhoto]}>
          <Text style={styles.cardFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
        </View>
      )}

      {/* Gradient: transparent → very dark bottom */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Score badge — top right */}
      <View style={[styles.scoreBadge, { backgroundColor: color }]}>
        <Text style={styles.scoreBadgeNum}>{formatScore(meal.score)}</Text>
        <Text style={styles.scoreBadgeDen}>/10</Text>
      </View>

      {/* Tier ribbon — top left, only for top-10 meals */}
      {post.tier_rank != null && post.tier_rank <= 10 && (
        <View style={[styles.tierRibbon, { borderColor: color + 'aa' }]}>
          <Text style={[styles.tierText, { color }]}>
            #{post.tier_rank} · {new Date(post.created_at).getFullYear()}
          </Text>
        </View>
      )}

      {/* Bottom info overlay */}
      <View style={styles.cardBottom}>
        <TouchableOpacity
          style={styles.posterRow}
          onPress={() => onPressUser(poster.id)}
          activeOpacity={0.8}
          hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
        >
          <View style={styles.posterAvatar}>
            <Text style={styles.posterInitial}>
              {(poster.username?.[0] ?? poster.display_name?.[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <Text style={styles.posterUsername}>@{poster.username}</Text>
          <Text style={styles.postTime}>{timeAgo(post.created_at)}</Text>
        </TouchableOpacity>

        {post.caption ? (
          <Text style={styles.caption} numberOfLines={2}>{post.caption}</Text>
        ) : null}

        <Text style={styles.mealName} numberOfLines={1}>{meal.name}</Text>
      </View>
    </View>
  );
}

// ─── Personal strip ───────────────────────────────────────────────────────────

function PersonalStrip({ streak, loggedToday, onLogMeal }) {
  return (
    <View style={styles.strip}>
      <View style={styles.stripLeft}>
        {streak > 0 ? (
          <>
            <Text style={styles.stripFlame}>🔥</Text>
            <Text style={styles.stripStreakNum}>{streak}</Text>
            <Text style={styles.stripStreakLabel}>
              {loggedToday ? 'day streak' : 'days · log today!'}
            </Text>
          </>
        ) : (
          <Text style={styles.stripNoStreak}>Log a meal to start your streak</Text>
        )}
      </View>
      <TouchableOpacity style={styles.stripLogBtn} onPress={onLogMeal} activeOpacity={0.85}>
        <Ionicons name="camera" size={14} color={C.white} style={{ marginRight: 5 }} />
        <Text style={styles.stripLogBtnText}>Log meal</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function NoFriendsState({ onAddFriends }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>👥</Text>
      <Text style={styles.emptyTitle}>Add friends to see their posts</Text>
      <Text style={styles.emptySub}>
        Find people by their @username. When friends share a meal, it shows up here.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onAddFriends} activeOpacity={0.85}>
        <Text style={styles.emptyBtnText}>Add friends →</Text>
      </TouchableOpacity>
    </View>
  );
}

function HasFriendsEmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>🍽️</Text>
      <Text style={styles.emptyTitle}>No posts yet</Text>
      <Text style={styles.emptySub}>
        When friends share a meal, it shows up here. Share one of yours from History.
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const navigation = useNavigation();

  const [posts, setPosts]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(false);
  const [page, setPage]               = useState(0);
  const [streak, setStreak]           = useState(0);
  const [loggedToday, setLoggedToday] = useState(false);
  const [hasFriends, setHasFriends]   = useState(null); // null = unknown

  const loadData = useCallback(async (pageNum = 0, replace = true) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const from = pageNum * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      const [postsResult, streakResult, friendsResult] = await Promise.allSettled([
        supabase
          .from('posts')
          .select(`
            id, caption, tier_rank, created_at,
            meals(id, name, emoji, score, photo_url),
            profiles(id, username, display_name, avatar_url)
          `)
          .order('created_at', { ascending: false })
          .range(from, to),

        supabase
          .from('meals')
          .select('created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),

        supabase
          .from('friendships')
          .select('id', { count: 'exact', head: true })
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq('status', 'accepted'),
      ]);

      if (postsResult.status === 'fulfilled') {
        const data = postsResult.value.data || [];
        setPosts(prev => replace ? data : [...prev, ...data]);
        setHasMore(data.length === PAGE_SIZE);
        setPage(pageNum);
      }

      if (streakResult.status === 'fulfilled') {
        const { streak: s, loggedToday: lt } = computeStreak(streakResult.value.data);
        setStreak(s);
        setLoggedToday(lt);
      }

      if (friendsResult.status === 'fulfilled') {
        setHasFriends((friendsResult.value.count ?? 0) > 0);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData(0, true);
    }, [loadData])
  );

  function handleRefresh() {
    setRefreshing(true);
    loadData(0, true);
  }

  function handleEndReached() {
    if (!hasMore || loadingMore || loading || refreshing) return;
    setLoadingMore(true);
    loadData(page + 1, false);
  }

  function handlePressUser(userId) {
    navigation.navigate('UserProfile', { userId });
  }

  function handleAddFriends() {
    navigation.navigate('Friends');
  }

  const listHeader = (
    <>
      {/* Page header */}
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>FoodWrapped</Text>
        <TouchableOpacity
          onPress={handleAddFriends}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="people-outline" size={24} color={C.orange} />
        </TouchableOpacity>
      </View>

      {/* Personal strip: streak + log CTA */}
      <PersonalStrip
        streak={streak}
        loggedToday={loggedToday}
        onLogMeal={() => navigation.navigate('LogMeal')}
      />

      <View style={styles.feedDivider} />
    </>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        {listHeader}
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.orange} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <FlatList
        data={posts}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard post={item} onPressUser={handlePressUser} />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          hasFriends === false
            ? <NoFriendsState onAddFriends={handleAddFriends} />
            : <HasFriendsEmptyState />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 20 }}>
              <ActivityIndicator color={C.orange} size="small" />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.orange}
            colors={[C.orange]}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  listContent: { paddingBottom: 40 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Page header
  pageHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 10, paddingBottom: 8,
  },
  pageTitle: {
    fontWeight: '800', fontSize: 22, color: C.white, letterSpacing: -0.5,
  },

  // Personal strip
  strip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
  },
  stripLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stripFlame: { fontSize: 18, marginRight: 6 },
  stripStreakNum: {
    fontWeight: '800', fontSize: 18, color: C.orange, marginRight: 4,
  },
  stripStreakLabel: { fontSize: 13, color: C.gray1 },
  stripNoStreak: { fontSize: 13, color: C.gray2, flex: 1 },
  stripLogBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.orange, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  stripLogBtnText: { fontSize: 13, fontWeight: '600', color: C.white },

  feedDivider: {
    height: 0.5, backgroundColor: C.border, marginHorizontal: 16, marginBottom: 12,
  },

  // Post card
  card: {
    width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 20, overflow: 'hidden',
    marginBottom: 16, marginHorizontal: 16, backgroundColor: '#111',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 14, elevation: 10,
  },
  cardNoPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  cardFallbackEmoji: { fontSize: 80 },

  scoreBadge: {
    position: 'absolute', top: 12, right: 12,
    width: 58, height: 58, borderRadius: 29,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)',
  },
  scoreBadgeNum: {
    fontWeight: '800', fontSize: 18, color: '#fff', lineHeight: 20,
  },
  scoreBadgeDen: { fontSize: 10, color: 'rgba(255,255,255,0.65)', lineHeight: 12 },

  tierRibbon: {
    position: 'absolute', top: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  tierText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },

  cardBottom: { position: 'absolute', bottom: 14, left: 14, right: 14 },
  posterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 7, gap: 7 },
  posterAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.purpleDim, borderWidth: 1, borderColor: C.purpleBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  posterInitial: { fontSize: 12, fontWeight: '700', color: C.purpleText },
  posterUsername: { fontSize: 14, fontWeight: '700', color: '#fff', flex: 1 },
  postTime: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  caption: {
    fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 18, marginBottom: 4,
  },
  mealName: { fontSize: 11, color: 'rgba(255,255,255,0.42)', letterSpacing: 0.2 },

  // Empty states
  empty: {
    alignItems: 'center', paddingHorizontal: 36, paddingTop: 48, paddingBottom: 32,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontWeight: '700', fontSize: 18, color: C.white,
    textAlign: 'center', marginBottom: 10,
  },
  emptySub: {
    fontSize: 14, color: C.gray1, textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  emptyBtn: {
    backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 13,
  },
  emptyBtnText: { fontSize: 15, fontWeight: '600', color: C.white },
});
