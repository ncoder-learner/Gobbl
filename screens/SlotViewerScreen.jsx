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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const C = {
  bg: '#000', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', white: '#ffffff', gray1: '#888888', gray2: '#666666',
};

function scoreToneColor(score) {
  const n = Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return C.orange;
  if (n < 9) return '#00c896';
  return '#ffd166';
}
function formatScore(score) {
  const n = Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

// ─── One person's page — a vertical photo pager with fixed overlay chrome ──
function PersonPage({ person, data, likeInfo, commentCount, onLike, onSubmitComment, onOpenComments }) {
  const { meal, poster } = person;
  const [photoIndex, setPhotoIndex] = useState(0);
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
            <View style={[{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }, styles.photoFallback]}>
              <Text style={styles.photoFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
            </View>
          )
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={e => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.y / SCREEN_HEIGHT))}
        getItemLayout={(_, i) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * i, index: i })}
      />

      {photos.length > 1 && (
        <View style={styles.dotCol} pointerEvents="none">
          {photos.map((_, i) => (
            <View key={i} style={[styles.dot, i === photoIndex && styles.dotActive]} />
          ))}
        </View>
      )}

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
          <View style={styles.posterAvatar}>
            {poster?.avatar_url ? (
              <Image source={{ uri: poster.avatar_url }} style={styles.posterAvatarImage} />
            ) : (
              <Text style={styles.posterInitial}>{(poster?.username?.[0] ?? '?').toUpperCase()}</Text>
            )}
          </View>
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
          <TouchableOpacity onPress={onLike} style={styles.engageBtn} hitSlop={8} activeOpacity={0.7}>
            <Ionicons name={likeInfo?.isLiked ? 'heart' : 'heart-outline'} size={22} color={likeInfo?.isLiked ? '#ff4d6a' : C.white} />
            <Text style={styles.engageCount}>{likeInfo?.count ?? 0}</Text>
          </TouchableOpacity>
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
  const [mealData, setMealData] = useState({});     // mealId -> {score, placeName, photos}
  const [likeState, setLikeState] = useState({});   // postId -> {count, isLiked}
  const [commentCounts, setCommentCounts] = useState({}); // postId -> count
  const [commentSheetPostId, setCommentSheetPostId] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  const outerListRef = useRef(null);

  useEffect(() => {
    if (people.length === 0) { setLoading(false); return; }
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserId(user?.id ?? null);

        const mealIds = people.map(p => p.mealId);
        const postIds = people.map(p => p.postId);

        const [{ data: meals }, { data: photoRows }, { data: likeRows }, { data: commentRows }] = await Promise.all([
          supabase.from('meals').select('id, score, place_id, places(name)').in('id', mealIds),
          supabase.from('meal_photos').select('id, meal_id, photo_url').in('meal_id', mealIds).order('position', { ascending: true }),
          supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
          supabase.from('post_comments').select('id, post_id').in('post_id', postIds),
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
            placeName: m?.places?.name ?? null,
            photos: photos.length ? photos : [{ id: 'fallback', url: null }],
          };
        }
        setMealData(nextMealData);

        const nextLikes = {};
        for (const p of people) {
          const rows = (likeRows || []).filter(r => r.post_id === p.postId);
          nextLikes[p.postId] = { count: rows.length, isLiked: user ? rows.some(r => r.user_id === user.id) : false };
        }
        setLikeState(nextLikes);

        const nextComments = {};
        for (const p of people) {
          nextComments[p.postId] = (commentRows || []).filter(r => r.post_id === p.postId).length;
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

  async function toggleLike(postId) {
    if (!currentUserId) return;
    const cur = likeState[postId] || { count: 0, isLiked: false };
    const next = !cur.isLiked;
    setLikeState(s => ({ ...s, [postId]: { count: next ? cur.count + 1 : Math.max(0, cur.count - 1), isLiked: next } }));
    try {
      if (next) {
        const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUserId });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUserId);
        if (error) throw error;
      }
    } catch {
      setLikeState(s => ({ ...s, [postId]: cur }));
    }
  }

  async function submitComment(postId, text) {
    if (!currentUserId) throw new Error('Not signed in');
    const { error } = await supabase.from('post_comments').insert({ post_id: postId, user_id: currentUserId, content: text });
    if (error) throw error;
    setCommentCounts(c => ({ ...c, [postId]: (c[postId] || 0) + 1 }));
  }

  function onOuterMomentumEnd(e) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
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
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
        onMomentumScrollEnd={onOuterMomentumEnd}
        renderItem={({ item }) => (
          <PersonPage
            person={item}
            data={mealData[item.mealId]}
            likeInfo={likeState[item.postId]}
            commentCount={commentCounts[item.postId] ?? 0}
            onLike={() => toggleLike(item.postId)}
            onSubmitComment={text => submitComment(item.postId, text)}
            onOpenComments={() => setCommentSheetPostId(item.postId)}
          />
        )}
      />

      <SafeAreaView style={styles.topOverlay} edges={['top']} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={C.white} />
          </TouchableOpacity>
          <View style={styles.slotLabelWrap}>
            <View style={styles.slotLabelRow}>
              {TAG_ICON[tag] && <Feather name={TAG_ICON[tag]} size={14} color={C.white} />}
              <Text style={styles.slotLabelText}>{meta.label}</Text>
            </View>
            <Text style={styles.positionText}>{activeIndex + 1} of {people.length}</Text>
          </View>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.segmentRow}>
          {people.map((_, i) => (
            <View key={i} style={[styles.segment, i <= activeIndex && styles.segmentActive]} />
          ))}
        </View>
      </SafeAreaView>

      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={C.orange} />
        </View>
      )}

      <CommentSheet
        visible={!!commentSheetPostId}
        postId={commentSheetPostId}
        postOwnerId={people.find(p => p.postId === commentSheetPostId)?.poster?.id}
        onDismiss={() => setCommentSheetPostId(null)}
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
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
  },
  slotLabelWrap: { alignItems: 'center' },
  slotLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotLabelText: { fontSize: 14, fontWeight: '700', color: C.white },
  positionText: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
  segmentRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 16 },
  segment: { flex: 1, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.25)' },
  segmentActive: { backgroundColor: C.orange },

  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },

  // Photo pager
  photoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#151515' },
  photoFallbackEmoji: { fontSize: 64 },

  // Vertical dot row — indicates position among this person's photos
  dotCol: {
    position: 'absolute', right: 10, top: '38%',
    alignItems: 'center', gap: 5,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: C.white, width: 6, height: 6, borderRadius: 3 },

  // Bottom overlay
  bottomOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 40, paddingBottom: 18,
  },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 6 },
  posterAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  posterAvatarImage: { width: '100%', height: '100%' },
  posterInitial: { fontSize: 12, fontWeight: '700', color: C.white },
  posterUsername: { fontSize: 15, fontWeight: '700', color: C.white, flex: 1 },
  scoreBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  scoreBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  mealName: { fontSize: 15, fontWeight: '600', color: C.white, marginBottom: 2 },
  placeName: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 10 },

  engageRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8, marginBottom: 12 },
  engageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  engageCount: { fontSize: 13, color: C.white, fontWeight: '600' },

  commentInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  commentInput: { flex: 1, fontSize: 14, color: C.white, padding: 0 },
});
