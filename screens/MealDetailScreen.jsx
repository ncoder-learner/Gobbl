import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Image, ScrollView, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Dimensions, Alert, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import CommentSheet from '../components/CommentSheet';
import DayTrail from '../components/DayTrail';
import { MEAL_TAGS, TAG_META } from '../lib/postUtils';
import { mappableCoords, displayPlaceName, isHomeMeal } from '../lib/homePrivacy';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from '../components/StripedPlaceholder';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAROUSEL_HEIGHT = SCREEN_WIDTH * 1.15;
const MAX_PHOTO_WIDTH = 1280;

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function formatFullTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatDistance(mi) {
  if (mi == null) return null;
  if (mi < 0.1) return '<0.1 mi';
  return `${mi.toFixed(1)} mi`;
}

async function compressImage(uri) {
  return manipulateAsync(
    uri,
    [{ resize: { width: MAX_PHOTO_WIDTH } }],
    { compress: 0.82, format: SaveFormat.JPEG, base64: true },
  );
}

// ─── Progress bar (Instagram-style, one segment per photo) ────────────────────
function CarouselProgress({ count, activeIndex }) {
  if (count <= 1) return null;
  return (
    <View style={styles.progressRow} pointerEvents="none">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.progressTrack}>
          <View style={[styles.progressFill, i <= activeIndex && styles.progressFillActive]} />
        </View>
      ))}
    </View>
  );
}


// ─── Main screen ────────────────────────────────────────────────────────────
export default function MealDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { mealId, postId: routePostId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meal, setMeal] = useState(null);
  const [photos, setPhotos] = useState([]); // [{ id, url }]
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentUserId, setCurrentUserId] = useState(null);

  const [post, setPost] = useState(null); // null if this meal was never shared
  const [trailImages, setTrailImages] = useState([]); // [{tag, meal}] for the post's Day Trail
  const [likeCount, setLikeCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [liking, setLiking] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [commentOpen, setCommentOpen] = useState(false);

  const [userCoords, setUserCoords] = useState(null);
  const [uploading, setUploading] = useState(false);

  const listRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);

      // Likes/comments are keyed to this specific meal now (migration 018 —
      // they used to be keyed to the whole post, so liking one slot of a
      // tri-image post would show as liked on every slot). Fetched directly
      // off the meal via its post_likes/post_comments meal_id FK, not
      // through the post.
      const [{ data: mealData, error: mealErr }, { data: photoRows, error: photoErr }] = await Promise.all([
        supabase.from('meals').select('*, places(name, address, lat, lng), post_likes(user_id), post_comments(id)').eq('id', mealId).single(),
        supabase.from('meal_photos').select('id, photo_url').eq('meal_id', mealId).order('position', { ascending: true }),
      ]);
      if (mealErr) throw mealErr;
      if (photoErr) throw photoErr;

      setMeal(mealData);
      setPhotos([
        ...(mealData.photo_url ? [{ id: 'primary', url: mealData.photo_url }] : []),
        ...(photoRows || []).map(p => ({ id: p.id, url: p.photo_url })),
      ]);
      const mealLikes = mealData.post_likes || [];
      setLikeCount(mealLikes.length);
      setIsLiked(user ? mealLikes.some(l => l.user_id === user.id) : false);
      setCommentCount((mealData.post_comments || []).length);

      // Resolve the backing post (for Tier Duel/Day Trail) — either the one
      // we were told about (from FeedScreen), or looked up across all 4 slot
      // columns (from TierListScreen, which doesn't know if/how this meal was
      // posted). The same breakfast/lunch/dinner + places(lat,lng,name) join
      // FeedScreen uses is included here so DayTrail can render identically.
      const POST_FIELDS = `
        id, user_id, caption,
        breakfast:meals!breakfast_meal_id(id, name, emoji, score, photo_url, tag, place_id, created_at, places(lat, lng, name)),
        lunch:meals!lunch_meal_id(id, name, emoji, score, photo_url, tag, place_id, created_at, places(lat, lng, name)),
        dinner:meals!dinner_meal_id(id, name, emoji, score, photo_url, tag, place_id, created_at, places(lat, lng, name))
      `;
      let resolvedPost = null;
      if (routePostId) {
        const { data, error: postErr } = await supabase
          .from('posts')
          .select(POST_FIELDS)
          .eq('id', routePostId)
          .maybeSingle();
        if (postErr) console.error('[MealDetail] post lookup by id failed:', postErr.message);
        resolvedPost = data ?? null;
      } else {
        const { data, error: postErr } = await supabase
          .from('posts')
          .select(POST_FIELDS)
          .or(`meal_id.eq.${mealId},breakfast_meal_id.eq.${mealId},lunch_meal_id.eq.${mealId},dinner_meal_id.eq.${mealId}`)
          .limit(1);
        if (postErr) console.error('[MealDetail] post lookup by meal slots failed:', postErr.message);
        resolvedPost = data?.[0] ?? null;
      }
      setPost(resolvedPost);
      if (resolvedPost) {
        setTrailImages(
          MEAL_TAGS.map(tag => (resolvedPost[tag] ? { tag, meal: resolvedPost[tag] } : null)).filter(Boolean)
        );
      } else {
        setTrailImages([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load meal.');
    } finally {
      setLoading(false);
    }
  }, [mealId, routePostId]);

  // Refetches on every focus (not just mealId/routePostId changes) so
  // returning here after EditMealScreen shows the saved changes.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live device position for the distance line — same pattern as
  // LogMealScreen/TierListScreen, non-blocking if denied.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        // non-fatal
      }
    })();
  }, []);

  async function toggleLike() {
    if (!post || liking || !currentUserId) return;
    const next = !isLiked;
    setIsLiked(next);
    setLikeCount(c => next ? c + 1 : Math.max(0, c - 1));
    setLiking(true);
    try {
      if (next) {
        const { error } = await supabase.from('post_likes').insert({ post_id: post.id, meal_id: mealId, user_id: currentUserId });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_likes').delete().eq('meal_id', mealId).eq('user_id', currentUserId);
        if (error) throw error;
      }
    } catch {
      setIsLiked(!next);
      setLikeCount(c => next ? Math.max(0, c - 1) : c + 1);
    } finally {
      setLiking(false);
    }
  }

  async function handleAddPhoto() {
    if (uploading) return;
    if (Platform.OS === 'android') {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        if (!canAskAgain) {
          Alert.alert(
            'Permission required',
            'Open your device settings to allow Gobbl to access your photos.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
        }
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled) return;

    setUploading(true);
    let uploadedFileName = null;
    try {
      const compressed = await compressImage(result.assets[0].uri);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const fileName = `${user.id}/${Date.now()}.jpg`;
      uploadedFileName = fileName;
      const { error: uploadError } = await supabase.storage
        .from('meal-photos')
        .upload(fileName, decode(compressed.base64), { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('meal-photos').getPublicUrl(fileName);

      const { data: inserted, error: insertError } = await supabase
        .from('meal_photos')
        .insert({ meal_id: mealId, photo_url: publicUrl, position: photos.length })
        .select('id, photo_url')
        .single();
      if (insertError) throw insertError;

      setPhotos(prev => {
        const next = [...prev, { id: inserted.id, url: inserted.photo_url }];
        setTimeout(() => listRef.current?.scrollToIndex({ index: next.length - 1, animated: true }), 60);
        return next;
      });
    } catch (err) {
      if (uploadedFileName) {
        await supabase.storage.from('meal-photos').remove([uploadedFileName]).catch(() => {});
      }
      Alert.alert('Upload failed', err.message || 'Could not add photo. Try again.');
    } finally {
      setUploading(false);
    }
  }

  function onCarouselScroll(e) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (idx !== activeIndex) setActiveIndex(idx);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}><ActivityIndicator color={C.orange} /></View>
      </SafeAreaView>
    );
  }

  if (error || !meal) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>⚠️</Text>
          <Text style={styles.emptyTitle}>Couldn't load this meal</Text>
          {error ? <Text style={styles.emptySub}>{error}</Text> : null}
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.85}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.floatingBackBtn} onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={C.white} />
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isOwner = !!currentUserId && meal.user_id === currentUserId;
  const meta = meal.tag && TAG_META[meal.tag] ? TAG_META[meal.tag] : null;
  const mealCoord = mappableCoords(meal, { isOwner });
  const distanceMi = userCoords && mealCoord
    ? haversineMiles(userCoords.lat, userCoords.lng, mealCoord.lat, mealCoord.lng)
    : null;
  const distance = formatDistance(distanceMi);
  const placeName = displayPlaceName(meal);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* ── Carousel ─────────────────────────────────────────────────────── */}
        <View style={styles.carouselWrap}>
          {photos.length > 0 ? (
            <FlatList
              ref={listRef}
              data={photos}
              keyExtractor={p => String(p.id)}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onCarouselScroll}
              scrollEventThrottle={16}
              getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
              renderItem={({ item }) => (
                <Image source={{ uri: item.url }} style={{ width: SCREEN_WIDTH, height: CAROUSEL_HEIGHT }} resizeMode="cover" />
              )}
            />
          ) : (
            <StripedPlaceholder style={{ width: SCREEN_WIDTH, height: CAROUSEL_HEIGHT }}>
              <View style={styles.carouselFallback}>
                <Text style={styles.carouselFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
              </View>
            </StripedPlaceholder>
          )}

          <CarouselProgress count={photos.length} activeIndex={activeIndex} />

          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={C.white} />
          </TouchableOpacity>

          {isOwner && (
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => navigation.navigate('EditMeal', { mealId })}
              hitSlop={10}
            >
              <Ionicons name="pencil" size={18} color={C.white} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Info block ───────────────────────────────────────────────────── */}
        <View style={styles.infoBlock}>
          <View style={styles.nameScoreRow}>
            <Text style={styles.mealName}>{meal.name}</Text>
            <Text style={[styles.scoreInline, { color: scoreToneColor(meal.score) }]}>{formatScore(meal.score)}</Text>
          </View>

          <Text style={styles.metaLine} numberOfLines={1}>
            {[isOwner ? 'you' : null, placeName, meta?.label].filter(Boolean).join(' · ')}
          </Text>

          <View style={styles.divider} />

          {placeName ? (
            <View style={styles.placeRow}>
              <Ionicons name="location-outline" size={14} color={C.gray2} />
              <Text style={styles.placeName} numberOfLines={1}>
                {placeName}{(!isHomeMeal(meal) && meal.places?.address) ? ` · ${meal.places.address}` : ''}
              </Text>
            </View>
          ) : null}

          <Text style={styles.timestamp}>{formatFullTimestamp(meal.created_at)}</Text>

          {distance && (
            <View style={styles.metaRow}>
              <Text style={styles.distanceText}>📍 {distance}</Text>
            </View>
          )}

          {post?.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

          <DayTrail images={trailImages} isOwner={isOwner} />

          {isOwner && (
            <TouchableOpacity
              style={[styles.addPhotoBtn, uploading && styles.addPhotoBtnDisabled]}
              onPress={handleAddPhoto}
              disabled={uploading}
              activeOpacity={0.85}
            >
              {uploading ? (
                <ActivityIndicator color={C.orange} size="small" />
              ) : (
                <>
                  <Ionicons name="add-circle-outline" size={18} color={C.orange} />
                  <Text style={styles.addPhotoText}>Add photo</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {post && (
            <View style={styles.engageRow}>
              <TouchableOpacity onPress={toggleLike} style={styles.engageBtn} hitSlop={10} activeOpacity={0.7}>
                <Ionicons
                  name={isLiked ? 'heart' : 'heart-outline'}
                  size={22}
                  color={isLiked ? '#ff4d6a' : C.gray2}
                />
                {likeCount > 0 && (
                  <Text style={[styles.engageCount, isLiked && { color: '#ff4d6a' }]}>{likeCount}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCommentOpen(true)} style={styles.engageBtn} hitSlop={10} activeOpacity={0.7}>
                <Ionicons name="chatbubble-outline" size={20} color={C.gray2} />
                {commentCount > 0 && (
                  <Text style={styles.engageCount}>{commentCount}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {post && (
        <CommentSheet
          visible={commentOpen}
          postId={post.id}
          mealId={mealId}
          postOwnerId={post.user_id}
          onDismiss={() => setCommentOpen(false)}
          onCommentPosted={() => setCommentCount(c => c + 1)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontWeight: '700', fontSize: 18, color: C.white, marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, color: C.gray1, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn: { backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: C.white },

  floatingBackBtn: {
    position: 'absolute', top: 12, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },

  // Carousel
  carouselWrap: { position: 'relative', backgroundColor: '#000' },
  carouselFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  carouselFallbackEmoji: { fontSize: 64 },

  progressRow: {
    position: 'absolute', top: 10, left: 10, right: 10,
    flexDirection: 'row', gap: 4,
  },
  progressTrack: {
    flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden',
  },
  progressFill: { flex: 1, backgroundColor: 'transparent' },
  progressFillActive: { backgroundColor: '#fff' },

  backBtn: {
    position: 'absolute', top: 20, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  editBtn: {
    position: 'absolute', top: 20, right: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },

  // Info block
  infoBlock: { paddingHorizontal: 20, paddingTop: 18 },
  nameScoreRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  mealName: { flex: 1, fontFamily: C.serif, fontSize: 26, color: C.white },
  scoreInline: { fontFamily: C.serif, fontSize: 28, lineHeight: 30 },
  metaLine: { fontSize: 13, color: 'rgba(245,245,247,0.5)', marginTop: 3 },
  divider: { height: 1, backgroundColor: C.glassBorder, marginVertical: 16 },

  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  placeName: { fontSize: 13, color: C.gray1, flexShrink: 1 },

  timestamp: { fontSize: 12, color: C.gray2, marginBottom: 12 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  distanceText: { fontSize: 12, fontWeight: '600', color: C.gray1 },

  caption: { fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 21, marginBottom: 16 },

  addPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    alignSelf: 'flex-start',
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.orange + '50',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10,
    marginBottom: 16,
  },
  addPhotoBtnDisabled: { opacity: 0.6 },
  addPhotoText: { fontSize: 13, fontWeight: '700', color: C.orange },

  engageRow: {
    flexDirection: 'row', alignItems: 'center', gap: 20,
    borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 14,
  },
  engageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  engageCount: { fontSize: 13, color: C.gray1, fontWeight: '600' },
});
