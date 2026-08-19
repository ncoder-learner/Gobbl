import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Modal, Pressable, Dimensions, Animated, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import ShareBottomSheet from '../components/ShareBottomSheet';
import DayTrail from '../components/DayTrail';
import AdMobBanner from '../components/AdMobBanner';
import { fetchPostedMealIds, MEAL_TAGS, TAG_META, TAG_ICON } from '../lib/postUtils';
import { skipMeal, unskipMeal } from '../lib/skips';
import { localDateKey } from '../lib/dateKey';
import { displayPlaceName } from '../lib/homePrivacy';
import { isDuelUnlocked } from '../lib/postVotes';
import { useFirstVisit, FirstVisitTooltip } from '../lib/firstVisit';
import { useTour, TourTarget } from '../lib/tourContext';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from '../components/StripedPlaceholder';

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
  if (n < 7) return C.orange;
  if (n < 9) return C.green;
  return C.gold;
}
function formatScore(score) {
  const n = typeof score === 'number' ? score : Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function formatDistance(mi) {
  if (mi == null) return '—';
  if (mi < 0.1) return '<0.1 mi';
  return `${mi.toFixed(1)} mi`;
}

// ─── Streak (ported from FeedScreen.jsx's PersonalStrip logic) ────────────────
// extraDayKeys are days resolved by a skip (not a logged meal) — a day
// marked skipped counts as resolved same as a day with a meal logged, so it
// merges straight into the same date set the backward-walk uses.
function computeStreak(rows, extraDayKeys) {
  const dateSet = new Set((rows || []).map(r => localDateKey(new Date(r.created_at))));
  if (extraDayKeys) for (const k of extraDayKeys) dateSet.add(k);
  if (dateSet.size === 0) return { streak: 0, loggedToday: false };
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

// A springy press-scale wrapper — the tactile "give" iOS controls have on
// touch. Separate from FadeScaleIn (that's a one-time mount animation; this
// runs on every press) so the two compose cleanly on the same tile.
function PressableScale({ onPress, onLongPress, style, children, activeScale = 0.96 }) {
  const scale = useRef(new Animated.Value(1)).current;
  function pressIn() {
    Animated.spring(scale, { toValue: activeScale, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  }
  function pressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 9 }).start();
  }
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} onPressIn={pressIn} onPressOut={pressOut}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// One meal-in-a-slot tile — the unit of display here, not the post. Several
// tiles across different rows can come from the same post if it has
// multiple slots filled. Shadow lives on a separate, non-clipping wrapper —
// overflow:hidden (needed to round the photo's corners) would otherwise
// clip the shadow itself, especially on Android where elevation and
// overflow:hidden fight each other on the same view.
function BoardTile({ tile, onPress, delay, onFire, likeCount, commentCount, isLeader }) {
  const { meal, poster, isMine } = tile;
  const showBadge = likeCount > 0 || commentCount > 0;
  return (
    <FadeScaleIn delay={delay} style={styles.tileShadowWrap}>
      <PressableScale style={[styles.tile, isLeader && styles.tileLeader, isMine && styles.tileMine]} onPress={onPress}>
        {isLeader && (
          <View style={styles.tileCrownBadge}>
            <Ionicons name="star" size={12} color={C.bg} />
          </View>
        )}
        {meal.photo_url ? (
          <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <StripedPlaceholder style={StyleSheet.absoluteFill}>
            <View style={styles.tileFallback}>
              <Text style={styles.tileFallbackEmoji}>{meal.emoji || '🍽️'}</Text>
            </View>
          </StripedPlaceholder>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          locations={[0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Text style={styles.tileUsername} numberOfLines={1}>@{poster?.username ?? '?'}</Text>
        {showBadge && (
          <View style={styles.tileEngageBadge}>
            {likeCount > 0 && (
              <View style={styles.tileEngageItem}>
                <Ionicons name="heart" size={10} color="#ff4d6a" />
                <Text style={styles.tileEngageText}>{likeCount}</Text>
              </View>
            )}
            {commentCount > 0 && (
              <View style={styles.tileEngageItem}>
                <Ionicons name="chatbubble" size={9} color="#fff" />
                <Text style={styles.tileEngageText}>{commentCount}</Text>
              </View>
            )}
          </View>
        )}
      </PressableScale>
      {isMine && onFire && <FireRing />}
    </FadeScaleIn>
  );
}

// Tapping opens the log/skip action sheet (see YouActionSheet) — both
// options equally visible, rather than hiding "skip" behind a long-press.
function YouEmptyTile({ onPress, delay }) {
  return (
    <FadeScaleIn delay={delay} style={styles.youTileShadowWrap}>
      <PressableScale style={styles.youTile} onPress={onPress}>
        <Ionicons name="add" size={26} color={C.orange} />
        <Text style={styles.youTileLabel}>you</Text>
      </PressableScale>
    </FadeScaleIn>
  );
}

// Muted stand-in for "+ you" once the slot's been marked skipped — private
// to the viewer (skippedTags never reaches a friend's board, since
// meal_skips has no friend-read policy), so this only ever renders on your
// own board. Tapping un-skips and drops straight into logging, per spec
// ("tapping a skipped slot lets the user un-skip and log normally").
function SkippedTile({ onPress, delay }) {
  return (
    <FadeScaleIn delay={delay} style={styles.skippedTileShadowWrap}>
      <PressableScale style={styles.skippedTile} onPress={onPress}>
        <Ionicons name="remove-circle-outline" size={22} color={C.gray1} />
        <Text style={styles.skippedTileLabel}>skipped</Text>
      </PressableScale>
    </FadeScaleIn>
  );
}

// Small bottom sheet opened by tapping an empty "+ you" tile — "log" and
// "skip" surfaced as two equally-visible rows rather than hiding skip behind
// a long-press. Mirrors the meal-picker sheet's overlay/handle/sheet shape
// so it reads as the same family of control, just shorter.
function YouActionSheet({ visible, tag, onDismiss, onLogMeal, onSkip }) {
  const meta = tag ? TAG_META[tag] : null;
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onDismiss}>
      <Pressable style={styles.actionSheetOverlay} onPress={onDismiss}>
        <Pressable style={styles.actionSheetSheet} onPress={() => {}}>
          <View style={styles.pickerHandle} />
          {meta && <Text style={styles.actionSheetTitle}>{meta.label}</Text>}
          <TouchableOpacity style={styles.actionSheetRow} activeOpacity={0.72} onPress={onLogMeal}>
            <Ionicons name="add-circle-outline" size={20} color={C.orange} />
            <Text style={styles.actionSheetRowText}>Log a meal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionSheetRow} activeOpacity={0.72} onPress={onSkip}>
            <Ionicons name="remove-circle-outline" size={20} color={C.gray1} />
            <Text style={[styles.actionSheetRowText, { color: C.gray1 }]}>Skip this meal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionSheetCancelRow} activeOpacity={0.72} onPress={onDismiss}>
            <Text style={styles.actionSheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
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

function BoardSection({
  tag, sectionIndex, tiles, onPressTile, onPressYou, onPressSkipped, isSkipped, onFire, likeCounts, commentCounts, leaderMealIds,
  duelUnlocked, duelVoted, onPressDuel,
  showYouTooltip, onDismissYouTooltip, showDuelTooltip, onDismissDuelTooltip,
  isFirstYouTarget, isFirstTileTarget, isFirstDuelTarget,
}) {
  const meta = TAG_META[tag];
  const mineTile = tiles.find(t => t.isMine);
  const othersTiles = tiles.filter(t => !t.isMine);
  const isDimmed = othersTiles.length === 0;
  // The exact order rendered — also the order SlotViewerScreen swipes
  // through, so the tapped tile's index here must match what's on screen.
  const orderedTiles = mineTile ? [mineTile, ...othersTiles] : othersTiles;
  const sectionDelay = sectionIndex * STAGGER_SECTION;

  const firstTile = mineTile
    ? <BoardTile
        tile={mineTile}
        delay={sectionDelay}
        onFire={onFire}
        likeCount={likeCounts[mineTile.mealId] || 0}
        commentCount={commentCounts[mineTile.mealId] || 0}
        isLeader={leaderMealIds.includes(mineTile.mealId)}
        onPress={() => onPressTile(tag, orderedTiles, 0)}
      />
    : isSkipped
    ? <SkippedTile delay={sectionDelay} onPress={() => onPressSkipped(tag)} />
    : <YouEmptyTile delay={sectionDelay} onPress={() => onPressYou(tag)} />;

  return (
    <View style={[styles.section, isDimmed && styles.sectionDimmed]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Feather name={TAG_ICON[tag]} size={16} color={C.white} />
          <Text style={styles.sectionTitle}>{meta.label}</Text>
        </View>
        <Text style={styles.sectionCount}>
          {isSkipped && tiles.length === 0 ? 'skipped' : tiles.length === 0 ? 'tap + to fill this in' : `${tiles.length} posted`}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tileRow}
      >
        {!mineTile && isFirstYouTarget ? (
          <TourTarget id="board.youtile" action={() => onPressYou(tag)}>{firstTile}</TourTarget>
        ) : mineTile && isFirstTileTarget ? (
          <TourTarget id="board.tile.first" action={() => onPressTile(tag, orderedTiles, 0)}>{firstTile}</TourTarget>
        ) : firstTile}
        {othersTiles.map((tile, i) => {
          const board = (
            <BoardTile
              tile={tile}
              delay={sectionDelay + (i + 1) * STAGGER_TILE}
              likeCount={likeCounts[tile.mealId] || 0}
              commentCount={commentCounts[tile.mealId] || 0}
              isLeader={leaderMealIds.includes(tile.mealId)}
              onPress={() => onPressTile(tag, orderedTiles, mineTile ? i + 1 : i)}
            />
          );
          return !mineTile && isFirstTileTarget && i === 0 ? (
            <TourTarget key={tile.mealId} id="board.tile.first" action={() => onPressTile(tag, orderedTiles, 0)}>
              {board}
            </TourTarget>
          ) : (
            <View key={tile.mealId} collapsable={false}>{board}</View>
          );
        })}
      </ScrollView>

      {/* Anchored to the section itself, not the tile row — the row scrolls
          horizontally and would clip a tooltip wider than a single tile. */}
      {showYouTooltip && (
        <FirstVisitTooltip
          message="Tap here to log this meal"
          onDismiss={onDismissYouTooltip}
          style={styles.youTooltip}
        />
      )}

      {duelUnlocked && (
        isFirstDuelTarget ? (
          <TourTarget id="board.duelcard.first" action={onPressDuel}>
            <DuelCard
              tag={tag}
              voted={duelVoted}
              delay={sectionDelay + (othersTiles.length + 1) * STAGGER_TILE}
              onPress={onPressDuel}
            />
          </TourTarget>
        ) : (
          <DuelCard
            tag={tag}
            voted={duelVoted}
            delay={sectionDelay + (othersTiles.length + 1) * STAGGER_TILE}
            onPress={onPressDuel}
          />
        )
      )}
      {showDuelTooltip && (
        <FirstVisitTooltip
          message="Vote for the best meal once this slot's window closes"
          onDismiss={onDismissDuelTooltip}
          style={styles.duelTooltip}
        />
      )}
    </View>
  );
}

// ─── Tier Duel card — a scheduled event, not an always-open vote. Only
// renders once the slot's window has closed (see isDuelUnlocked) and at
// least 2 people posted (a 1-photo "duel" isn't votable). Swaps to a result
// state once the viewer has voted, rather than disappearing — the duel
// stays checkable/changeable for the rest of the day. ──────────────────────
function DuelCard({ tag, voted, delay, onPress }) {
  const meta = TAG_META[tag];
  return (
    <FadeScaleIn delay={delay} style={styles.duelCardWrap}>
      <PressableScale style={styles.duelCard} onPress={onPress} activeScale={0.97}>
        <View style={styles.duelVsBadge}>
          <Text style={styles.duelVsBadgeText}>VS</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.duelTitle}>{voted ? `${meta.label} Duel is live` : `${meta.label} Duel is ready`}</Text>
          <Text style={styles.duelSub}>
            {voted ? 'You voted · tap to see how it\'s going' : `Pick your favorite ${meta.label.toLowerCase()}`}
          </Text>
        </View>
        <Text style={styles.duelChevron}>›</Text>
      </PressableScale>
    </FadeScaleIn>
  );
}

// ─── Day Trail release card ────────────────────────────────────────────────
// Unlocks the moment the current user's own day has 2+ located meals — not
// gated on dinner specifically, and never for friends' days (isOwner is
// always true here: this card only ever shows the viewer's own trail).
// Absent entirely below that threshold, so it reads as something that just
// happened rather than a locked/placeholder slot to fill.
function DayTrailCard({ images, locatedImages, avgScore, totalDistance, delay, onPress, showTooltip, onDismissTooltip }) {
  return (
    <FadeScaleIn delay={delay} style={styles.trailCardWrap}>
      <View style={styles.trailUnlockBadge}>
        <Ionicons name="lock-open" size={11} color={C.orange} />
        <Text style={styles.trailUnlockText}>Day Trail unlocked</Text>
      </View>

      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <Text style={styles.trailHeadline}>Your day, mapped</Text>
      </TouchableOpacity>

      <View style={styles.trailMapWrap}>
        <DayTrail images={images} isOwner />
      </View>

      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.trailStatsRow}>
        <View style={styles.trailStat}>
          <Text style={styles.trailStatNum}>{formatScore(avgScore)}</Text>
          <Text style={styles.trailStatLabel}>avg score</Text>
        </View>
        <View style={styles.trailStatDivider} />
        <View style={styles.trailStat}>
          <Text style={styles.trailStatNum}>{formatDistance(totalDistance)}</Text>
          <Text style={styles.trailStatLabel}>traveled</Text>
        </View>
        <View style={styles.trailStatDivider} />
        <View style={styles.trailStat}>
          <Text style={styles.trailStatNum}>{locatedImages.length}</Text>
          <Text style={styles.trailStatLabel}>{locatedImages.length === 1 ? 'stop' : 'stops'}</Text>
        </View>
      </TouchableOpacity>

      {showTooltip && (
        <FirstVisitTooltip
          message="This map fills in as you eat around town — tap to see the full trail"
          onDismiss={onDismissTooltip}
          style={styles.trailTooltip}
        />
      )}
    </FadeScaleIn>
  );
}

export default function DayBoardScreen() {
  const navigation = useNavigation();
  const { startTour } = useTour();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [error, setError] = useState(null);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [streak, setStreak] = useState(0);
  const [loggedToday, setLoggedToday] = useState(false);
  const [likeCounts, setLikeCounts] = useState({});    // mealId -> count
  const [commentCounts, setCommentCounts] = useState({}); // mealId -> count
  const [voteCounts, setVoteCounts] = useState({});    // mealId -> Tier Duel vote count
  const [myVoteMealIdByTag, setMyVoteMealIdByTag] = useState({}); // tag -> mealId the viewer voted for today, or undefined
  const [skippedTags, setSkippedTags] = useState(new Set()); // tags the viewer has marked skipped today — private, never sent to friends
  const [youActionTag, setYouActionTag] = useState(null); // tag whose log/skip action sheet is open, or null

  // Compose / meal picker — ported verbatim from FeedScreen.jsx
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMeals, setPickerMeals]     = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [shareTarget, setShareTarget]     = useState(null); // meal to share

  // First-visit teaching tooltips — each fires once, ever, on whichever
  // section first qualifies (see firstEmptyYouTag/firstDuelTag below), not
  // on every section that matches.
  const [youTileTooltipVisible, dismissYouTileTooltip] = useFirstVisit('@fw_tt_youtile');
  const [duelTooltipVisible, dismissDuelTooltip] = useFirstVisit('@fw_tt_duelcard');
  const [trailTooltipVisible, dismissTrailTooltip] = useFirstVisit('@fw_tt_daytrail');

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
      const todayKey = localDateKey(now);

      // RLS (see_own_and_friends_posts) already scopes this to the caller's
      // own posts plus accepted friends' — no extra filtering needed here.
      const [{ data, error: err }, pendingResult, streakResult, skipTodayResult, skipDayKeysResult] = await Promise.all([
        supabase
          .from('posts')
          .select(`
            id, user_id, created_at,
            breakfast:meals!breakfast_meal_id(id, name, photo_url, emoji, score, place_id, created_at, places(lat, lng, name)),
            lunch:meals!lunch_meal_id(id, name, photo_url, emoji, score, place_id, created_at, places(lat, lng, name)),
            dinner:meals!dinner_meal_id(id, name, photo_url, emoji, score, place_id, created_at, places(lat, lng, name)),
            profiles!posts_user_id_fkey(id, username, first_name, last_name, display_name, avatar_url)
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
        // Private — meal_skips has no friend-read policy, so this can only
        // ever return the viewer's own skips.
        supabase
          .from('meal_skips')
          .select('slot')
          .eq('user_id', user.id)
          .eq('day', todayKey),
        supabase
          .from('meal_skips')
          .select('day')
          .eq('user_id', user.id)
          .order('day', { ascending: false })
          .limit(500),
      ]);
      if (err) throw err;
      setPosts(data || []);
      setPendingRequests(pendingResult.count ?? 0);
      setSkippedTags(new Set((skipTodayResult.data || []).map(r => r.slot)));
      // A day resolved purely by skipping counts the same as a day with a
      // meal logged, so it's merged into the streak's date set here.
      const skipDayKeys = new Set((skipDayKeysResult.data || []).map(r => r.day));
      const { streak: s, loggedToday: lt } = computeStreak(streakResult.data, skipDayKeys);
      setStreak(s);
      setLoggedToday(lt);

      // Per-meal like/comment counts for today's tiles (migration 018 keyed
      // both tables to meal_id, not just post_id, so a like/comment on one
      // slot no longer shows up on every slot of the same post).
      const mealIds = (data || [])
        .flatMap(p => [p.breakfast?.id, p.lunch?.id, p.dinner?.id])
        .filter(Boolean);
      if (mealIds.length > 0) {
        const [{ data: likeRows }, { data: commentRows }, { data: voteRows }] = await Promise.all([
          supabase.from('post_likes').select('meal_id').in('meal_id', mealIds),
          supabase.from('post_comments').select('meal_id').in('meal_id', mealIds),
          // Scoped by slot+day (not meal_id) so this doubles as the source
          // for "did I already vote in this slot today" — friends_can_see_votes
          // (019) already limits what comes back to what the viewer may see.
          supabase.from('post_votes').select('voter_id, meal_id, slot').eq('day', todayKey),
        ]);
        const nextLikeCounts = {};
        for (const row of likeRows || []) nextLikeCounts[row.meal_id] = (nextLikeCounts[row.meal_id] || 0) + 1;
        setLikeCounts(nextLikeCounts);
        const nextCommentCounts = {};
        for (const row of commentRows || []) nextCommentCounts[row.meal_id] = (nextCommentCounts[row.meal_id] || 0) + 1;
        setCommentCounts(nextCommentCounts);
        const nextVoteCounts = {};
        const nextMyVoteByTag = {};
        for (const row of voteRows || []) {
          nextVoteCounts[row.meal_id] = (nextVoteCounts[row.meal_id] || 0) + 1;
          if (row.voter_id === user.id) nextMyVoteByTag[row.slot] = row.meal_id;
        }
        setVoteCounts(nextVoteCounts);
        setMyVoteMealIdByTag(nextMyVoteByTag);
      } else {
        setLikeCounts({});
        setCommentCounts({});
        setVoteCounts({});
        setMyVoteMealIdByTag({});
      }
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

  // Tier Duel crown — whichever meal(s) currently lead a slot's vote count.
  // Ties are all crowned rather than picking one arbitrarily. A slot with
  // zero votes has no leader at all (nothing to crown yet).
  const leaderMealIdsByTag = Object.fromEntries(
    MEAL_TAGS.map(tag => {
      const tiles = tilesByTag[tag];
      const max = Math.max(0, ...tiles.map(t => voteCounts[t.mealId] || 0));
      const leaders = max > 0 ? tiles.filter(t => (voteCounts[t.mealId] || 0) === max).map(t => t.mealId) : [];
      return [tag, leaders];
    })
  );

  // Tier Duel unlock — a scheduled event per slot, not always-open. Opens
  // once that slot's window has closed (same boundaries as LogMealScreen's
  // auto-guessed tag), and only if 2+ people posted in it — a lone photo
  // isn't votable.
  const todayKey = localDateKey(new Date());
  const duelUnlockedByTag = Object.fromEntries(
    MEAL_TAGS.map(tag => [tag, isDuelUnlocked(todayKey, tag) && tilesByTag[tag].length >= 2])
  );

  const friendsEatingCount = new Set(
    MEAL_TAGS.flatMap(tag => tilesByTag[tag])
      .filter(t => !t.isMine)
      .map(t => t.poster?.id)
      .filter(Boolean)
  ).size;

  const totalMealsToday = MEAL_TAGS.reduce((sum, tag) => sum + tilesByTag[tag].length, 0);

  // Which single section shows the "+ you" / duel tooltip — never more than
  // one at once, even though up to 3 sections could otherwise qualify.
  const firstEmptyYouTag = MEAL_TAGS.find(tag => !tilesByTag[tag].some(t => t.isMine) && !skippedTags.has(tag));
  const firstDuelTag = MEAL_TAGS.find(tag => duelUnlockedByTag[tag]);
  const firstTileTag = MEAL_TAGS.find(tag => tilesByTag[tag].length > 0);

  // Day Trail release card — only ever the viewer's own day (isOwner is
  // always true for this card), never a friend's. Unlocks at 2+ located
  // meals regardless of which slots they're in — not gated on dinner.
  const myImages = MEAL_TAGS
    .map(tag => {
      const mine = tilesByTag[tag].find(t => t.isMine);
      return mine ? { tag, meal: mine.meal } : null;
    })
    .filter(Boolean);
  const myLocatedImages = myImages.filter(
    ({ meal }) => meal.place_id && meal.places?.lat != null && meal.places?.lng != null
  );
  const trailUnlocked = myLocatedImages.length >= 2;
  const myAvgScore = myImages.length > 0
    ? myImages.reduce((sum, { meal }) => sum + (Number(meal.score) || 0), 0) / myImages.length
    : null;
  const myTotalDistance = myLocatedImages.slice(1).reduce((sum, { meal }, i) => {
    const prev = myLocatedImages[i].meal.places;
    return sum + haversineMiles(prev.lat, prev.lng, meal.places.lat, meal.places.lng);
  }, 0);

  function handleOpenMyTrail() {
    navigation.navigate('DayTrailDetail', {
      locations: myLocatedImages.map(({ tag, meal }) => ({
        tag,
        kind: 'mapped', // the owner always sees real coordinates, per lib/homePrivacy.js
        lat: meal.places.lat,
        lng: meal.places.lng,
        placeName: displayPlaceName(meal),
        mealName: meal.name,
        photoUrl: meal.photo_url ?? null,
        createdAt: meal.created_at ?? null,
      })),
    });
  }

  const dateLabel = now => now.toLocaleDateString([], { weekday: 'long' });

  function handlePressTile(tag, orderedTiles, index) {
    navigation.navigate('SlotViewer', { tag, people: orderedTiles, initialIndex: index });
  }

  // Opens the log/skip action sheet — the primary tap target on an empty
  // "+ you" tile now branches into a visible choice instead of jumping
  // straight to LogMeal.
  function handlePressYou(tag) {
    setYouActionTag(tag);
  }

  function handleDismissYouAction() {
    setYouActionTag(null);
  }

  function handleActionLogMeal() {
    const tag = youActionTag;
    setYouActionTag(null);
    navigation.navigate('LogMeal', { forceTag: tag });
  }

  async function handleActionSkip() {
    const tag = youActionTag;
    setYouActionTag(null);
    try {
      await skipMeal(currentUserId, todayKey, tag);
      setSkippedTags(prev => new Set(prev).add(tag));
    } catch {
      Alert.alert("Couldn't skip", 'Please try again.');
    }
  }

  // Un-skip and drop straight into logging — per spec, a skipped slot is
  // meant to be undoable by just tapping back into the normal log flow.
  async function handlePressSkipped(tag) {
    try {
      await unskipMeal(currentUserId, todayKey, tag);
      setSkippedTags(prev => {
        const next = new Set(prev);
        next.delete(tag);
        return next;
      });
    } catch {
      // Non-fatal — worst case the tile stays muted until next load.
    }
    navigation.navigate('LogMeal', { forceTag: tag });
  }

  function handlePressDuel(tag) {
    navigation.navigate('Duel', { tag, day: todayKey, people: tilesByTag[tag] });
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
        colors={['#161616', C.bg]}
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
          {/* pickerSheet has no fixed height (just a maxHeight cap) and is
              flex-end-aligned inside pickerOverlay, which spans the full
              edge-to-edge Modal window on Android — its bottom boundary
              always sits flush against the true screen edge, behind the nav
              bar, regardless of internal content padding. Needs a margin on
              the sheet itself so flex-end alignment actually respects it. */}
          <Pressable style={[styles.pickerSheet, { marginBottom: insets.bottom }]} onPress={() => {}}>
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
              // flexShrink: 1, not flex: 1 — pickerSheet has no fixed/
              // flex-resolved height (just a maxHeight cap, sized by its own
              // content), so a flex:1 child here has nothing concrete to
              // grow into and Yoga collapses it to zero height. flexShrink
              // lets this take its natural content size and only shrink
              // (enabling scroll) once the maxHeight cap constrains it.
              <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
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
                      <StripedPlaceholder style={styles.pickerThumb}>
                        <View style={styles.pickerThumbFallback}>
                          <Text style={{ fontSize: 22 }}>{meal.emoji || '🍽️'}</Text>
                        </View>
                      </StripedPlaceholder>
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
        onPosted={() => { setShareTarget(null); load(); }}
      />

      {/* ── Log/skip action sheet (from an empty "+ you" tile) ─────────────── */}
      <YouActionSheet
        visible={youActionTag !== null}
        tag={youActionTag}
        onDismiss={handleDismissYouAction}
        onLogMeal={handleActionLogMeal}
        onSkip={handleActionSkip}
      />

      <View style={styles.navBar}>
        <View style={styles.navBrand}>
          <Image source={require('../assets/logo-mark.png')} style={styles.navLogo} />
          <Image source={require('../assets/wordmark.png')} style={styles.navWordmark} />
        </View>
        <View style={styles.headerActions}>
          {/* Persistent way back into a live, interactive walkthrough — the
              one-shot tooltips are gone for good once seen/dismissed, so
              this is the only in-context help left once someone's burned
              through them. */}
          <TouchableOpacity style={styles.iconChip} onPress={startTour} hitSlop={8}>
            <Ionicons name="help-outline" size={16} color={C.white} />
          </TouchableOpacity>
          <TourTarget id="board.map" action={() => navigation.navigate('Map')}>
            <TouchableOpacity style={styles.iconChip} onPress={() => navigation.navigate('Map')} hitSlop={8}>
              <Ionicons name="map-outline" size={15} color={C.white} />
            </TouchableOpacity>
          </TourTarget>
          <TourTarget id="board.friends" action={handleAddFriends}>
            <TouchableOpacity style={styles.iconChip} onPress={handleAddFriends} hitSlop={8}>
              <Ionicons name="people-outline" size={16} color={C.white} />
              {pendingRequests > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {pendingRequests > 9 ? '9+' : pendingRequests}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </TourTarget>
          <TourTarget id="board.compose" action={handleCompose}>
            <TouchableOpacity onPress={handleCompose} hitSlop={8} activeOpacity={0.8}>
              <LinearGradient colors={[C.orange, C.orangeDim]} style={styles.composeChip}>
                <Ionicons name="add" size={18} color={C.bg} />
              </LinearGradient>
            </TouchableOpacity>
          </TourTarget>
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
              ? "Log a meal below, then add friends to fill this in"
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
              onPressSkipped={handlePressSkipped}
              isSkipped={skippedTags.has(tag)}
              onFire={streak > 0}
              likeCounts={likeCounts}
              commentCounts={commentCounts}
              leaderMealIds={leaderMealIdsByTag[tag]}
              duelUnlocked={duelUnlockedByTag[tag]}
              duelVoted={myVoteMealIdByTag[tag] != null}
              onPressDuel={() => handlePressDuel(tag)}
              showYouTooltip={youTileTooltipVisible && tag === firstEmptyYouTag}
              onDismissYouTooltip={dismissYouTileTooltip}
              showDuelTooltip={duelTooltipVisible && tag === firstDuelTag}
              onDismissDuelTooltip={dismissDuelTooltip}
              isFirstYouTarget={tag === firstEmptyYouTag}
              isFirstTileTarget={tag === firstTileTag}
              isFirstDuelTarget={tag === firstDuelTag}
            />
          ))}

          {trailUnlocked && (
            <TourTarget id="board.trailcard" action={handleOpenMyTrail}>
              <DayTrailCard
                images={myImages}
                locatedImages={myLocatedImages}
                avgScore={myAvgScore}
                totalDistance={myTotalDistance}
                delay={MEAL_TAGS.length * STAGGER_SECTION + 250}
                onPress={handleOpenMyTrail}
                showTooltip={trailTooltipVisible}
                onDismissTooltip={dismissTrailTooltip}
              />
            </TourTarget>
          )}

          

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

          <AdMobBanner />

          
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
  navBrand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navLogo: { width: 40, height: 40, resizeMode: 'contain' },
  // Explicit width+height, not aspectRatio — height-only + aspectRatio
  // rendered the image far larger than intended in this row layout, so
  // this has to be sized by hand to wordmark.png's actual aspect (494/250).
  navWordmark: { width: 79, height: 40, resizeMode: 'contain' },
  headerActions: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  iconChip: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(245,245,247,0.08)', borderWidth: 1, borderColor: 'rgba(245,245,247,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  composeChip: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
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
    width: 36, height: 4, borderRadius: 2, backgroundColor: C.glassBorder,
    alignSelf: 'center', marginTop: 12,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  pickerTitle: { fontFamily: C.serif, fontSize: 20, color: C.white },
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
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
  },
  pickerRowInfo: { flex: 1 },
  pickerRowName: { fontSize: 15, fontWeight: '600', color: C.white },
  pickerRowScore: { fontFamily: C.serif, fontSize: 20 },

  // Log/skip action sheet from an empty "+ you" tile — same overlay/sheet
  // shape as the meal picker, just short (two rows + cancel) instead of a
  // scrollable list, so it doesn't need a maxHeight cap of its own.
  actionSheetOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
  },
  actionSheetSheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 24,
  },
  actionSheetTitle: {
    fontFamily: C.serif, fontSize: 18, color: C.white,
    textAlign: 'center', marginTop: 14, marginBottom: 6,
  },
  actionSheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 24, paddingVertical: 16,
  },
  actionSheetRowText: { fontSize: 16, fontWeight: '600', color: C.white },
  actionSheetCancelRow: {
    marginTop: 4, paddingVertical: 14, alignItems: 'center',
  },
  actionSheetCancelText: { fontSize: 15, color: C.gray1, fontWeight: '500' },

  dateHeader: {
    fontFamily: C.serif, fontSize: 40, color: C.white,
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

  // Tooltip bubble sits above its target with the arrow pointing down —
  // anchored on the section (not the scrolling tile row) so it never clips.
  youTooltip: { top: 24, left: 16 },
  // Duel card is the last element in the section (rendered after the tile
  // row), so this is bottom-anchored to sit just above it regardless of how
  // tall the tile row ends up.
  duelTooltip: { bottom: 70, left: 16 },
  trailTooltip: { top: -66, alignSelf: 'center' },

  // Tier Duel card — a scheduled-event prompt, not a persistent stat, so it
  // gets a warm gold accent (matches the trophy/crown) rather than the
  // neutral surface used by the footer stat card.
  duelCardWrap: { marginHorizontal: 20, marginTop: 12 },
  duelCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(251,114,56,0.1)', borderWidth: 1, borderColor: 'rgba(251,114,56,0.3)',
    borderRadius: 18, padding: 14,
  },
  duelVsBadge: {
    width: 34, height: 34, borderRadius: C.pill,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
  },
  duelVsBadgeText: { fontFamily: C.serifItalic, fontSize: 13, color: C.bg },
  duelChevron: { fontSize: 16, color: C.orange },
  duelTitle: { fontSize: 14, fontWeight: '700', color: C.white },
  duelSub: { fontSize: 12, color: C.gray1, marginTop: 1 },

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
  tileLeader: {
    borderWidth: 2, borderColor: C.gold,
    shadowColor: C.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  tileFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  tileFallbackEmoji: { fontSize: 36 },
  tileUsername: {
    fontSize: 12, fontWeight: '700', color: '#fff',
    paddingHorizontal: 8, paddingBottom: 8,
  },

  // Small per-meal like/comment indicator, top-right corner — informational
  // only (liking happens in SlotViewerScreen); only shown once there's
  // something to show.
  tileEngageBadge: {
    position: 'absolute', top: 6, right: 6,
    flexDirection: 'row', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 3,
  },
  tileEngageItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tileEngageText: { fontSize: 9, fontWeight: '700', color: '#fff' },

  // Tier Duel crown — top-left, opposite the like/comment badge, marking
  // the meal currently leading its slot's vote count.
  tileCrownBadge: {
    position: 'absolute', top: 6, left: 6, zIndex: 1,
    backgroundColor: C.gold, borderRadius: C.pill,
    width: 22, height: 22, alignItems: 'center', justifyContent: 'center',
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

  // Muted "skipped" state — no shadow/glow at all (unlike the "+ you" tile),
  // so it visually reads as dormant/resolved rather than an active prompt.
  skippedTileShadowWrap: { borderRadius: 18 },
  skippedTile: {
    width: TILE_SIZE, height: TILE_SIZE, borderRadius: 18,
    borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  skippedTileLabel: { fontSize: 12, fontWeight: '600', color: C.gray1 },

  // Pulsing ring on your own tile while you're on a streak
  fireRing: {
    position: 'absolute', top: -4, left: -4, right: -4, bottom: -4,
    borderRadius: 22, borderWidth: 2, borderColor: C.orange,
  },

  // Day Trail release card — deliberately louder than the footer stat card
  // (orange-tinted border/glow) so it reads as something that just
  // unlocked, not another routine section.
  trailCardWrap: {
    marginHorizontal: 20, marginTop: Math.round(SECTION_GAP * 0.6),
    backgroundColor: C.glassBg, borderWidth: 1, borderColor: C.orange + '55',
    borderRadius: 22, padding: 16,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 14, elevation: 4,
  },
  trailUnlockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: C.orange + '22', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8,
  },
  trailUnlockText: {
    fontSize: 10, fontWeight: '800', color: C.orange,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  trailHeadline: {
    fontSize: 18, fontWeight: '800', color: C.white, letterSpacing: -0.3,
    marginBottom: 12,
  },
  trailMapWrap: { marginBottom: 14 },
  trailStatsRow: { flexDirection: 'row', alignItems: 'center' },
  trailStat: { flex: 1, alignItems: 'center' },
  trailStatNum: { fontFamily: C.serif, fontSize: 22, color: C.white },
  trailStatLabel: { fontSize: 11, color: C.gray2, fontWeight: '500', marginTop: 2 },
  trailStatDivider: { width: 0.5, height: 28, backgroundColor: C.border },

  // Footer — closes out the page instead of just trailing off into empty
  // space below the three sections.
  footerCard: {
    marginHorizontal: 20, marginTop: Math.round(SECTION_GAP * 0.4),
    backgroundColor: C.glassBg, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 22, padding: 16,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerFlame: { fontSize: 20, marginRight: 8 },
  footerStreakNum: { fontFamily: C.serif, fontSize: 26, color: C.orange, marginRight: 6 },
  footerStreakLabel: { fontSize: 13, color: C.gray1, flex: 1 },
  footerDivider: { height: 0.5, backgroundColor: C.border, marginVertical: 12 },
  footerStat: { fontSize: 13, color: C.gray2, fontWeight: '500' },
});
