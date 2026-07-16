import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Modal, Pressable, Dimensions, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import ShareBottomSheet from '../components/ShareBottomSheet';
import { fetchPostedMealIds, MEAL_TAGS, TAG_META, TAG_ICON } from '../lib/postUtils';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', white: '#ffffff', gray1: '#888888', gray2: '#666666', gray4: '#444444',
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Sized off the actual viewport, not fixed pixels, so this holds across
// device sizes (this screen used to be a ~380px-wide card design; it's now
// a full screen and needs to fill it, not cluster three cramped rows at the
// top). Tile size scales off width (it's a horizontal photo tray — width is
// what determines how many tiles peek per row); capped so it doesn't balloon
// on tablets. Section gap scales off height, giving more breathing room on
// taller screens instead of a fixed gap that reads as cramped everywhere.
const TILE_SIZE = Math.min(Math.round(SCREEN_WIDTH * 0.3), 140);
const SECTION_GAP = Math.round(SCREEN_HEIGHT * 0.045);
const TILE_GAP = Math.round(TILE_SIZE * 0.12);

// ─── Header-action helpers (ported verbatim from FeedScreen.jsx) ──────────────
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

// ─── Streak (ported from FeedScreen.jsx's PersonalStrip logic) ────────────────
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

// A soft pulsing ring around your own tile when you're on a streak — purely
// an opacity loop on an absolute-positioned border overlay, so it's
// native-driver-friendly (no animating shadow props) and cheap to run
// continuously.
function FireRing() {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View pointerEvents="none" style={[styles.fireRing, { opacity: pulse }]} />;
}

// Fades + scales a tile in on its first mount only — React reuses the same
// component instance (matched by the `key` prop) across refocuses/refetches
// as long as the tile's mealId keeps appearing, so this naturally only plays
// once per tile per app session, not on every tab refocus. `delay` staggers
// tiles into a cascading reveal instead of everything popping in at once.
function FadeScaleIn({ delay = 0, style, children }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1, duration: 380, delay, useNativeDriver: true,
    }).start();
  }, []);
  const opacity = progress;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return (
    <Animated.View style={[style, { opacity, transform: [{ scale }, { translateY }] }]}>
      {children}
    </Animated.View>
  );
}

// One meal-in-a-slot tile — the unit of display here, not the post. Several
// tiles across different rows can come from the same post if it has
// multiple slots filled. Shadow lives on a separate, non-clipping wrapper —
// overflow:hidden (needed to round the photo's corners) would otherwise
// clip the shadow itself, especially on Android where elevation and
// overflow:hidden fight each other on the same view.
function BoardTile({ tile, onPress, delay, onFire }) {
  const { meal, poster, isMine } = tile;
  return (
    <FadeScaleIn delay={delay} style={styles.tileShadowWrap}>
      <TouchableOpacity style={[styles.tile, isMine && styles.tileMine]} onPress={onPress} activeOpacity={0.85}>
        {meal.photo_url ? (
          <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.tileFallback]}>
            <Text style={styles.tileFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Text style={styles.tileUsername} numberOfLines={1}>@{poster?.username ?? '?'}</Text>
      </TouchableOpacity>
      {isMine && onFire && <FireRing />}
    </FadeScaleIn>
  );
}

function YouEmptyTile({ onPress, delay }) {
  return (
    <FadeScaleIn delay={delay} style={styles.youTileShadowWrap}>
      <TouchableOpacity style={styles.youTile} onPress={onPress} activeOpacity={0.75}>
        <Ionicons name="add" size={26} color={C.orange} />
        <Text style={styles.youTileLabel}>you</Text>
      </TouchableOpacity>
    </FadeScaleIn>
  );
}

// Your own tile — real (posted) or the dashed empty "+ you" one — always
// renders and stays tappable, first in the row, regardless of whether
// anyone else has posted. The section only dims to signal "no friend
// activity here yet"; that's a visual cue on top, not a gate on your own
// ability to post into this slot from the board.
// STAGGER_SECTION spaces out each of the 3 slot rows' reveal; STAGGER_TILE
// staggers tiles within a row — together they read as a diagonal cascade
// down and across the board rather than a flat all-at-once pop-in.
const STAGGER_SECTION = 110;
const STAGGER_TILE = 55;

function BoardSection({ tag, sectionIndex, tiles, onPressTile, onPressYou, onFire }) {
  const meta = TAG_META[tag];
  const mineTile = tiles.find(t => t.isMine);
  const othersTiles = tiles.filter(t => !t.isMine);
  const isDimmed = othersTiles.length === 0;
  // The exact order rendered — also the order SlotViewerScreen swipes
  // through, so the tapped tile's index here must match what's on screen.
  const orderedTiles = mineTile ? [mineTile, ...othersTiles] : othersTiles;
  const sectionDelay = sectionIndex * STAGGER_SECTION;

  return (
    <View style={[styles.section, isDimmed && styles.sectionDimmed]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Feather name={TAG_ICON[tag]} size={16} color={C.white} />
          <Text style={styles.sectionTitle}>{meta.label}</Text>
        </View>
        <Text style={styles.sectionCount}>
          {tiles.length === 0 ? 'nobody yet' : `${tiles.length} posted`}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tileRow}
      >
        {mineTile ? (
          <BoardTile tile={mineTile} delay={sectionDelay} onFire={onFire} onPress={() => onPressTile(tag, orderedTiles, 0)} />
        ) : (
          <YouEmptyTile delay={sectionDelay} onPress={() => onPressYou(tag)} />
        )}
        {othersTiles.map((tile, i) => (
          <BoardTile
            key={tile.mealId}
            tile={tile}
            delay={sectionDelay + (i + 1) * STAGGER_TILE}
            onPress={() => onPressTile(tag, orderedTiles, mineTile ? i + 1 : i)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export default function DayBoardScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [error, setError] = useState(null);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [streak, setStreak] = useState(0);
  const [loggedToday, setLoggedToday] = useState(false);

  // Compose / meal picker — ported verbatim from FeedScreen.jsx
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMeals, setPickerMeals]     = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [shareTarget, setShareTarget]     = useState(null); // meal to share

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      // RLS (see_own_and_friends_posts) already scopes this to the caller's
      // own posts plus accepted friends' — no extra filtering needed here.
      const [{ data, error: err }, pendingResult, streakResult] = await Promise.all([
        supabase
          .from('posts')
          .select(`
            id, user_id, created_at,
            breakfast:meals!breakfast_meal_id(id, name, photo_url, emoji),
            lunch:meals!lunch_meal_id(id, name, photo_url, emoji),
            dinner:meals!dinner_meal_id(id, name, photo_url, emoji),
            profiles!posts_user_id_fkey(id, username, avatar_url)
          `)
          .gte('created_at', dayStart)
          .lt('created_at', dayEnd),
        supabase
          .from('friendships')
          .select('id', { count: 'exact', head: true })
          .eq('addressee_id', user.id)
          .eq('status', 'pending'),
        supabase
          .from('meals')
          .select('created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),
      ]);
      if (err) throw err;
      setPosts(data || []);
      setPendingRequests(pendingResult.count ?? 0);
      const { streak: s, loggedToday: lt } = computeStreak(streakResult.data);
      setStreak(s);
      setLoggedToday(lt);
    } catch (e) {
      setError(e.message || "Failed to load today's board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function tilesForTag(tag) {
    const tiles = [];
    for (const post of posts) {
      const meal = post[tag];
      if (!meal) continue;
      tiles.push({
        postId: post.id,
        mealId: meal.id,
        meal,
        poster: post.profiles,
        isMine: post.user_id === currentUserId,
      });
    }
    return tiles;
  }

  const tilesByTag = Object.fromEntries(MEAL_TAGS.map(tag => [tag, tilesForTag(tag)]));

  const friendsEatingCount = new Set(
    MEAL_TAGS.flatMap(tag => tilesByTag[tag])
      .filter(t => !t.isMine)
      .map(t => t.poster?.id)
      .filter(Boolean)
  ).size;

  const totalMealsToday = MEAL_TAGS.reduce((sum, tag) => sum + tilesByTag[tag].length, 0);

  const dateLabel = now => now.toLocaleDateString([], { weekday: 'long' });

  function handlePressTile(tag, orderedTiles, index) {
    navigation.navigate('SlotViewer', { tag, people: orderedTiles, initialIndex: index });
  }

  function handlePressYou(tag) {
    navigation.navigate('LogMeal', { forceTag: tag });
  }

  function handleAddFriends() {
    navigation.navigate('Friends');
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Subtle top-to-bottom gradient instead of flat black — cheap depth
          cue across the whole screen. */}
      <LinearGradient
        colors={['#1c1c1c', C.bg]}
        locations={[0, 0.4]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* ── Meal picker modal (ported verbatim from FeedScreen.jsx) ───────── */}
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

      <View style={styles.navBar}>
        <Text style={styles.navTitle}>FoodWrapped</Text>
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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.orange} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.dateHeader}>{dateLabel(new Date())}</Text>
          <Text style={styles.friendCount}>
            {friendsEatingCount === 0
              ? 'No friends eating yet today'
              : `${friendsEatingCount} friend${friendsEatingCount === 1 ? '' : 's'} eating`}
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {MEAL_TAGS.map((tag, sectionIndex) => (
            <BoardSection
              key={tag}
              tag={tag}
              sectionIndex={sectionIndex}
              tiles={tilesByTag[tag]}
              onPressTile={handlePressTile}
              onPressYou={handlePressYou}
              onFire={streak > 0}
            />
          ))}

          <View style={styles.footerCard}>
            <View style={styles.footerRow}>
              <Text style={styles.footerFlame}>🔥</Text>
              <Text style={styles.footerStreakNum}>{streak}</Text>
              <Text style={styles.footerStreakLabel}>
                {streak > 0
                  ? (loggedToday ? 'day streak' : 'days · log today to keep it!')
                  : 'Log a meal to start your streak'}
              </Text>
            </View>
            {totalMealsToday > 0 && (
              <>
                <View style={styles.footerDivider} />
                <Text style={styles.footerStat}>
                  {totalMealsToday} meal{totalMealsToday === 1 ? '' : 's'} logged today
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: SECTION_GAP },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8,
  },
  navTitle: { fontWeight: '800', fontSize: 22, color: C.white, letterSpacing: -0.5 },
  headerActions: {
    flexDirection: 'row', alignItems: 'center', gap: 18,
  },

  // Friend request badge
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#ff4d6a', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

  // Meal picker modal (ported verbatim from FeedScreen.jsx)
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

  dateHeader: {
    fontSize: 28, fontWeight: '800', color: C.white, letterSpacing: -0.5,
    paddingHorizontal: 20, marginTop: 8,
  },
  friendCount: {
    fontSize: 14, color: C.gray2, fontWeight: '500',
    paddingHorizontal: 20, marginTop: 4, marginBottom: Math.round(SECTION_GAP * 0.8),
  },
  errorText: { fontSize: 13, color: '#ff6b6b', paddingHorizontal: 20, marginBottom: 12 },

  section: { marginBottom: SECTION_GAP },
  sectionDimmed: { opacity: 0.55 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 12,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.white },
  sectionCount: { fontSize: 13, color: C.gray2, fontWeight: '500' },

  tileRow: { paddingHorizontal: 20, gap: TILE_GAP },

  // Shadow lives here, separate from `tile`'s overflow:hidden (see
  // BoardTile's comment) — gives every tile real depth instead of a flat
  // bordered square.
  tileShadowWrap: {
    borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 10,
    elevation: 6,
  },
  tile: {
    width: TILE_SIZE, height: TILE_SIZE, borderRadius: 18, overflow: 'hidden',
    backgroundColor: '#111', justifyContent: 'flex-end',
    borderWidth: 1, borderColor: C.border,
  },
  tileMine: { borderWidth: 2.5, borderColor: C.orange },
  tileFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#151515' },
  tileFallbackEmoji: { fontSize: 36 },
  tileUsername: {
    fontSize: 12, fontWeight: '700', color: '#fff',
    paddingHorizontal: 8, paddingBottom: 8,
  },

  // A dashed outline reads as a placeholder, not a solid raised object — a
  // heavy black drop shadow (right for photo tiles) looked wrong here. A
  // soft, low-opacity warm glow keeps it feeling lifted without implying
  // it's a physical card like the photo tiles.
  youTileShadowWrap: {
    borderRadius: 18,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22, shadowRadius: 8,
    elevation: 2,
  },
  youTile: {
    width: TILE_SIZE, height: TILE_SIZE, borderRadius: 18,
    borderWidth: 1.5, borderColor: C.orange, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: 'rgba(255,107,61,0.06)',
  },
  youTileLabel: { fontSize: 13, fontWeight: '700', color: C.orange },

  // Pulsing ring on your own tile while you're on a streak
  fireRing: {
    position: 'absolute', top: -4, left: -4, right: -4, bottom: -4,
    borderRadius: 22, borderWidth: 2, borderColor: C.orange,
  },

  // Footer — closes out the page instead of just trailing off into empty
  // space below the three sections.
  footerCard: {
    marginHorizontal: 20, marginTop: Math.round(SECTION_GAP * 0.4),
    backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 16, padding: 16,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerFlame: { fontSize: 20, marginRight: 8 },
  footerStreakNum: { fontSize: 20, fontWeight: '800', color: C.orange, marginRight: 6 },
  footerStreakLabel: { fontSize: 13, color: C.gray1, flex: 1 },
  footerDivider: { height: 0.5, backgroundColor: C.border, marginVertical: 12 },
  footerStat: { fontSize: 13, color: C.gray2, fontWeight: '500' },
});
