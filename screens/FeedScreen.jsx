import { useCallback, useState, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  StatusBar, Dimensions, ActivityIndicator, RefreshControl,
  Modal, Pressable, ScrollView, Share, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import ShareBottomSheet from '../components/ShareBottomSheet';
import CommentSheet from '../components/CommentSheet';
import DayTrail from '../components/DayTrail';
import { syncStreakRiskNotification, loadNotifPrefs } from '../lib/notifications';
import { FirstVisitTooltip, useFirstVisit } from '../lib/firstVisit';
import { fetchPostedMealIds, MEAL_TAGS, TAG_META } from '../lib/postUtils';
import { castVote, tallyVotes, VOTE_COLORS, voteSummary, voteCaption } from '../lib/postVotes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH   = SCREEN_WIDTH - 32;
const MEDIA_HEIGHT = 470; // tall, Shorts-style media box
const PAGE_SIZE    = 15;

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

// 'Today' / 'Yesterday' / a full weekday date for anything older — the
// section header label shown above each day's group of posts.
function dayHeaderLabel(dateKey) {
  const todayKey = localDateKey(new Date());
  const yesterdayKey = localDateKey(new Date(Date.now() - 86400000));
  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function DayHeader({ label }) {
  return (
    <View style={styles.dayHeaderRow}>
      <Text style={styles.dayHeaderText}>{label}</Text>
      <View style={styles.dayHeaderLine} />
    </View>
  );
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

// One image within the media box. isPrimary marks the meal that post.meal_id
// (and therefore post.tier_rank, a single legacy snapshot) points at — that's
// the only meal we have a stored rank for, so only its image gets a tier
// ribbon, inline rather than as a card-wide overlay.
//
// Tier Duel takes over the tap target when voting is live (canVote): tapping
// the photo casts/changes/undoes your vote instead of opening the meal
// detail screen, with a quick scale-down pulse and a persistent highlight
// ring on your current pick. When you can't vote (you're the owner, or the
// post only has 1 slot), tapping behaves as before — opens the meal detail.
function MediaSlot({ tag, meal, isPrimary, tierRank, onPress, showVotes, canVote, voteCount, isMyVote, onVote }) {
  const color = scoreToneColor(meal.score);
  const meta = TAG_META[tag];
  const scale = useRef(new Animated.Value(1)).current;

  function handlePress() {
    if (canVote) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.94, duration: 90, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 8 }),
      ]).start();
      onVote(tag);
    } else {
      onPress();
    }
  }

  return (
    <Animated.View style={[styles.mediaSlot, isMyVote && styles.mediaSlotVoted, { transform: [{ scale }] }]}>
      <TouchableOpacity style={styles.mediaSlotTouchable} onPress={handlePress} activeOpacity={0.9}>
        {meal.photo_url ? (
          <Image
            source={{ uri: meal.photo_url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            resizeMethod="scale"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.cardNoPhoto]}>
            <Text style={styles.cardFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
          </View>
        )}

        <LinearGradient
          colors={['rgba(0,0,0,0.32)', 'transparent', 'rgba(0,0,0,0.4)']}
          locations={[0, 0.3, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.slotTagBadge}>
          <Text style={styles.slotTagEmoji}>{meta.emoji}</Text>
        </View>

        <View style={[styles.slotScoreBadge, { backgroundColor: color }]}>
          <Text style={styles.slotScoreText}>{formatScore(meal.score)}</Text>
        </View>

        {isPrimary && tierRank != null && tierRank <= 10 && (
          <View style={[styles.slotTierRibbon, { borderColor: color + 'aa' }]}>
            <Text style={[styles.slotTierText, { color }]}>#{tierRank}</Text>
          </View>
        )}

        {showVotes && (
          <View style={[styles.slotVoteBadge, isMyVote && styles.slotVoteBadgeActive]}>
            <Ionicons name="flame" size={12} color={isMyVote ? '#fff' : '#ffb84d'} />
            <Text style={styles.slotVoteCount}>{voteCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// Segmented bar showing each slot's share of the post's votes, plus a
// summary caption — rendered directly under the media row.
function VoteBar({ images, counts, canVote }) {
  if (images.length < 2) return null;
  const summary = voteSummary(images, counts);
  const caption = voteCaption(summary, { canVote });

  return (
    <View style={styles.voteBarWrap}>
      <View style={styles.voteBarTrack}>
        {summary.total === 0 ? (
          <View style={[styles.voteBarSeg, { flex: 1, backgroundColor: '#2a2a2a' }]} />
        ) : (
          images.map(({ tag }) => {
            const c = counts[tag] || 0;
            if (c === 0) return null;
            return <View key={tag} style={[styles.voteBarSeg, { flex: c, backgroundColor: VOTE_COLORS[tag] }]} />;
          })
        )}
      </View>
      <Text style={styles.voteBarCaption}>{caption}</Text>
    </View>
  );
}

function PostCard({ post, currentUserId, currentUsername, onPressUser, onPressMeal }) {
  const poster = post.profiles;
  // Always breakfast → lunch → dinner order, left to right, regardless of
  // which slots are actually filled (1-3 of them).
  const images = MEAL_TAGS
    .map(tag => (post[tag] ? { tag, meal: post[tag] } : null))
    .filter(Boolean);
  if (images.length === 0 || !poster) return null;

  const likes = post.post_likes || [];
  const [likeCount, setLikeCount]   = useState(likes.length);
  const [isLiked, setIsLiked]       = useState(likes.some(l => l.user_id === currentUserId));
  const [liking, setLiking]         = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);

  // Tier Duel — friends tap a slot on a 2-3 image post to pick which meal
  // they'd want; owner can see the tally but can't vote on their own post.
  const isOwner = post.user_id === currentUserId;
  const showVotes = images.length >= 2;
  const canVote = showVotes && !isOwner;
  const initialTally = tallyVotes(post.post_votes, currentUserId);
  const [voteCounts, setVoteCounts] = useState(initialTally.counts);
  const [myVote, setMyVote]         = useState(initialTally.myVote);
  const [voting, setVoting]         = useState(false);

  async function handleVote(tag) {
    if (!canVote || voting || !currentUserId) return;
    const prevMyVote = myVote;
    const prevCounts = voteCounts;
    const nextMyVote = myVote === tag ? null : tag;

    const nextCounts = { ...voteCounts };
    if (prevMyVote) nextCounts[prevMyVote] = Math.max(0, nextCounts[prevMyVote] - 1);
    if (nextMyVote) nextCounts[nextMyVote] = (nextCounts[nextMyVote] || 0) + 1;
    setVoteCounts(nextCounts);
    setMyVote(nextMyVote);
    setVoting(true);
    try {
      await castVote(post.id, tag, prevMyVote);
    } catch {
      setVoteCounts(prevCounts);
      setMyVote(prevMyVote);
    } finally {
      setVoting(false);
    }
  }

  async function toggleLike() {
    if (liking || !currentUserId) return;
    const next = !isLiked;
    setIsLiked(next);
    setLikeCount(c => next ? c + 1 : Math.max(0, c - 1));
    setLiking(true);
    try {
      // This is a post-level "like the whole card" action (FeedScreen shows
      // all 1-3 slots at once, not one meal), so it's tied to the post's
      // primary/legacy meal_id — every post has one. Scoped by meal_id (not
      // just post_id) since migration 018: post_id alone is no longer
      // unique per user now that per-slot likes (SlotViewerScreen,
      // MealDetailScreen) can coexist on the same post.
      if (next) {
        await supabase.from('post_likes').insert({ post_id: post.id, meal_id: post.meal_id, user_id: currentUserId });
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
          .eq('meal_id', post.meal_id).eq('user_id', currentUserId);
      }
    } catch {
      setIsLiked(!next);
      setLikeCount(c => next ? Math.max(0, c - 1) : c + 1);
    } finally {
      setLiking(false);
    }
  }

  const mealNames = images.map(i => i.meal.name).join('  ·  ');

  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
        {/* Media box — 1-3 images side by side, Shorts-style, each with its
            own tag emoji + score badge (and tier badge for the primary meal) */}
        <View style={styles.mediaRow}>
          {images.map(({ tag, meal }) => (
            <MediaSlot
              key={tag}
              tag={tag}
              meal={meal}
              isPrimary={meal.id === post.meal_id}
              tierRank={post.tier_rank}
              onPress={() => onPressMeal(meal.id, post.id)}
              showVotes={showVotes}
              canVote={canVote}
              voteCount={voteCounts[tag] || 0}
              isMyVote={myVote === tag}
              onVote={handleVote}
            />
          ))}
        </View>

        <VoteBar images={images} counts={voteCounts} canVote={canVote} />

        {/* Info block — normal (non-overlaid) block below the media box */}
        <View style={styles.infoBlock}>
          <TouchableOpacity
            style={styles.posterRow}
            onPress={() => onPressUser(poster.id)}
            activeOpacity={0.8}
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
          >
            <View style={styles.posterAvatar}>
              {poster.avatar_url ? (
                <Image source={{ uri: poster.avatar_url }} style={styles.posterAvatarImage} />
              ) : (
                <Text style={styles.posterInitial}>
                  {(poster.username?.[0] ?? poster.display_name?.[0] ?? '?').toUpperCase()}
                </Text>
              )}
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
                color={isLiked ? '#ff4d6a' : C.gray2}
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
              <Ionicons name="chatbubble-outline" size={16} color={C.gray2} />
            </TouchableOpacity>
          </TouchableOpacity>

          <CommentSheet
            visible={commentOpen}
            postId={post.id}
            mealId={post.meal_id}
            postOwnerId={post.user_id}
            onDismiss={() => setCommentOpen(false)}
          />

          {post.caption ? (
            <Text style={styles.caption} numberOfLines={2}>{post.caption}</Text>
          ) : null}

          <DayTrail images={images} isOwner={post.user_id === currentUserId} />

          <Text style={styles.mealName} numberOfLines={1}>{mealNames}</Text>
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
          id, user_id, caption, tier_rank, created_at, last_updated_at, meal_id,
          breakfast:meals!breakfast_meal_id(id, name, emoji, score, photo_url, tag, place_id, places(lat, lng, name)),
          lunch:meals!lunch_meal_id(id, name, emoji, score, photo_url, tag, place_id, places(lat, lng, name)),
          dinner:meals!dinner_meal_id(id, name, emoji, score, photo_url, tag, place_id, places(lat, lng, name)),
          profiles!posts_user_id_fkey(id, username, display_name, avatar_url),
          post_likes(user_id),
          post_votes(voter_id, slot)
        `)
        .order('last_updated_at', { ascending: false })
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

  // Flattened [{type:'header', id, label} | {type:'post', id, post}] list —
  // a day-section header is inserted whenever the post's local calendar day
  // changes, so pagination (which only ever appends to `posts`) keeps
  // working unmodified while this just re-derives the grouped view.
  const feedItems = useMemo(() => {
    const items = [];
    let lastKey = null;
    for (const post of posts) {
      const key = localDateKey(new Date(post.created_at));
      if (key !== lastKey) {
        items.push({ type: 'header', id: `header-${key}`, label: dayHeaderLabel(key) });
        lastKey = key;
      }
      items.push({ type: 'post', id: post.id, post });
    }
    return items;
  }, [posts]);

  function handlePressUser(userId) {
    navigation.navigate('UserProfile', { userId });
  }

  function handlePressMeal(mealId, postId) {
    navigation.navigate('MealDetail', { mealId, postId });
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
      // A meal can now be attached to a post via any of the 3 tri-image slot
      // columns, not just meal_id, so "already posted" needs to check all 4.
      const [{ data }, postedIds] = await Promise.all([
        supabase
          .from('meals')
          .select('id, name, emoji, score, photo_url, tag, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30),
        fetchPostedMealIds(user.id).catch(() => new Set()),
      ]);
      setPickerMeals((data || []).filter(m => !postedIds.has(m.id)));
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
            onPress={() => navigation.navigate('Map')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="map-outline" size={24} color={C.orange} />
          </TouchableOpacity>
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
        data={feedItems}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          item.type === 'header' ? (
            <DayHeader label={item.label} />
          ) : (
            <PostCard
              post={item.post}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
              onPressUser={handlePressUser}
              onPressMeal={handlePressMeal}
            />
          )
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

  // Day-section header — separates posts into 'Today' / 'Yesterday' / date
  // groups. First one sits right under the personal strip's divider; the
  // rest space themselves out from the previous day's last card.
  dayHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 6, marginBottom: 14,
  },
  dayHeaderText: {
    fontSize: 13, fontWeight: '800', color: C.white, letterSpacing: 0.3,
  },
  dayHeaderLine: { flex: 1, height: 0.5, backgroundColor: C.border },

  // Post card — Shorts-style: a media box on top, a normal (non-overlaid)
  // info block below. Elevation and overflow:hidden must live on SEPARATE
  // views — on Android, elevation blocks overflow clipping, so the image
  // bleeds through the rounded corners otherwise.
  cardWrap: {
    marginBottom: 30, marginHorizontal: 16, borderRadius: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 18, elevation: 8,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 22, overflow: 'hidden',
    backgroundColor: C.surface,
  },

  // Media box — 1-3 image slots side by side
  mediaRow: {
    flexDirection: 'row', height: MEDIA_HEIGHT, gap: 3, backgroundColor: '#000',
  },
  mediaSlot: { flex: 1, backgroundColor: '#111', overflow: 'hidden' },
  mediaSlotVoted: { borderWidth: 3, borderColor: C.orange, borderRadius: 8 },
  mediaSlotTouchable: { flex: 1 },
  cardNoPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#151515' },
  cardFallbackEmoji: { fontSize: 36 },

  slotTagBadge: {
    position: 'absolute', top: 12, left: 12,
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 3,
  },
  slotTagEmoji: { fontSize: 15 },

  slotScoreBadge: {
    position: 'absolute', top: 12, right: 12,
    borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 3,
  },
  slotScoreText: { fontWeight: '800', fontSize: 13, color: '#fff', letterSpacing: 0.2 },

  slotTierRibbon: {
    position: 'absolute', bottom: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1, borderRadius: 9,
    paddingHorizontal: 7, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 3,
  },
  slotTierText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  // Tier Duel vote badge — bottom-right, opposite the tier ribbon
  slotVoteBadge: {
    position: 'absolute', bottom: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 9,
    paddingHorizontal: 7, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 3,
  },
  slotVoteBadgeActive: { backgroundColor: C.orange, borderColor: 'rgba(255,255,255,0.35)' },
  slotVoteCount: { fontSize: 11, fontWeight: '800', color: '#fff' },

  // Tier Duel vote-share bar — directly under the media row
  voteBarWrap: { paddingHorizontal: 14, paddingTop: 10 },
  voteBarTrack: {
    flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  voteBarSeg: { height: '100%' },
  voteBarCaption: { fontSize: 12, color: C.gray2, fontWeight: '500', marginTop: 6 },

  // Info block — normal flow, below the media box. Typography hierarchy:
  // username (bold, white, largest) > caption (regular, near-white) >
  // meal names (small, semibold, muted — metadata, not prose).
  infoBlock: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18 },
  posterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 9 },
  posterAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.purpleDim, borderWidth: 1, borderColor: C.purpleBorder,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  posterAvatarImage: { width: '100%', height: '100%' },
  posterInitial: { fontSize: 12, fontWeight: '700', color: C.purpleText },
  posterUsername: { fontSize: 15, fontWeight: '700', color: C.white, letterSpacing: 0.1, flex: 1 },
  postTime: { fontSize: 12, color: C.gray2 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 10 },
  likeCount: { fontSize: 12, color: C.gray2, fontWeight: '600' },

  // Friend request badge
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#ff4d6a', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  caption: {
    fontSize: 14, fontWeight: '400', color: 'rgba(255,255,255,0.92)',
    lineHeight: 19, marginTop: 8,
  },
  mealName: {
    fontSize: 12, fontWeight: '600', color: C.gray1,
    letterSpacing: 0.15, marginTop: 10,
  },

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
