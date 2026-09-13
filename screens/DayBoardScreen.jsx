import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Modal, Pressable, Dimensions, Animated, Alert, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import ShareBottomSheet from '../components/ShareBottomSheet';
import DayTrail from '../components/DayTrail';
import AdMobBanner from '../components/AdMobBanner';
import { fetchPostedMealIds, MEAL_TAGS, TAG_META } from '../lib/postUtils';
import { skipMeal, unskipMeal } from '../lib/skips';
import { localDateKey } from '../lib/dateKey';
import { displayPlaceName } from '../lib/homePrivacy';
import { isDuelUnlocked } from '../lib/postVotes';
import { useFirstVisit, FirstVisitTooltip } from '../lib/firstVisit';
import { useTour, TourTarget } from '../lib/tourContext';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from '../components/StripedPlaceholder';
import { useAppForeground } from '../lib/useAppForeground';

// Returns true in the last 3 days of the month — show Recaps banner then
function isMonthEnd() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() >= lastDay - 2;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Sized off the actual viewport, not fixed pixels, so this holds across
// device sizes (this screen used to be a ~380px-wide card design; it's now
// a full screen and needs to fill it, not cluster three cramped rows at the
// top). Tile size scales off width (it's a horizontal photo tray — width is
// what determines how many tiles peek per row); capped so it doesn't balloon
// on tablets. Section gap scales off height, giving more breathing room on
// taller screens instead of a fixed gap that reads as cramped everywhere.
const TILE_WIDTH = Math.min(Math.round(SCREEN_WIDTH * 0.31), 126);
const TILE_HEIGHT = Math.round(TILE_WIDTH * 1.25);
const SECTION_GAP = Math.round(SCREEN_HEIGHT * 0.045);
const TILE_GAP = Math.round(TILE_WIDTH * 0.12);
const BOARD_GUTTER = SCREEN_WIDTH < 380 ? 16 : 20;
const DATE_HEADER_SIZE = SCREEN_WIDTH < 380 ? 34 : 40;

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

function getFoodVibeTier(score) {
  const n = typeof score === 'number' ? score : Number(score);
  if (isNaN(n) || n === 0) return { label: 'SHARED TODAY 🍽️', color: C.white, bg: 'rgba(255, 255, 255, 0.15)', border: 'rgba(255, 255, 255, 0.25)' };
  if (n >= 9.0) return { label: 'GOD TIER 👑', color: C.gold, bg: 'rgba(255, 215, 0, 0.22)', border: '#ffd700' };
  if (n >= 8.0) return { label: 'MUST EAT 🔥', color: '#ff6b00', bg: 'rgba(255, 107, 0, 0.22)', border: '#ff6b00' };
  if (n >= 6.5) return { label: 'SOLID BANGER 👍', color: C.green, bg: 'rgba(48, 209, 88, 0.22)', border: '#30d158' };
  if (n >= 5.0) return { label: 'DECENT EATS 🍽️', color: C.gray2, bg: 'rgba(255, 255, 255, 0.15)', border: C.gray3 };
  return { label: 'MID / SKIP 😅', color: '#e5484d', bg: 'rgba(229, 72, 77, 0.22)', border: '#e5484d' };
}

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  return diffMs < 5 * 60 * 1000;
}

function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return 'Offline';
  const diffMin = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
  if (diffMin < 5) return 'Active now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return 'Offline';
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dateLabel(d) {
  const dateObj = d instanceof Date ? d : new Date(d);
  return `${MONTHS_SHORT[dateObj.getMonth()]} ${dateObj.getDate()}`;
}

function getRelativeDateLabel(offset, targetDate) {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  return `${DAYS_FULL[targetDate.getDay()]}, ${MONTHS_SHORT[targetDate.getMonth()]} ${targetDate.getDate()}`;
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
              <Ionicons name="restaurant-outline" size={34} color={C.gray2} />
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
          <Ionicons name={tag === 'breakfast' ? 'sunny-outline' : tag === 'lunch' ? 'partly-sunny-outline' : 'moon-outline'} size={16} color={C.gray1} />
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

function initials(profile) {
  const source = profile?.display_name || profile?.username || '?';
  return source.slice(0, 2).toUpperCase();
}

function NudgeModal({ person, onDismiss }) {
  const [sent, setSent] = useState(false);
  if (!person) return null;

  const friendName = person.username || person.first_name || 'friend';

  const handleSend = () => {
    setSent(true);
    setTimeout(() => {
      onDismiss();
      setSent(false);
    }, 1400);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.nudgeOverlay} onPress={onDismiss}>
        <Pressable style={styles.nudgeCard} onPress={e => e.stopPropagation()}>
          <View style={styles.nudgeIconRing}>
            <Ionicons name={sent ? "checkmark-circle" : "notifications"} size={36} color={sent ? C.green : C.orange} />
          </View>

          {!sent ? (
            <>
              <Text style={styles.nudgeTitle}>Nudge @{friendName} 🔔</Text>
              <Text style={styles.nudgeSub}>
                @{friendName} hasn't logged a meal yet today. Send a quick reminder to post their food vibe!
              </Text>

              <View style={styles.nudgeActionRow}>
                <TouchableOpacity style={styles.nudgeCancelBtn} onPress={onDismiss}>
                  <Text style={styles.nudgeCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.nudgeSendBtn} onPress={handleSend}>
                  <Text style={styles.nudgeSendText}>Send Nudge 🚀</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={styles.nudgeTitle}>Nudge Sent! 🎉</Text>
              <Text style={styles.nudgeSub}>We notified @{friendName} to share their meal today.</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FriendStoryStrip({ people, currentUserId, hasOwnStory, onPress, onNudge }) {
  const activeCount = people.filter(p => p.hasPostedToday).length;
  return (
    <View style={styles.storySection}>
      <View style={styles.storyHeader}>
        <Text style={styles.storyTitle}>Friend circles today</Text>
        <Text style={styles.storyMeta}>{activeCount}/{people.length} posted</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRow}>
        <TouchableOpacity style={styles.storyItem} onPress={() => onPress({ id: currentUserId })} activeOpacity={0.8}>
          <View style={[styles.storyRing, styles.storyRingMine]}>
            <View style={styles.storyAvatarFallback}><Ionicons name={hasOwnStory ? 'person-outline' : 'add'} size={22} color={C.orange} /></View>
            <View style={styles.storyPlus}><Ionicons name="add" size={11} color={C.bg} /></View>
          </View>
          <Text style={styles.storyName} numberOfLines={1}>{hasOwnStory ? 'Your story' : 'Add meal'}</Text>
          <Text style={styles.storySubText} numberOfLines={1}>Today</Text>
        </TouchableOpacity>
        {people.map((person) => {
          const posted = person.hasPostedToday;
          const online = isOnline(person.last_seen_at);
          return (
            <TouchableOpacity
              key={person.id}
              style={styles.storyItem}
              onPress={() => (posted ? onPress(person) : onNudge(person))}
              activeOpacity={0.8}
            >
              <View style={[styles.storyRing, posted ? styles.storyRingActive : styles.storyRingInactive]}>
                {person.avatar_url ? (
                  <Image source={{ uri: person.avatar_url }} style={styles.storyAvatar} />
                ) : (
                  <View style={styles.storyAvatarFallback}>
                    <Text style={styles.storyInitials}>{initials(person)}</Text>
                  </View>
                )}
                <View style={[styles.statusDotBadge, online ? styles.statusDotOnline : styles.statusDotOffline]} />
              </View>
              <Text style={styles.storyName} numberOfLines={1}>
                {person.username || person.first_name || 'friend'}
              </Text>
              <Text style={[styles.storySubText, online && { color: C.green }]} numberOfLines={1}>
                {online ? 'Active now' : formatLastSeen(person.last_seen_at)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function FloatingParticle({ particle, onComplete }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 1200,
      useNativeDriver: true,
    }).start(() => onComplete(particle.id));
  }, []);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -180],
  });
  const opacity = anim.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [1, 0.8, 0],
  });
  const scale = anim.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.6, 1.3, 1],
  });

  return (
    <Animated.Text
      style={[
        styles.floatingParticle,
        {
          left: particle.x,
          transform: [{ translateY }, { scale }],
          opacity,
        },
      ]}
    >
      {particle.emoji}
    </Animated.Text>
  );
}

function FriendStoryViewer({ sequence, onClose, currentUserId }) {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(sequence?.initialIndex || 0);
  const [isPaused, setIsPaused] = useState(false);
  const [particles, setParticles] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [loadingReactions, setLoadingReactions] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pressStartTime = useRef(0);

  const items = sequence?.items || sequence?.people || [];
  const activeItem = items[currentIndex];

  const resetAndStartTimer = useCallback(() => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 5000,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        if (currentIndex < items.length - 1) {
          setCurrentIndex(prev => prev + 1);
        } else {
          onClose();
        }
      }
    });
  }, [currentIndex, items.length, onClose, progressAnim]);

  useEffect(() => {
    if (!sequence || items.length === 0) return;
    if (!isPaused) {
      resetAndStartTimer();
    } else {
      progressAnim.stopAnimation();
    }
    return () => progressAnim.stopAnimation();
  }, [currentIndex, isPaused, sequence, items.length, resetAndStartTimer]);

  const meal = activeItem?.meal || {};
  const poster = activeItem?.poster || {};
  const tag = activeItem?.tag || 'snack';
  const isMine = activeItem?.isMine || poster.id === currentUserId;

  // Fetch reactions when creator views their own story & trigger opening emoji burst!
  useEffect(() => {
    if (!isMine || !meal?.id) return;
    let mounted = true;
    setLoadingReactions(true);

    const fetchReactions = async () => {
      try {
        let { data, error } = await supabase
          .from('post_likes')
          .select('user_id, emoji, created_at, profiles(id, username, avatar_url, first_name)')
          .eq('meal_id', meal.id);

        if (error && error.message?.includes('emoji')) {
          const fallback = await supabase
            .from('post_likes')
            .select('user_id, created_at, profiles(id, username, avatar_url, first_name)')
            .eq('meal_id', meal.id);
          data = (fallback.data || []).map(r => ({ ...r, emoji: '🔥' }));
        }

        if (mounted && data) {
          setReactions(data);
          data.forEach((r, idx) => {
            setTimeout(() => {
              if (mounted) {
                const burstX = Math.random() * (viewportWidth - 80) + 40;
                triggerParticle(r.emoji || '🔥', burstX);
              }
            }, idx * 220);
          });
        }
      } catch (e) {
        // Silent fallback
      } finally {
        if (mounted) setLoadingReactions(false);
      }
    };

    fetchReactions();
    return () => { mounted = false; };
  }, [isMine, meal?.id, viewportWidth]);

  if (!sequence || !activeItem) return null;

  const tagMeta = TAG_META[tag] || { emoji: '🍽️', label: tag };
  const vibe = getFoodVibeTier(meal.score);

  const handleNext = () => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    } else {
      setCurrentIndex(0);
    }
  };

  const handlePressIn = () => {
    pressStartTime.current = Date.now();
    setIsPaused(true);
  };

  const handlePressOut = (e) => {
    const duration = Date.now() - pressStartTime.current;
    setIsPaused(false);
    if (duration < 250) {
      const touchX = e.nativeEvent.pageX;
      if (touchX < viewportWidth * 0.35) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  };

  const triggerParticle = (emoji, xPos) => {
    const newParticle = {
      id: `${Date.now()}-${Math.random()}`,
      emoji,
      x: xPos || viewportWidth / 2 - 15,
    };
    setParticles(prev => [...prev.slice(-10), newParticle]);
  };

  const triggerReaction = async (emoji, xPos) => {
    triggerParticle(emoji, xPos);

    if (currentUserId && activeItem?.postId && meal?.id) {
      try {
        const { error } = await supabase.from('post_likes').upsert({
          post_id: activeItem.postId,
          meal_id: meal.id,
          user_id: currentUserId,
          emoji,
        });
        if (error && error.message?.includes('emoji')) {
          await supabase.from('post_likes').upsert({
            post_id: activeItem.postId,
            meal_id: meal.id,
            user_id: currentUserId,
          });
        }
      } catch (e) {
        // Silent catch for smooth UX
      }
    }
  };

  const removeParticle = (id) => {
    setParticles(prev => prev.filter(p => p.id !== id));
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.friendStoryBackdrop}>
        <View style={{ width: viewportWidth, height: viewportHeight, position: 'relative' }}>
          {meal.photo_url ? (
            <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <StripedPlaceholder style={StyleSheet.absoluteFill}>
              <View style={styles.friendStoryFallback}>
                <Ionicons name="restaurant-outline" size={72} color={C.gray2} />
              </View>
            </StripedPlaceholder>
          )}

          <LinearGradient
            colors={['rgba(0,0,0,0.7)', 'transparent', 'rgba(0,0,0,0.85)']}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* Left tap zone for previous slide */}
          <Pressable
            style={{ position: 'absolute', top: 70, left: 0, width: '35%', bottom: 180, zIndex: 5 }}
            onPress={handlePrev}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
          />

          {/* Right tap zone for next slide */}
          <Pressable
            style={{ position: 'absolute', top: 70, right: 0, width: '65%', bottom: 180, zIndex: 5 }}
            onPress={handleNext}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
          />

          {particles.map(p => (
            <FloatingParticle key={p.id} particle={p} onComplete={removeParticle} />
          ))}

          {!isPaused && (
            <>
              <View style={styles.friendStoryProgressRow}>
                {items.map((_, i) => {
                  let flexWidth = progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  });
                  return (
                    <View key={i} style={styles.friendStoryProgressTrack}>
                      {i < currentIndex && <View style={[styles.friendStoryProgressFill, { width: '100%' }]} />}
                      {i === currentIndex && (
                        <Animated.View style={[styles.friendStoryProgressFill, { width: flexWidth }]} />
                      )}
                      {i > currentIndex && <View style={[styles.friendStoryProgressFill, { width: '0%' }]} />}
                    </View>
                  );
                })}
              </View>

              <View style={[styles.friendStoryHeader, { zIndex: 20 }]}>
                <View style={styles.friendStoryAvatar}>
                  {poster.avatar_url ? (
                    <Image source={{ uri: poster.avatar_url }} style={styles.friendStoryAvatarImg} />
                  ) : (
                    <Text style={styles.friendStoryAvatarText}>{initials(poster)}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.friendStoryHandle}>@{poster.username || 'friend'}</Text>
                  <Text style={styles.friendStoryTagLabel}>
                    {isOnline(poster.last_seen_at) ? '🟢 Active now' : `⚪ ${formatLastSeen(poster.last_seen_at)}`} • {tagMeta.emoji} {tagMeta.label}
                  </Text>
                </View>
                <Text style={styles.friendStoryCount}>{currentIndex + 1}/{items.length}</Text>
                <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.friendStoryCloseBtn}>
                  <Ionicons name="close" size={22} color={C.white} />
                </TouchableOpacity>
              </View>

              <View style={[styles.friendStoryCaption, { zIndex: 20 }]}>
                <View style={[styles.friendStoryVibeBadge, { backgroundColor: vibe.bg, borderColor: vibe.border }]}>
                  <Text style={[styles.friendStoryVibeText, { color: vibe.color }]}>{vibe.label}</Text>
                  <Text style={styles.friendStoryScoreText}>{formatScore(meal.score)} ★</Text>
                </View>

                <Text style={styles.friendStoryMeal}>{meal.name || 'Unnamed Dish'}</Text>
                {meal.places?.name && (
                  <View style={styles.friendStoryVenueRow}>
                    <Ionicons name="location-sharp" size={14} color={C.orange} />
                    <Text style={styles.friendStoryVenueText} numberOfLines={1}>{meal.places.name}</Text>
                  </View>
                )}

                {isMine ? (
                  <View style={styles.friendStoryCreatorTray}>
                    <View style={styles.friendStoryCreatorTrayHeader}>
                      <Ionicons name="eye-outline" size={16} color={C.white} />
                      <Text style={styles.friendStoryCreatorTrayTitle}>
                        {reactions.length > 0 ? `${reactions.length} Friend${reactions.length > 1 ? 's' : ''} Reacted` : 'Story Activity'}
                      </Text>
                    </View>

                    {reactions.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.friendStoryReactorsRow}>
                        {reactions.map((r, i) => (
                          <View key={i} style={styles.friendStoryReactorPill}>
                            <View style={styles.friendStoryReactorAvatar}>
                              {r.profiles?.avatar_url ? (
                                <Image source={{ uri: r.profiles.avatar_url }} style={styles.friendStoryAvatarImg} />
                              ) : (
                                <Text style={styles.friendStoryReactorInitials}>{initials(r.profiles || {})}</Text>
                              )}
                              <View style={styles.friendStoryReactorBadge}>
                                <Text style={{ fontSize: 10 }}>{r.emoji || '🔥'}</Text>
                              </View>
                            </View>
                            <Text style={styles.friendStoryReactorName} numberOfLines={1}>
                              @{r.profiles?.username || 'friend'}
                            </Text>
                          </View>
                        ))}
                      </ScrollView>
                    ) : (
                      <Text style={styles.friendStoryNoReactionsText}>
                        {loadingReactions ? 'Loading activity...' : 'No reactions yet today • Shared with friends'}
                      </Text>
                    )}
                  </View>
                ) : (
                  <View style={styles.friendStoryReactionsRow}>
                    {['🔥', '🤤', '🧑‍🍳', '👑', '💸'].map((emoji) => (
                      <TouchableOpacity
                        key={emoji}
                        activeOpacity={0.7}
                        style={styles.friendStoryReactionBtn}
                        onPress={(e) => triggerReaction(emoji, e.nativeEvent.pageX)}
                      >
                        <Text style={{ fontSize: 22 }}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}

          {isPaused && (
            <View style={styles.friendStoryPausedBadge}>
              <Ionicons name="pause" size={14} color={C.white} />
              <Text style={styles.friendStoryPausedText}>PAUSED</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Add this near your other card components (DuelCard, DayTrailCard)


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
  const [dayOffset, setDayOffset] = useState(0);
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
  const [storySequence, setStorySequence] = useState(null);
  const [allFriends, setAllFriends]       = useState([]);
  const [nudgePerson, setNudgePerson]     = useState(null);

  // First-visit teaching tooltips — each fires once, ever, on whichever
  // section first qualifies (see firstEmptyYouTag/firstDuelTag below), not
  // on every section that matches.
  const [youTileTooltipVisible, dismissYouTileTooltip] = useFirstVisit('@fw_tt_youtile');
  const [duelTooltipVisible, dismissDuelTooltip] = useFirstVisit('@fw_tt_duelcard');
  const [trailTooltipVisible, dismissTrailTooltip] = useFirstVisit('@fw_tt_daytrail');

  const load = useCallback(async (offset = dayOffset) => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCurrentUserId(null);
        setPosts([]);
        setPendingRequests(0);
        setSkippedTags(new Set());
        setLikeCounts({});
        setCommentCounts({});
        setVoteCounts({});
        setMyVoteMealIdByTag({});
        setLoading(false);
        return;
      }
      setCurrentUserId(user.id);
      supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {}).catch(() => {});

      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + offset);
      const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).toISOString();
      const dayEnd   = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1).toISOString();
      const activeDayKey = localDateKey(targetDate);

      // Fetch accepted friends list safely
      try {
        const { data: rels } = await supabase
          .from('friendships')
          .select(`
            requester_id, addressee_id,
            requester:profiles!friendships_requester_id_fkey(id, username, first_name, display_name, avatar_url, last_seen_at),
            addressee:profiles!friendships_addressee_id_fkey(id, username, first_name, display_name, avatar_url, last_seen_at)
          `)
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq('status', 'accepted');
        const fList = (rels || []).map(r => (r.requester_id === user.id ? r.addressee : r.requester)).filter(Boolean);
        setAllFriends(fList);
      } catch (e) {
        setAllFriends([]);
      }

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
          .eq('day', activeDayKey),
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
          supabase.from('post_votes').select('voter_id, meal_id, slot').eq('day', activeDayKey),
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
      setError(e.message || "Failed to load board.");
    } finally {
      setLoading(false);
    }
  }, [dayOffset]);

  useFocusEffect(useCallback(() => {
    load();

    // Beat every 60 s: update own last_seen_at + refresh friends' statuses
    const heartbeat = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Update own presence
      supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {}).catch(() => {});
      // Re-fetch friends' last_seen_at only (cheap — no posts reload)
      try {
        const { data: rels } = await supabase
          .from('friendships')
          .select(`
            requester_id, addressee_id,
            requester:profiles!friendships_requester_id_fkey(id, username, first_name, display_name, avatar_url, last_seen_at),
            addressee:profiles!friendships_addressee_id_fkey(id, username, first_name, display_name, avatar_url, last_seen_at)
          `)
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq('status', 'accepted');
        const fList = (rels || []).map(r => (r.requester_id === user.id ? r.addressee : r.requester)).filter(Boolean);
        setAllFriends(fList);
      } catch (_) {}
    };

    const interval = setInterval(heartbeat, 60_000);
    return () => clearInterval(interval);
  }, [load]));
  useAppForeground(load);

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
    MEAL_TAGS.map(tag => [tag, isDuelUnlocked(todayKey, tag) && tilesByTag[tag].filter(tile => !tile.isMine).length >= 2])
  );

  const friendsEatingCount = new Set(
    MEAL_TAGS.flatMap(tag => tilesByTag[tag])
      .filter(t => !t.isMine)
      .map(t => t.poster?.id)
      .filter(Boolean)
  ).size;

  const totalMealsToday = MEAL_TAGS.reduce((sum, tag) => sum + tilesByTag[tag].length, 0);

  const postersMap = Object.fromEntries(
    MEAL_TAGS.flatMap(tag => tilesByTag[tag]).map(tile => [tile.poster?.id, tile.poster]).filter(([id, profile]) => id && profile && id !== currentUserId)
  );

  const tilesByFriendId = {};
  MEAL_TAGS.flatMap(tag => tilesByTag[tag]).forEach(tile => {
    if (tile.poster?.id) {
      if (!tilesByFriendId[tile.poster.id]) tilesByFriendId[tile.poster.id] = [];
      tilesByFriendId[tile.poster.id].push(tile);
    }
  });

  const mergedFriendsMap = {};
  for (const f of allFriends || []) {
    if (f.id && f.id !== currentUserId) mergedFriendsMap[f.id] = f;
  }
  for (const [id, p] of Object.entries(postersMap)) {
    mergedFriendsMap[id] = { ...(mergedFriendsMap[id] || {}), ...p };
  }

  const storyPeople = Object.values(mergedFriendsMap).map(person => ({
    ...person,
    hasPostedToday: Boolean(tilesByFriendId[person.id]?.length > 0),
  }));
  const hasOwnStory = MEAL_TAGS.some(tag => tilesByTag[tag].some(tile => tile.isMine));

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

  function handlePressStoryPerson(person) {
    if (person?.id === currentUserId && !hasOwnStory) {
      navigation.navigate('LogMeal');
      return;
    }
    const allTiles = MEAL_TAGS.flatMap(tag => tilesByTag[tag]);
    const targetUserId = person?.id;
    const personTiles = allTiles.filter(t => (targetUserId === currentUserId ? t.isMine : t.poster?.id === targetUserId));

    if (personTiles.length === 0) {
      if (person?.id === currentUserId) navigation.navigate('LogMeal');
      return;
    }

    setStorySequence({
      items: personTiles,
      initialIndex: 0,
    });
  }

  function handleNudgeFriend(person) {
    setNudgePerson(person);
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
                <Ionicons name="restaurant-outline" size={40} color={C.gray2} />
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
                          <Ionicons name="restaurant-outline" size={22} color={C.gray2} />
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

      <NudgeModal person={nudgePerson} onDismiss={() => setNudgePerson(null)} />
      <FriendStoryViewer sequence={storySequence} onClose={() => setStorySequence(null)} currentUserId={currentUserId} />

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
          {/* ── Date Navigation Row with Arrows ── */}
          <View style={styles.dateNavRow}>
            <TouchableOpacity
              style={styles.dateNavArrow}
              onPress={() => {
                const nextOffset = dayOffset - 1;
                setDayOffset(nextOffset);
                load(nextOffset);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={20} color={C.white} />
            </TouchableOpacity>

            <View style={styles.dateNavCenter}>
              <Text style={styles.dateHeader}>
                {dateLabel(new Date(Date.now() + dayOffset * 86400000))}
              </Text>
              <Text style={styles.dateSubHeader}>
                {getRelativeDateLabel(dayOffset, new Date(Date.now() + dayOffset * 86400000))}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.dateNavArrow, dayOffset >= 0 && styles.dateNavArrowDisabled]}
              disabled={dayOffset >= 0}
              onPress={() => {
                if (dayOffset < 0) {
                  const nextOffset = dayOffset + 1;
                  setDayOffset(nextOffset);
                  load(nextOffset);
                }
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={20} color={dayOffset >= 0 ? '#444444' : C.white} />
            </TouchableOpacity>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.liveDot, dayOffset !== 0 && { backgroundColor: C.gray2 }]} />
            <Text style={styles.friendCount}>
            {friendsEatingCount === 0
              ? "Log a meal below, then add friends to fill this in"
              : `${friendsEatingCount} friend${friendsEatingCount === 1 ? '' : 's'} eating`}
            </Text>
            {dayOffset !== 0 ? (
              <TouchableOpacity
                style={styles.todayPillActive}
                onPress={() => {
                  setDayOffset(0);
                  load(0);
                }}
                activeOpacity={0.75}
              >
                <Ionicons name="today-outline" size={12} color={C.bg} style={{ marginRight: 3 }} />
                <Text style={styles.todayPillTextActive}>Today</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.todayPill}>
                <Text style={styles.todayPillText}>Today</Text>
              </View>
            )}
          </View>

          {storyPeople.length > 0 && (
            <FriendStoryStrip
              people={storyPeople}
              currentUserId={currentUserId}
              hasOwnStory={hasOwnStory}
              onPress={handlePressStoryPerson}
              onNudge={handleNudgeFriend}
            />
          )}

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
              <Ionicons name="flame-outline" size={20} color={C.orange} style={styles.footerFlame} />
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

  friendStoryBackdrop: { flex: 1, backgroundColor: '#000000' },
  friendStoryFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18181b' },
  friendStoryProgressRow: { position: 'absolute', top: 16, left: 12, right: 12, flexDirection: 'row', gap: 4, zIndex: 10 },
  friendStoryProgressTrack: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden' },
  friendStoryProgressFill: { height: '100%', backgroundColor: C.white, borderRadius: 2 },
  friendStoryHeader: { position: 'absolute', top: 32, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 10 },
  friendStoryAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.orange, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  friendStoryAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  friendStoryAvatarText: { color: C.bg, fontSize: 13, fontWeight: '900' },
  friendStoryHandle: { color: C.white, fontSize: 14, fontWeight: '700' },
  friendStoryTagLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '600', marginTop: 1 },
  friendStoryCount: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', marginRight: 4 },
  friendStoryCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  friendStoryCaption: { position: 'absolute', left: 16, right: 16, bottom: 32, zIndex: 10 },
  friendStoryVibeBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, marginBottom: 10 },
  friendStoryVibeText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  friendStoryScoreText: { color: C.white, fontSize: 12, fontWeight: '800' },
  friendStoryMeal: { color: C.white, fontFamily: C.serif, fontSize: 32, lineHeight: 36, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  friendStoryVenueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  friendStoryVenueText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  friendStoryReactionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 25, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  friendStoryReactionBtn: { padding: 4 },
  friendStoryPausedBadge: { position: 'absolute', top: 80, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  friendStoryPausedText: { color: C.white, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  floatingParticle: { position: 'absolute', bottom: 100, fontSize: 36, zIndex: 20 },
  friendStoryCreatorTray: { marginTop: 14, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  friendStoryCreatorTrayHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  friendStoryCreatorTrayTitle: { color: C.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  friendStoryReactorsRow: { flexDirection: 'row', gap: 12 },
  friendStoryReactorPill: { alignItems: 'center', width: 56 },
  friendStoryReactorAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  friendStoryReactorInitials: { color: C.bg, fontSize: 11, fontWeight: '900' },
  friendStoryReactorBadge: { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.bg },
  friendStoryReactorName: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  friendStoryNoReactionsText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontStyle: 'italic' },

  dateNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: BOARD_GUTTER,
    marginTop: 8,
    marginBottom: 4,
  },
  dateNavCenter: {
    alignItems: 'center',
    flex: 1,
  },
  dateNavArrow: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNavArrowDisabled: {
    opacity: 0.35,
    backgroundColor: '#121214',
    borderColor: '#1e1e20',
  },
  dateHeader: {
    fontFamily: C.serif,
    fontSize: DATE_HEADER_SIZE,
    color: C.white,
    textAlign: 'center',
  },
  dateSubHeader: {
    color: C.gold,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: BOARD_GUTTER, marginTop: 6, marginBottom: 18, gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  friendCount: { flex: 1, fontSize: 13, color: C.gray2, fontWeight: '500' },
  todayPill: { borderWidth: 1, borderColor: '#27272a', backgroundColor: '#141416', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  todayPillText: { color: C.gray1, fontSize: 11, fontWeight: '700' },
  todayPillActive: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.orange, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  todayPillTextActive: { color: C.bg, fontSize: 11, fontWeight: '800' },
  storySection: { marginBottom: 24 },
  storyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: BOARD_GUTTER, marginBottom: 12 },
  storyTitle: { color: C.white, fontSize: 15, fontWeight: '700' },
  storyMeta: { color: C.gray3, fontSize: 12 },
  storyRow: { paddingHorizontal: BOARD_GUTTER, gap: 14 },
  storyItem: { width: 58, alignItems: 'center' },
  storyRing: { width: 54, height: 54, borderRadius: 27, padding: 2, backgroundColor: C.surface, marginBottom: 6 },
  storyRingActive: { backgroundColor: C.orange },
  storyRingInactive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  storyRingMine: { backgroundColor: C.orange },
  storyAvatar: { width: 50, height: 50, borderRadius: 25 },
  storyAvatarFallback: { flex: 1, borderRadius: 25, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  storyInitials: { color: C.white, fontSize: 14, fontWeight: '800' },
  storyPlus: { position: 'absolute', right: -1, bottom: -1, width: 18, height: 18, borderRadius: 9, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg },
  onlineDot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: C.green, borderWidth: 2, borderColor: C.bg },
  statusDotBadge: { position: 'absolute', right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: C.bg },
  statusDotOnline: { backgroundColor: C.green },
  statusDotOffline: { backgroundColor: C.gray2 },
  storySubText: { color: C.gray2, fontSize: 9, maxWidth: 62, textAlign: 'center', marginTop: 1 },

  nudgeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  nudgeCard: { width: '100%', maxWidth: 340, backgroundColor: C.surface, borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  nudgeIconRing: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(251,114,56,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  nudgeTitle: { color: C.white, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  nudgeSub: { color: C.gray1, fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  nudgeActionRow: { flexDirection: 'row', gap: 12, width: '100%' },
  nudgeCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: C.pill, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' },
  nudgeCancelText: { color: C.gray1, fontSize: 14, fontWeight: '700' },
  nudgeSendBtn: { flex: 1.5, paddingVertical: 14, borderRadius: C.pill, backgroundColor: C.orange, alignItems: 'center' },
  nudgeSendText: { color: C.bg, fontSize: 14, fontWeight: '800' },
  storyName: { color: C.gray1, fontSize: 10, maxWidth: 62, textAlign: 'center' },
  sectionEmoji: { fontSize: 16 },
  errorText: { fontSize: 13, color: '#ff6b6b', paddingHorizontal: BOARD_GUTTER, marginBottom: 12 },

  section: { marginBottom: SECTION_GAP },
  sectionDimmed: { opacity: 0.55 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: BOARD_GUTTER, marginBottom: 12,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.white },
  sectionCount: { fontSize: 13, color: C.gray2, fontWeight: '500' },

  tileRow: { paddingHorizontal: BOARD_GUTTER, gap: TILE_GAP },

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
  duelCardWrap: { marginHorizontal: BOARD_GUTTER, marginTop: 12 },
  duelCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(251,114,56,0.1)', borderWidth: 1, borderColor: 'rgba(251,114,56,0.3)',
    borderRadius: 8, padding: 14,
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
    borderRadius: 8,
  },
  tile: {
    width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: 8, overflow: 'hidden',
    backgroundColor: '#111', justifyContent: 'flex-end',
    borderWidth: 1, borderColor: C.border,
  },
  tileMine: { borderWidth: 2.5, borderColor: C.orange },
  tileLeader: {
    borderWidth: 2, borderColor: C.gold,
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
    borderRadius: 8,
  },
  youTile: {
    width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: 8,
    borderWidth: 1.5, borderColor: C.orange, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: 'rgba(255,107,61,0.06)',
  },
  youTileLabel: { fontSize: 13, fontWeight: '700', color: C.orange },

  // Muted "skipped" state — no shadow/glow at all (unlike the "+ you" tile),
  // so it visually reads as dormant/resolved rather than an active prompt.
  skippedTileShadowWrap: { borderRadius: 8 },
  skippedTile: {
    width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: 8,
    borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  skippedTileLabel: { fontSize: 12, fontWeight: '600', color: C.gray1 },

  // Pulsing ring on your own tile while you're on a streak
  fireRing: {
    position: 'absolute', top: -4, left: -4, right: -4, bottom: -4,
    borderRadius: 8, borderWidth: 2, borderColor: C.orange,
  },

  // Day Trail release card — deliberately louder than the footer stat card
  // (orange-tinted border/glow) so it reads as something that just
  // unlocked, not another routine section.
  trailCardWrap: {
    marginHorizontal: 20, marginTop: Math.round(SECTION_GAP * 0.6),
    backgroundColor: C.glassBg, borderWidth: 1, borderColor: C.orange,
    borderRadius: 8, padding: 16,
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
    borderRadius: 8, padding: 16,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerFlame: { fontSize: 20, marginRight: 8 },
  footerStreakNum: { fontFamily: C.serif, fontSize: 26, color: C.orange, marginRight: 6 },
  footerStreakLabel: { fontSize: 13, color: C.gray1, flex: 1 },
  footerDivider: { height: 0.5, backgroundColor: C.border, marginVertical: 12 },
  footerStat: { fontSize: 13, color: C.gray2, fontWeight: '500' },
});
