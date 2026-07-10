import { useCallback, useState, useRef } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  StatusBar, Dimensions, ActivityIndicator, RefreshControl,
  Modal, Pressable, ScrollView, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import ShareBottomSheet from '../components/ShareBottomSheet';
import CommentSheet from '../components/CommentSheet';
import { syncStreakRiskNotification, loadNotifPrefs } from '../lib/notifications';
import { FirstVisitTooltip, useFirstVisit } from '../lib/firstVisit';

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


const TAG_LABEL = { breakfast: '🌅 Breakfast', lunch: '☀️ Lunch', dinner: '🌙 Dinner' };

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

function PostCard({ post, currentUserId, currentUsername, onPressUser }) {
  const meal   = post.meals;
  const poster = post.profiles;
  if (!meal || !poster) return null;
  const color  = scoreToneColor(meal.score);

  const likes = post.post_likes || [];
  const [likeCount, setLikeCount]   = useState(likes.length);
  const [isLiked, setIsLiked]       = useState(likes.some(l => l.user_id === currentUserId));
  const [liking, setLiking]         = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);

  async function toggleLike() {
    if (liking || !currentUserId) return;
    const next = !isLiked;
    setIsLiked(next);
    setLikeCount(c => next ? c + 1 : Math.max(0, c - 1));
    setLiking(true);
    try {
      if (next) {
        await supabase.from('post_likes').insert({ post_id: post.id, user_id: currentUserId });
        if (post.user_id && post.user_id !== currentUserId) {
          supabase.functions.invoke('send-notification', {
            body: {
              targetUserId: post.user_id,
              title: '❤️ New like',
              body: `@${currentUsername ?? 'Someone'} liked your meal!`,
            },
          }).catch(() => {});
        }
      } else {
        await supabase.from('post_likes').delete()
          .eq('post_id', post.id).eq('user_id', currentUserId);
      }
    } catch {
      setIsLiked(!next);
      setLikeCount(c => next ? Math.max(0, c - 1) : c + 1);
    } finally {
      setLiking(false);
    }
  }

  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
      {/* Photo background */}
      {meal.photo_url ? (
        <Image
          source={{ uri: meal.photo_url }}
          style={{ position: 'absolute', width: CARD_WIDTH, height: CARD_HEIGHT }}
          resizeMode="cover"
          resizeMethod="scale"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cardNoPhoto]}>
          <Text style={styles.cardFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
        </View>
      )}

      {/* Gradient: clear top, soft scrim only at the bottom third */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.72)']}
        locations={[0, 0.52, 1]}
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
          <TouchableOpacity
            onPress={toggleLike}
            activeOpacity={0.7}
            style={styles.likeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={isLiked ? 'heart' : 'heart-outline'}
              size={18}
              color={isLiked ? '#ff4d6a' : 'rgba(255,255,255,0.55)'}
            />
            {likeCount > 0 && (
              <Text style={[styles.likeCount, isLiked && { color: '#ff4d6a' }]}>
                {likeCount}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setCommentOpen(true)}
            activeOpacity={0.7}
            style={styles.likeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chatbubble-outline" size={16} color="rgba(255,255,255,0.55)" />
          </TouchableOpacity>
        </TouchableOpacity>

        <CommentSheet
          visible={commentOpen}
          postId={post.id}
          postOwnerId={post.user_id}
          onDismiss={() => setCommentOpen(false)}
        />

        {post.caption ? (
          <Text style={styles.caption} numberOfLines={2}>{post.caption}</Text>
        ) : null}

        <View style={styles.mealNameRow}>
          <Text style={styles.mealName} numberOfLines={1}>{meal.name}</Text>
          {meal.tag && TAG_LABEL[meal.tag] && (
            <View style={styles.tagPill}>
              <Text style={styles.tagPillText}>{TAG_LABEL[meal.tag]}</Text>
            </View>
          )}
        </View>
      </View>
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

function NoFriendsState({ onAddFriends, onInvite }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>👥</Text>
      <Text style={styles.emptyTitle}>Your feed fills up as you add friends</Text>
      <Text style={styles.emptySub}>
        Find people by their @username, or invite friends to join FoodWrapped.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onAddFriends} activeOpacity={0.85}>
        <Ionicons name="person-add-outline" size={15} color={C.white} style={{ marginRight: 6 }} />
        <Text style={styles.emptyBtnText}>Add friends</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.emptyBtnSecondary} onPress={onInvite} activeOpacity={0.85}>
        <Ionicons name="share-outline" size={15} color={C.orange} style={{ marginRight: 6 }} />
        <Text style={styles.emptyBtnSecondaryText}>Invite friends</Text>
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
  const [hasFriends, setHasFriends]       = useState(null);
  const [friendCount, setFriendCount]     = useState(0);
  const [currentUserId, setCurrentUserId]       = useState(null);
  const [currentUsername, setCurrentUsername]   = useState(null);
  const [pendingRequests, setPendingRequests]   = useState(0);

  const [feedTooltipVisible, dismissFeedTooltip] = useFirstVisit('@fw_tt_feed');

  // Compose / meal picker
  const [pickerVisible, setPickerVisible]   = useState(false);
  const [pickerMeals, setPickerMeals]       = useState([]);
  const [pickerLoading, setPickerLoading]   = useState(false);
  const [shareTarget, setShareTarget]       = useState(null); // meal to share

  const loadData = useCallback(async (pageNum = 0, replace = true) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Fetch current user's username once for notifications and invite share
      if (!currentUsername) {
        supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
          .then(({ data }) => { if (data?.username) setCurrentUsername(data.username); })
          .catch(() => {});
      }

      // Resolve friend count first so the posts query can decide whether to include own posts
      const friendsResult = await supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted');

      const fCount = friendsResult.count ?? 0;
      setFriendCount(fCount);
      setHasFriends(fCount > 0);

      const from = pageNum * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      // Build posts query: include own posts when user has fewer than 3 friends
      let postsQuery = supabase
        .from('posts')
        .select(`
          id, user_id, caption, tier_rank, created_at,
          meals(id, name, emoji, score, photo_url, tag),
          profiles!posts_user_id_fkey(id, username, display_name, avatar_url),
          post_likes(user_id)
        `)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (fCount >= 3) {
        postsQuery = postsQuery.neq('user_id', user.id);
      }

      const [postsResult, streakResult, pendingResult] = await Promise.allSettled([
        postsQuery,

        supabase
          .from('meals')
          .select('created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),

        supabase
          .from('friendships')
          .select('id', { count: 'exact', head: true })
          .eq('addressee_id', user.id)
          .eq('status', 'pending'),
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
        loadNotifPrefs().then(prefs => {
          if (prefs.enabled) syncStreakRiskNotification(s, lt).catch(() => {});
        }).catch(() => {});
      }

      if (pendingResult.status === 'fulfilled') {
        setPendingRequests(pendingResult.value.count ?? 0);
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

  async function handleInvite() {
    const msg = currentUsername
      ? `Add me on FoodWrapped — my username is @${currentUsername}`
      : 'Join me on FoodWrapped!';
    try {
      await Share.share({ message: msg });
    } catch {
      // user cancelled or share sheet unavailable
    }
  }

  async function handleCompose() {
    setPickerVisible(true);
    setPickerLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('meals')
        .select('id, name, emoji, score, photo_url, posts(id)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      setPickerMeals((data || []).filter(m => !m.posts?.length));
    } catch {
      setPickerMeals([]);
    } finally {
      setPickerLoading(false);
    }
  }

  const listHeader = (
    <>
      {/* Page header */}
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>FoodWrapped</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleCompose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="add-circle-outline" size={26} color={C.orange} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleAddFriends}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <View>
              <Ionicons name="people-outline" size={24} color={C.orange} />
              {pendingRequests > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {pendingRequests > 9 ? '9+' : pendingRequests}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
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
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        {listHeader}
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.orange} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* ── Meal picker modal ─────────────────────────────────────────────── */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setPickerVisible(false)} hitSlop={8}>
                <Text style={styles.pickerCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>Post a meal</Text>
              <View style={{ width: 52 }} />
            </View>

            {pickerLoading ? (
              <View style={styles.pickerLoading}>
                <ActivityIndicator color={C.orange} />
              </View>
            ) : pickerMeals.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Text style={styles.pickerEmptyEmoji}>🍽️</Text>
                <Text style={styles.pickerEmptyTitle}>Nothing to post yet</Text>
                <Text style={styles.pickerEmptySub}>
                  All your logged meals are already posted, or you haven't logged any yet.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                {pickerMeals.map(meal => (
                  <TouchableOpacity
                    key={meal.id}
                    style={styles.pickerRow}
                    activeOpacity={0.72}
                    onPress={() => {
                      setPickerVisible(false);
                      setShareTarget(meal);
                    }}
                  >
                    {meal.photo_url ? (
                      <Image source={{ uri: meal.photo_url }} style={styles.pickerThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.pickerThumb, styles.pickerThumbFallback]}>
                        <Text style={{ fontSize: 22 }}>{meal.emoji || '🍽️'}</Text>
                      </View>
                    )}
                    <View style={styles.pickerRowInfo}>
                      <Text style={styles.pickerRowName} numberOfLines={1}>{meal.name}</Text>
                    </View>
                    <Text style={[styles.pickerRowScore, { color: scoreToneColor(meal.score) }]}>
                      {formatScore(meal.score)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 32 }} />
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Share bottom sheet (from compose button) ──────────────────────── */}
      <ShareBottomSheet
        visible={shareTarget !== null}
        meal={shareTarget}
        onDismiss={() => setShareTarget(null)}
        onPosted={() => setShareTarget(null)}
      />

      <FlatList
        data={posts}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard post={item} currentUserId={currentUserId} currentUsername={currentUsername} onPressUser={handlePressUser} />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          hasFriends === false
            ? <NoFriendsState onAddFriends={handleAddFriends} onInvite={handleInvite} />
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
      {feedTooltipVisible && (
        <FirstVisitTooltip
          message="Add friends to see what they're eating."
          onDismiss={dismissFeedTooltip}
          style={{ bottom: 90, alignSelf: 'center' }}
        />
      )}
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
  headerActions: {
    flexDirection: 'row', alignItems: 'center', gap: 18,
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

  // Post card — elevation and overflow:hidden must live on SEPARATE views.
  // On Android, elevation blocks overflow clipping, so the image bleeds through the rounded corners.
  cardWrap: {
    marginBottom: 16, marginHorizontal: 16, borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 14, elevation: 10,
  },
  card: {
    width: CARD_WIDTH, height: CARD_HEIGHT,
    borderRadius: 20, overflow: 'hidden',
    backgroundColor: '#111',
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
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 6 },
  likeCount: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },

  // Friend request badge
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#ff4d6a', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  caption: {
    fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 18, marginBottom: 4,
  },
  mealNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealName: { fontSize: 11, color: 'rgba(255,255,255,0.42)', letterSpacing: 0.2, flexShrink: 1 },
  tagPill: {
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  tagPillText: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.72)' },

  // Meal picker modal
  pickerOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    overflow: 'hidden', maxHeight: '80%',
  },
  pickerHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: 'center', marginTop: 12,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: C.white },
  pickerCancel: { fontSize: 15, color: C.gray1, fontWeight: '500' },
  pickerLoading: { paddingVertical: 48, alignItems: 'center' },
  pickerEmpty: {
    alignItems: 'center', paddingHorizontal: 36, paddingTop: 32, paddingBottom: 48,
  },
  pickerEmptyEmoji: { fontSize: 40, marginBottom: 12 },
  pickerEmptyTitle: {
    fontSize: 17, fontWeight: '700', color: C.white, marginBottom: 8, textAlign: 'center',
  },
  pickerEmptySub: { fontSize: 14, color: C.gray1, textAlign: 'center', lineHeight: 20 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  pickerThumb: {
    width: 50, height: 50, borderRadius: 10, backgroundColor: C.surface,
  },
  pickerThumbFallback: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: C.border,
  },
  pickerRowInfo: { flex: 1 },
  pickerRowName: { fontSize: 15, fontWeight: '600', color: C.white },
  pickerRowScore: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },

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
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 13,
    marginBottom: 12,
  },
  emptyBtnText: { fontSize: 15, fontWeight: '600', color: C.white },
  emptyBtnSecondary: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.orange, borderRadius: 14,
    paddingHorizontal: 22, paddingVertical: 12,
  },
  emptyBtnSecondaryText: { fontSize: 15, fontWeight: '600', color: C.orange },
});
