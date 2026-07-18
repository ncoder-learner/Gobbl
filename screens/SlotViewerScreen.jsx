import { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity, TextInput, StyleSheet,
  StatusBar, Dimensions, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import CommentSheet from '../components/CommentSheet';
import { TAG_META, TAG_ICON } from '../lib/postUtils';
import { displayPlaceName } from '../lib/homePrivacy';
import Avatar from '../components/Avatar';
import { useFirstVisit, FirstVisitTooltip } from '../lib/firstVisit';
import { TourTarget } from '../lib/tourContext';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from '../components/StripedPlaceholder';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function scoreToneColor(score) {
  const n = Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return C.orange;
  if (n < 9) return C.green;
  return C.gold;
}
function formatScore(score) {
  const n = Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

// ─── One person's page — a vertical photo pager with fixed overlay chrome ──
function PersonPage({ person, data, likeInfo, commentCount, onLike, onSubmitComment, onOpenComments, onPhotoIndexChange, showLikeTooltip, onDismissLikeTooltip, isActive }) {
  const { meal, poster } = person;
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const photos = data?.photos ?? (meal.photo_url ? [{ id: 'primary', url: meal.photo_url }] : [{ id: 'fallback', url: null }]);
  const score = data?.score ?? meal.score;
  const placeName = data?.placeName ?? null;
  const color = scoreToneColor(score);

  async function handleSend() {
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmitComment(commentText.trim());
      setCommentText('');
    } catch (err) {
      Alert.alert('Comment failed', err.message || 'Could not post your comment. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
      <FlatList
        data={photos}
        keyExtractor={(p, i) => String(p.id ?? i)}
        renderItem={({ item }) => (
          item.url ? (
            <Image source={{ uri: item.url }} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }} resizeMode="cover" />
          ) : (
            <StripedPlaceholder style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
              <View style={styles.photoFallback}>
                <Text style={styles.photoFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
              </View>
            </StripedPlaceholder>
          )
        )}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => onPhotoIndexChange(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
      />

      <KeyboardAvoidingView
        style={styles.bottomOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.posterRow}>
          <Avatar
            uri={poster?.avatar_url}
            firstName={poster?.first_name}
            lastName={poster?.last_name}
            displayName={poster?.display_name}
            username={poster?.username}
            size={30}
            style={styles.posterAvatar}
            textStyle={styles.posterInitial}
          />
          <Text style={styles.posterUsername}>@{poster?.username ?? 'unknown'}</Text>
          {score != null && (
            <View style={[styles.scoreBadge, { backgroundColor: color }]}>
              <Text style={styles.scoreBadgeText}>{formatScore(score)}</Text>
            </View>
          )}
        </View>
        <Text style={styles.mealName} numberOfLines={1}>{meal.name}</Text>
        {placeName ? <Text style={styles.placeName} numberOfLines={1}>📍 {placeName}</Text> : null}

        <View style={styles.engageRow}>
          {isActive ? (
            <TourTarget id="slotviewer.like" action={onLike}>
              <TouchableOpacity onPress={onLike} style={styles.engageBtn} hitSlop={8} activeOpacity={0.7}>
                <Ionicons name={likeInfo?.isLiked ? 'heart' : 'heart-outline'} size={22} color={likeInfo?.isLiked ? '#ff4d6a' : C.white} />
                <Text style={styles.engageCount}>{likeInfo?.count ?? 0}</Text>
                {showLikeTooltip && (
                  <FirstVisitTooltip
                    message="Tap to like this meal"
                    onDismiss={onDismissLikeTooltip}
                    style={styles.likeTooltip}
                  />
                )}
              </TouchableOpacity>
            </TourTarget>
          ) : (
            <TouchableOpacity onPress={onLike} style={styles.engageBtn} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name={likeInfo?.isLiked ? 'heart' : 'heart-outline'} size={22} color={likeInfo?.isLiked ? '#ff4d6a' : C.white} />
              <Text style={styles.engageCount}>{likeInfo?.count ?? 0}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onOpenComments} style={styles.engageBtn} hitSlop={8} activeOpacity={0.7}>
            <Ionicons name="chatbubble-outline" size={20} color={C.white} />
            <Text style={styles.engageCount}>{commentCount}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.commentInputRow}>
          <TextInput
            style={styles.commentInput}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Add a comment…"
            placeholderTextColor={C.gray2}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity onPress={handleSend} disabled={!commentText.trim() || submitting} hitSlop={8}>
            {submitting ? (
              <ActivityIndicator size="small" color={C.orange} />
            ) : (
              <Ionicons name="send" size={20} color={commentText.trim() ? C.orange : C.gray2} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────
export default function SlotViewerScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { tag, people = [], initialIndex = 0 } = route.params || {};
  const meta = TAG_META[tag] || { emoji: '📍', label: tag };

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [photoIndexByMeal, setPhotoIndexByMeal] = useState({}); // mealId -> active photo index, for the top segment bar
  const [mealData, setMealData] = useState({});     // mealId -> {score, placeName, photos}
  const [likeState, setLikeState] = useState({});   // postId -> {count, isLiked}
  const [commentCounts, setCommentCounts] = useState({}); // postId -> count
  const [commentSheetTarget, setCommentSheetTarget] = useState(null); // {postId, mealId} | null
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  const outerListRef = useRef(null);

  const [swipeTooltipVisible, dismissSwipeTooltip] = useFirstVisit('@fw_tt_slotswipe');
  const [likeTooltipVisible, dismissLikeTooltip] = useFirstVisit('@fw_tt_like');

  useEffect(() => {
    if (people.length === 0) { setLoading(false); return; }
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserId(user?.id ?? null);

        const mealIds = people.map(p => p.mealId);

        const [{ data: meals }, { data: photoRows }, { data: likeRows }, { data: commentRows }] = await Promise.all([
          supabase.from('meals').select('id, score, place_id, places(name)').in('id', mealIds),
          supabase.from('meal_photos').select('id, meal_id, photo_url').in('meal_id', mealIds).order('position', { ascending: true }),
          supabase.from('post_likes').select('meal_id, user_id').in('meal_id', mealIds),
          supabase.from('post_comments').select('id, meal_id').in('meal_id', mealIds),
        ]);

        const nextMealData = {};
        for (const p of people) {
          const m = meals?.find(x => x.id === p.mealId);
          const extraPhotos = (photoRows || [])
            .filter(ph => ph.meal_id === p.mealId)
            .map(ph => ({ id: ph.id, url: ph.photo_url }));
          const photos = [
            ...(p.meal.photo_url ? [{ id: 'primary', url: p.meal.photo_url }] : []),
            ...extraPhotos,
          ];
          nextMealData[p.mealId] = {
            score: m?.score ?? null,
            placeName: m ? displayPlaceName(m) : null,
            photos: photos.length ? photos : [{ id: 'fallback', url: null }],
          };
        }
        setMealData(nextMealData);

        const nextLikes = {};
        for (const p of people) {
          const rows = (likeRows || []).filter(r => r.meal_id === p.mealId);
          nextLikes[p.mealId] = { count: rows.length, isLiked: user ? rows.some(r => r.user_id === user.id) : false };
        }
        setLikeState(nextLikes);

        const nextComments = {};
        for (const p of people) {
          nextComments[p.mealId] = (commentRows || []).filter(r => r.meal_id === p.mealId).length;
        }
        setCommentCounts(nextComments);
      } catch (err) {
        console.warn('[SlotViewer] failed to load meal/engagement data:', err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleLike(mealId, postId) {
    if (!currentUserId) return;
    const cur = likeState[mealId] || { count: 0, isLiked: false };
    const next = !cur.isLiked;
    setLikeState(s => ({ ...s, [mealId]: { count: next ? cur.count + 1 : Math.max(0, cur.count - 1), isLiked: next } }));
    try {
      if (next) {
        const { error } = await supabase.from('post_likes').insert({ post_id: postId, meal_id: mealId, user_id: currentUserId });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_likes').delete().eq('meal_id', mealId).eq('user_id', currentUserId);
        if (error) throw error;
      }
    } catch {
      setLikeState(s => ({ ...s, [mealId]: cur }));
    }
  }

  async function submitComment(mealId, postId, text) {
    if (!currentUserId) throw new Error('Not signed in');
    const { error } = await supabase.from('post_comments').insert({ post_id: postId, meal_id: mealId, user_id: currentUserId, content: text });
    if (error) throw error;
    setCommentCounts(c => ({ ...c, [mealId]: (c[mealId] || 0) + 1 }));
  }

  function onOuterMomentumEnd(e) {
    const idx = Math.round(e.nativeEvent.contentOffset.y / SCREEN_HEIGHT);
    setActiveIndex(idx);
  }

  const activePerson = people[activeIndex];
  const activePhotoCount = activePerson ? (mealData[activePerson.mealId]?.photos?.length ?? 1) : 0;
  const activePhotoIndex = activePerson ? (photoIndexByMeal[activePerson.mealId] ?? 0) : 0;

  if (people.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <TouchableOpacity style={styles.emptyBackBtn} onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={C.white} />
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Nothing to show.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <FlatList
        ref={outerListRef}
        data={people}
        keyExtractor={p => p.mealId}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * i, index: i })}
        onMomentumScrollEnd={onOuterMomentumEnd}
        renderItem={({ item, index }) => (
          <PersonPage
            person={item}
            data={mealData[item.mealId]}
            likeInfo={likeState[item.mealId]}
            commentCount={commentCounts[item.mealId] ?? 0}
            onLike={() => toggleLike(item.mealId, item.postId)}
            onSubmitComment={text => submitComment(item.mealId, item.postId, text)}
            onOpenComments={() => setCommentSheetTarget({ postId: item.postId, mealId: item.mealId, posterId: item.poster?.id })}
            onPhotoIndexChange={idx => setPhotoIndexByMeal(m => ({ ...m, [item.mealId]: idx }))}
            showLikeTooltip={likeTooltipVisible && index === activeIndex}
            onDismissLikeTooltip={dismissLikeTooltip}
            isActive={index === activeIndex}
          />
        )}
      />

      {/* Explains the swipe gesture on first-ever visit — vertical between
          people, horizontal through one person's photos. Centered so it
          reads as a general hint, not anchored to any one control. */}
      {swipeTooltipVisible && !loading && (
        <FirstVisitTooltip
          message="Swipe up/down for the next person, left/right through their photos"
          onDismiss={dismissSwipeTooltip}
          style={styles.swipeTooltip}
        />
      )}

      <SafeAreaView style={styles.topOverlay} edges={['top']} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Story-style segment bar — tracks the *current person's* photos,
            not position across people (there's no indicator for that at
            all; vertical swiping between people is undecorated). Resets
            implicitly per person since photoIndexByMeal defaults to 0 for
            any meal not yet visited. */}
        <View style={styles.segmentRow}>
          {Array.from({ length: activePhotoCount }).map((_, i) => (
            <View key={i} style={[styles.segment, i <= activePhotoIndex && styles.segmentActive]} />
          ))}
        </View>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={C.white} />
          </TouchableOpacity>
          <View style={styles.slotLabelWrap}>
            <View style={styles.slotLabelRow}>
              {TAG_ICON[tag] && <Feather name={TAG_ICON[tag]} size={14} color={C.white} />}
              <Text style={styles.slotLabelText}>{meta.label}</Text>
            </View>
          </View>
          <View style={{ width: 26 }} />
        </View>
      </SafeAreaView>

      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={C.orange} />
        </View>
      )}

      <CommentSheet
        visible={!!commentSheetTarget}
        postId={commentSheetTarget?.postId}
        mealId={commentSheetTarget?.mealId}
        postOwnerId={commentSheetTarget?.posterId}
        onDismiss={() => setCommentSheetTarget(null)}
      />
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
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10,
  },
  slotLabelWrap: { alignItems: 'center' },
  slotLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotLabelText: { fontSize: 14, fontWeight: '700', color: C.white },
  // Story-style bar — tracks the current person's photos, sits above the
  // back button/label row (classic IG-stories ordering).
  segmentRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 10 },
  segment: { flex: 1, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.25)' },
  segmentActive: { backgroundColor: C.orange },

  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },

  // Photo pager
  photoFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  photoFallbackEmoji: { fontSize: 64 },

  // Bottom overlay
  bottomOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 40, paddingBottom: 18,
  },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 6 },
  posterAvatar: { borderWidth: 1, borderColor: C.border },
  posterInitial: { color: C.white },
  posterUsername: { fontSize: 15, fontWeight: '700', color: C.white, flex: 1 },
  scoreBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  scoreBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  mealName: { fontFamily: C.serif, fontSize: 22, color: C.white, marginBottom: 2 },
  placeName: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 10 },

  engageRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8, marginBottom: 12 },
  engageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  engageCount: { fontSize: 13, color: C.white, fontWeight: '600' },

  swipeTooltip: { top: '42%', alignSelf: 'center' },
  // Anchored to the like button's own wrapper (engageBtn is small and
  // non-clipping), arrow pointing down at the heart icon.
  likeTooltip: { top: -66, left: -8 },

  commentInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  commentInput: { flex: 1, fontSize: 14, color: C.white, padding: 0 },
});
