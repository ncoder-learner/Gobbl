import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  StatusBar,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  TouchableOpacity,
  LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import RAnimated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { FirstVisitTooltip, useFirstVisit } from '../lib/firstVisit';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from '../components/StripedPlaceholder';

const RANK_GRAY = '#8a8a8a';

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth();
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENT_MONTH_LABEL = MONTH_NAMES[CURRENT_MONTH];

function formatScore(score) {
  const n = typeof score === 'string' ? Number(score) : score;
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return (Math.round(n * 2) / 2).toFixed(1);
}

// ─── Distance (Near Me) ────────────────────────────────────────────────────────
// Straight-line distance, not persisted anywhere — recomputed on each load from
// the user's live device position and the meal's joined place lat/lng.
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function mealDistanceMi(meal, coords) {
  const lat = meal.places?.lat;
  const lng = meal.places?.lng;
  if (lat == null || lng == null || !coords) return null;
  return haversineMiles(coords.lat, coords.lng, lat, lng);
}

function formatDistance(mi) {
  if (mi == null) return null;
  if (mi < 0.1) return '<0.1 mi';
  return `${mi.toFixed(1)} mi`;
}

// ─── Meal tag (breakfast / lunch / dinner) ─────────────────────────────────────
const TAG_EMOJI = { breakfast: '🌅', lunch: '☀️', dinner: '🌙' };
function tagLabel(tag) {
  if (!tag || !TAG_EMOJI[tag]) return null;
  return `${TAG_EMOJI[tag]} ${tag[0].toUpperCase()}${tag.slice(1)}`;
}

// ─── Yearly list builder ──────────────────────────────────────────────────────
// Pinned items sit at their stored rank. Unpinned slots fill with the highest-
// scoring remaining year meals. Always returns at most 10 rows.
function buildYearlyList(allYearMeals, pinnedSlots) {
  const idToMeal = Object.fromEntries(allYearMeals.map(m => [m.id, m]));

  // Collect valid pinned entries (meal must still exist in current year's meals)
  const pinnedByRank = {};
  const pinnedIds = new Set();
  for (const [id, rank] of Object.entries(pinnedSlots)) {
    const r = Number(rank);
    if (idToMeal[id] && r >= 1 && r <= 10) {
      pinnedByRank[r] = idToMeal[id];
      pinnedIds.add(id);
    }
  }

  // Unpinned pool: all year meals not pinned, sorted by score desc
  const unpinned = allYearMeals.filter(m => !pinnedIds.has(m.id));

  const result = [];
  let ui = 0;
  for (let rank = 1; rank <= 10; rank++) {
    if (pinnedByRank[rank]) {
      result.push({ ...pinnedByRank[rank], _pinned: true });
    } else if (ui < unpinned.length) {
      result.push({ ...unpinned[ui++], _pinned: false });
    }
  }
  return result;
}

// ─── Drag handle ──────────────────────────────────────────────────────────────
function DragHandle({ panGesture }) {
  return (
    <GestureDetector gesture={panGesture}>
      <RAnimated.View style={styles.dragHandle}>
        <View style={styles.handleLine} />
        <View style={styles.handleLine} />
        <View style={styles.handleLine} />
      </RAnimated.View>
    </GestureDetector>
  );
}

// ─── Drag wrapper ─────────────────────────────────────────────────────────────
function DraggableRow({ mealId, draggedIdShared, dragTranslateY, onLayout, onDragStart, onDrop, style, children, dragEnabled = true }) {
  const panGesture = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      draggedIdShared.value = mealId;
      runOnJS(onDragStart)(mealId);
    })
    .onUpdate((e) => {
      if (draggedIdShared.value === mealId) dragTranslateY.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(onDrop)(mealId, e.translationY);
    })
    .onFinalize(() => {
      draggedIdShared.value = '';
      dragTranslateY.value = withSpring(0, { damping: 20, stiffness: 180 });
    });

  const animStyle = useAnimatedStyle(() => {
    const active = draggedIdShared.value === mealId;
    return {
      transform: [
        { translateY: active ? dragTranslateY.value : 0 },
        { scale: active ? 1.03 : 1 },
      ],
      zIndex: active ? 100 : 1,
      shadowColor: '#000',
      shadowOpacity: active ? 0.38 : 0,
      shadowRadius: active ? 22 : 0,
      shadowOffset: { width: 0, height: active ? 12 : 0 },
      elevation: active ? 12 : 0,
    };
  });

  return (
    <RAnimated.View style={[style, animStyle]} onLayout={onLayout}>
      {children}
      {dragEnabled && <DragHandle panGesture={panGesture} />}
    </RAnimated.View>
  );
}

// ─── AnimatedRow ──────────────────────────────────────────────────────────────
function AnimatedRow({ index, children, style, pressableStyle, isNew, onPress }) {
  const enter = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isNew) {
      Animated.sequence([
        Animated.delay(Math.max(index * 90 + 320, 650)),
        Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 18 }),
      ]).start();
    } else {
      Animated.timing(enter, {
        toValue: 1, duration: 420, delay: index * 90,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    }
  }, []);

  function onPressIn() {
    Animated.spring(pressScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
  }
  function onPressOut() {
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  }

  return (
    <Animated.View style={[style, {
      opacity: enter,
      transform: [
        { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [isNew ? -28 : 16, 0] }) },
        { scale: pressScale },
      ],
    }]}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} style={pressableStyle}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ─── TopCard — the #1 hero, matching the mockup's single gold hero card
// (full-bleed photo, "#1 this month" pill, bottom-left serif name/place,
// bottom-right huge serif gold score). Only ever rendered for rank 1 —
// ranks 2+ use the plain RankRow list below. ──────────────────────────────────
// isPinned / onTogglePin are yearly-only; undefined on the monthly list.
function TopCard({ meal, rank, index, isNew, onLanded, isPinned, onTogglePin, distance, onPress }) {
  const glow = useRef(new Animated.Value(0)).current;
  const badgeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isNew) return;
    Animated.sequence([
      Animated.delay(index * 90 + 650),
      Animated.parallel([
        Animated.spring(badgeIn, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0.3, duration: 480, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 1, duration: 360, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0, duration: 700, useNativeDriver: false }),
        ]),
      ]),
      Animated.delay(1200),
      Animated.timing(badgeIn, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => onLanded && onLanded());
  }, []);
  const badgeScale = badgeIn.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1, duration: 550, delay: index * 90 + 200,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, []);

  const badge = (
    <Pressable
      onPress={onTogglePin}
      disabled={!onTogglePin}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.heroBadge}
    >
      <Ionicons name="star" size={11} color={C.bg} />
      <Text style={styles.heroBadgeText}>{onTogglePin ? (isPinned ? 'PINNED AT #1' : '#1') : '#1 this month'}</Text>
    </Pressable>
  );

  return (
    <AnimatedRow
      index={index}
      isNew={isNew}
      onPress={onPress}
      style={{ opacity: fade }}
      pressableStyle={styles.heroCard}
    >
      {meal.photo_url ? (
        <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <StripedPlaceholder style={StyleSheet.absoluteFill}>
          <View style={styles.heroImgFallback}>
            <Text style={styles.heroEmoji}>{meal.emoji || '🍽️'}</Text>
          </View>
        </StripedPlaceholder>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.92)']}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {isNew && <Animated.View pointerEvents="none" style={[styles.landGlow, { opacity: glow }]} />}
      {isNew && (
        <Animated.View pointerEvents="none" style={[styles.landBadge, { opacity: badgeIn, transform: [{ scale: badgeScale }] }]}>
          <Text style={styles.landBadgeText}>LANDED HERE</Text>
        </Animated.View>
      )}

      {badge}

      <View style={styles.heroBottomRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroName} numberOfLines={1}>{meal.name}</Text>
          {(distance || meal.tag) && (
            <Text style={styles.heroMeta} numberOfLines={1}>
              {[tagLabel(meal.tag), distance && `📍 ${distance}`].filter(Boolean).join('  ·  ')}
            </Text>
          )}
        </View>
        <Text style={styles.heroScore}>{formatScore(meal.score)}</Text>
      </View>
    </AnimatedRow>
  );
}

// ─── RankRow ──────────────────────────────────────────────────────────────────
// isPinned / onTogglePin are yearly-only; undefined on the monthly list.
function RankRow({ meal, rank, listIndex, isNew, onLanded, isPinned, onTogglePin, distance, onPress }) {
  const enter = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const badgeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 360,
      delay: isNew ? 750 : Math.min(listIndex * 55, 480),
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    if (!isNew) return;
    Animated.sequence([
      Animated.delay(900),
      Animated.parallel([
        Animated.spring(badgeIn, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0.25, duration: 480, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 1, duration: 360, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0, duration: 700, useNativeDriver: false }),
        ]),
      ]),
      Animated.delay(1200),
      Animated.timing(badgeIn, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => onLanded && onLanded());
  }, []);

  const badgeScale = badgeIn.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  const rankArea = onTogglePin ? (
    <Pressable onPress={onTogglePin} style={styles.rowRankPressable} hitSlop={10}>
      <Text style={[styles.rowRank, isPinned && { color: C.orange }]}>{rank}</Text>
      {isPinned && <Text style={styles.rowRankPinDot}>📌</Text>}
    </Pressable>
  ) : (
    <Text style={styles.rowRank}>{rank}</Text>
  );

  return (
    <Animated.View style={[
      styles.rowCard,
      isPinned && styles.rowCardPinned,
      { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [isNew ? -20 : 10, 0] }) }] },
    ]}>
      {isNew && <Animated.View pointerEvents="none" style={[styles.rowGlow, { opacity: glow }]} />}
      <Pressable onPress={onPress} style={styles.row}>
        {rankArea}
        {meal.photo_url ? (
          <Image source={{ uri: meal.photo_url }} style={styles.rowImg} resizeMode="cover" />
        ) : (
          <StripedPlaceholder style={styles.rowImg}>
            <View style={styles.rowImgFallback}>
              <Text style={styles.rowEmoji}>{meal.emoji || '🍽️'}</Text>
            </View>
          </StripedPlaceholder>
        )}
        <View style={styles.rowNameWrap}>
          <Text style={styles.rowName} numberOfLines={1}>{meal.name}</Text>
          {(distance || meal.tag) && (
            <Text style={styles.rowDistance} numberOfLines={1}>
              {[tagLabel(meal.tag), distance && `📍 ${distance}`].filter(Boolean).join('  ·  ')}
            </Text>
          )}
        </View>
        <Text style={styles.rowScore}>{formatScore(meal.score)}</Text>
        {isNew && (
          <Animated.View pointerEvents="none" style={[styles.rowBadge, { opacity: badgeIn, transform: [{ scale: badgeScale }] }]}>
            <Text style={styles.rowBadgeText}>NEW</Text>
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── Rank reveal ──────────────────────────────────────────────────────────────
const SLOT_ITEM_H = 64;
const SLOT_VISIBLE = 5;
const SLOT_CENTER = 2;

const RANK_TIER = {
  1: { accent: C.gold, bg: ['#241900', '#000000'], medal: '🥇', title: 'LEGENDARY',  confetti: [C.gold, '#ff9e3d', '#fff', '#ffcc44', '#ffa040'] },
  2: { accent: '#d8e0ec', bg: ['#181e26', '#000000'], medal: '🥈', title: 'INCREDIBLE', confetti: ['#d8e0ec', '#a0b8cc', '#fff', '#d0ddf0'] },
  3: { accent: '#e09060', bg: ['#201000', '#000000'], medal: '🥉', title: 'IMPRESSIVE', confetti: ['#e09060', '#ff6b3d', '#fff', '#e8a87a'] },
};
function rankTier(rank) {
  if (RANK_TIER[rank]) return { ...RANK_TIER[rank], special: true };
  if (rank <= 10) return { accent: C.orange, bg: ['#1a0600', '#000000'], medal: null, title: 'TOP 10', confetti: ['#ff6b3d', '#ff9e3d', '#fff'], special: false };
  return { accent: C.gray1, bg: ['#111', '#000000'], medal: null, title: null, confetti: null, special: false };
}

const N_PARTICLES = 32;
function ConfettiBurst({ colors }) {
  const particles = useRef(
    Array.from({ length: N_PARTICLES }, (_, i) => {
      const angle = (i / N_PARTICLES) * 2 * Math.PI + (Math.random() - 0.5) * 0.6;
      const dist = 80 + Math.random() * 130;
      return {
        tx: new Animated.Value(0), ty: new Animated.Value(0), op: new Animated.Value(1),
        color: colors[i % colors.length],
        size: 5 + Math.random() * 9,
        delay: Math.random() * 300,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 40,
      };
    })
  ).current;

  useEffect(() => {
    Animated.parallel(particles.map(p =>
      Animated.sequence([
        Animated.delay(p.delay),
        Animated.parallel([
          Animated.timing(p.tx, { toValue: p.dx, duration: 750, useNativeDriver: true }),
          Animated.timing(p.ty, { toValue: p.dy, duration: 750, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(220),
            Animated.timing(p.op, { toValue: 0, duration: 600, useNativeDriver: true }),
          ]),
        ]),
      ])
    )).start();
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
      {particles.map((p, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', width: p.size, height: p.size,
          borderRadius: p.size / 3, backgroundColor: p.color,
          opacity: p.op, transform: [{ translateX: p.tx }, { translateY: p.ty }],
        }} />
      ))}
    </View>
  );
}

function RankReveal({ rank, meal, meals, onComplete }) {
  const tier = rankTier(rank);
  const finalIndex = rank - 1;
  const startIndex = Math.min(finalIndex + 8, meals.length - 1);

  const slotY        = useRef(new Animated.Value((SLOT_CENTER - startIndex) * SLOT_ITEM_H)).current;
  const slotOpacity  = useRef(new Animated.Value(1)).current;
  const celebOpacity = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const rankScale    = useRef(new Animated.Value(0)).current;
  const medalScale   = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const [confettiActive, setConfettiActive] = useState(false);

  useEffect(() => {
    const endY       = (SLOT_CENTER - finalIndex) * SLOT_ITEM_H;
    const overshootY = endY + SLOT_ITEM_H * 1.5;
    Animated.sequence([
      Animated.timing(slotY, { toValue: overshootY, duration: 1600, easing: Easing.bezier(0.22, 0.1, 0.05, 1.0), useNativeDriver: true }),
      Animated.spring(slotY, { toValue: endY, useNativeDriver: true, speed: 14, bounciness: 7 }),
    ]).start(() => {
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(slotOpacity,  { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.timing(celebOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
        ]).start(() => {
          Animated.spring(rankScale, { toValue: 1, useNativeDriver: true, speed: 6, bounciness: 22 }).start();
          if (tier.special || rank <= 10) {
            setTimeout(() => {
              if (tier.confetti) setConfettiActive(true);
              Animated.parallel([
                Animated.spring(medalScale, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 14 }),
                Animated.timing(titleOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
              ]).start();
            }, 480);
          }
          const hold = tier.special ? 2500 : rank <= 10 ? 1900 : 1500;
          setTimeout(() => {
            Animated.timing(screenOpacity, { toValue: 0, duration: 550, useNativeDriver: true }).start(() => onComplete?.());
          }, hold);
        });
      }, 350);
    });
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: screenOpacity }]}>
      <LinearGradient colors={tier.bg} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.slotPhase, { opacity: slotOpacity }]}>
        <Text style={styles.slotMealEmoji}>{meal.emoji || '🍽️'}</Text>
        <Text style={styles.slotMealName} numberOfLines={1}>{meal.name}</Text>
        <Text style={styles.slotFindingLabel}>FINDING YOUR RANK</Text>
        <View style={styles.slotViewport}>
          <LinearGradient colors={[tier.bg[0], 'transparent']} style={styles.slotFadeTop} pointerEvents="none" />
          <LinearGradient colors={['transparent', tier.bg[0]]} style={styles.slotFadeBottom} pointerEvents="none" />
          <View style={[styles.slotCenterBand, { borderColor: tier.accent + '60' }]} />
          <Animated.View style={{ transform: [{ translateY: slotY }] }}>
            {meals.map((m, i) => (
              <View key={m.id || i} style={styles.slotRow}>
                <Text style={[styles.slotRankNum, i === finalIndex && { color: tier.accent }]}>#{i + 1}</Text>
                <Text style={styles.slotRowEmoji}>{m.emoji || '🍽️'}</Text>
                <Text style={[styles.slotRowName, i === finalIndex && { color: tier.accent, fontWeight: '700' }]} numberOfLines={1}>
                  {m.name}
                </Text>
              </View>
            ))}
          </Animated.View>
        </View>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.celebPhase, { opacity: celebOpacity }]}>
        {confettiActive && tier.confetti && <ConfettiBurst colors={tier.confetti} />}
        {tier.medal && (
          <Animated.Text style={[styles.celebMedal, { transform: [{ scale: medalScale }], opacity: titleOpacity }]}>
            {tier.medal}
          </Animated.Text>
        )}
        <Animated.View style={{ transform: [{ scale: rankScale }], alignItems: 'center' }}>
          <Text style={[styles.celebRankNum, { color: tier.accent }]}>#{rank}</Text>
        </Animated.View>
        {tier.title && (
          <Animated.Text style={[styles.celebTitle, { color: tier.accent, opacity: titleOpacity }]}>
            {tier.title}
          </Animated.Text>
        )}
        <Text style={styles.celebMealName} numberOfLines={2}>{meal.name}</Text>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Segmented control ────────────────────────────────────────────────────────
function SegmentedControl({ value, onChange }) {
  return (
    <View style={styles.segWrap}>
      {[['monthly', CURRENT_MONTH_LABEL], ['yearly', String(CURRENT_YEAR)]].map(([key, label]) => (
        <TouchableOpacity
          key={key}
          style={[styles.segBtn, value === key && styles.segBtnActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.8}
        >
          <Text style={[styles.segBtnText, value === key && styles.segBtnTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Near Me toggle ────────────────────────────────────────────────────────────
function NearMeToggle({ active, hasCoords, onToggle }) {
  return (
    <TouchableOpacity
      style={[styles.nearMeChip, active && styles.nearMeChipActive, !hasCoords && styles.nearMeChipDim]}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      <Text style={[styles.nearMeChipText, active && styles.nearMeChipTextActive]}>📍 Near Me</Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function TierListScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  // ── Monthly state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meals, setMeals] = useState([]);
  const [highlightId, setHighlightId] = useState(null);
  const [showReveal, setShowReveal] = useState(false);
  const [revealData, setRevealData] = useState(null);

  // ── Mode ──
  const [mode, setMode] = useState('monthly');

  // ── Near Me (location) ──
  // Live device position only — never persisted. Used to compute a live
  // distance from each meal's place and, when the toggle is on, to re-sort
  // the visible monthly list by that distance instead of score.
  const [userCoords, setUserCoords] = useState(null);
  const [nearMeOn, setNearMeOn] = useState(false);

  // ── Yearly state ──
  // allYearMeals: full year meal list (score-sorted), needed for rebuilding after pin changes
  const [allYearMeals, setAllYearMeals] = useState([]);
  const allYearMealsRef = useRef([]);
  // yearlyPinnedSlots: { meal_id: rank } — individual item pins
  const [yearlyPinnedSlots, setYearlyPinnedSlots] = useState({});
  const yearlyPinnedSlotsRef = useRef({});
  // yearlyMeals: derived display list from buildYearlyList
  const [yearlyMeals, setYearlyMeals] = useState([]);
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [yearlyError, setYearlyError] = useState(null);
  const yearlyMealsRef = useRef([]);
  const yearlyEverLoadedRef = useRef(false);
  const userIdRef = useRef(null);

  useEffect(() => { yearlyMealsRef.current = yearlyMeals; }, [yearlyMeals]);
  useEffect(() => { allYearMealsRef.current = allYearMeals; }, [allYearMeals]);
  useEffect(() => { yearlyPinnedSlotsRef.current = yearlyPinnedSlots; }, [yearlyPinnedSlots]);

  // ── Shared drag state ──
  const listRef = useRef(null);
  const [tooltipVisible, dismissTooltip]       = useFirstVisit('@fw_tt_tierlist');
  const [pinTooltipVisible, dismissPinTooltip] = useFirstVisit('@fw_tt_pin', 3600000);
  const draggedIdShared = useSharedValue('');
  const dragTranslateY  = useSharedValue(0);
  const rowLayoutsRef   = useRef({});
  const scrollYRef      = useRef(0);
  const mealsRef        = useRef([]);
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => { mealsRef.current = meals; }, [meals]);

  const headerEnter = useRef(new Animated.Value(0)).current;

  // Request foreground location on mount, mirroring LogMealScreen's pattern.
  // Non-blocking and non-fatal: if denied, Near Me simply stays unavailable.
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

  function handleToggleNearMe() {
    if (!userCoords) {
      Alert.alert('Location needed', 'Enable location access to sort your meals by distance.');
      return;
    }
    setNearMeOn(v => !v);
  }

  // ── Load monthly ──
  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return;
      userIdRef.current = user.id;

      const monthStart = new Date(CURRENT_YEAR, CURRENT_MONTH, 1).toISOString();
      const monthEnd   = new Date(CURRENT_YEAR, CURRENT_MONTH + 1, 1).toISOString();

      const { data, error: fetchError } = await supabase
        .from('meals').select('*, places(lat, lng)').eq('user_id', user.id)
        .gte('created_at', monthStart).lt('created_at', monthEnd)
        .order('score', { ascending: false, nullsFirst: false });

      if (fetchError) throw fetchError;
      setMeals(data || []);
    } catch (err) {
      setError(err.message || 'Failed to load your tier list.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load yearly ──
  const loadYearly = useCallback(async () => {
    setYearlyError(null);
    setYearlyLoading(true);
    try {
      if (!userIdRef.current) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        userIdRef.current = user.id;
      }
      const uid = userIdRef.current;
      const yearStart = `${CURRENT_YEAR}-01-01T00:00:00.000Z`;
      const yearEnd   = `${CURRENT_YEAR + 1}-01-01T00:00:00.000Z`;

      const [{ data: mealsData, error: mealsErr }, { data: tierData, error: tierErr }] = await Promise.all([
        // Fetch ALL year meals (not limited to 10) so buildYearlyList has the full pool
        supabase.from('meals').select('*').eq('user_id', uid)
          .gte('created_at', yearStart).lt('created_at', yearEnd)
          .order('score', { ascending: false, nullsFirst: false }),
        supabase.from('yearly_tier_lists').select('*')
          .eq('user_id', uid).eq('year', CURRENT_YEAR).maybeSingle(),
      ]);

      if (mealsErr) throw mealsErr;
      if (tierErr) throw tierErr;

      const allMeals = mealsData || [];
      const slots = tierData?.pinned_slots || {};

      setAllYearMeals(allMeals);
      setYearlyPinnedSlots(slots);
      setYearlyMeals(buildYearlyList(allMeals, slots));
    } catch (err) {
      setYearlyError(err.message || 'Failed to load yearly tier list.');
    } finally {
      setYearlyLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      if (yearlyEverLoadedRef.current) loadYearly();
    }, [load, loadYearly])
  );

  useEffect(() => {
    if (!loading) {
      headerEnter.setValue(0);
      Animated.timing(headerEnter, {
        toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    }
  }, [loading]);

  useEffect(() => {
    const newMealId = route.params?.newMealId;
    if (!newMealId || loading || meals.length === 0) return;
    const idx = meals.findIndex(m => m.id === newMealId);
    if (idx === -1) return;
    setHighlightId(newMealId);
    setRevealData({ rank: idx + 1, meal: meals[idx] });
    setShowReveal(true);
    navigation.setParams({ newMealId: undefined });
  }, [route.params?.newMealId, loading, meals]);

  // ── Mode switch ──
  function switchMode(newMode) {
    if (newMode === mode) return;
    rowLayoutsRef.current = {};
    setDraggedId(null);
    draggedIdShared.value = '';
    setMode(newMode);
    if (newMode === 'yearly') setNearMeOn(false);
    if (newMode === 'yearly' && !yearlyEverLoadedRef.current) {
      yearlyEverLoadedRef.current = true;
      loadYearly();
    }
  }

  // ── Monthly drag handlers ──
  function handleDragStart(mealId) { setDraggedId(mealId); }

  function handleDrop(mealId, translationY) {
    const current = mealsRef.current;
    const layout  = rowLayoutsRef.current[mealId];
    if (!layout || current.length < 2) { setDraggedId(null); return; }

    const draggingCenterY = layout.y + layout.height / 2 + translationY;
    const remaining = current.filter(m => m.id !== mealId);

    let insertionIdx = remaining.length;
    for (let i = 0; i < remaining.length; i++) {
      const rLayout = rowLayoutsRef.current[remaining[i].id];
      if (!rLayout) continue;
      if (draggingCenterY < rLayout.y + rLayout.height / 2) { insertionIdx = i; break; }
    }

    let newScore;
    if (insertionIdx === 0) {
      newScore = (10.0 + remaining[0].score) / 2;
    } else if (insertionIdx === remaining.length) {
      newScore = (remaining[remaining.length - 1].score + 1.0) / 2;
    } else {
      newScore = (remaining[insertionIdx - 1].score + remaining[insertionIdx].score) / 2;
    }

    const draggedMeal = current.find(m => m.id === mealId);
    if (Math.abs(newScore - (draggedMeal?.score ?? 0)) < 0.001) { setDraggedId(null); return; }

    const oldMeals = [...current];
    const updatedMeals = current
      .map(m => m.id === mealId ? { ...m, score: newScore } : m)
      .sort((a, b) => b.score - a.score);

    LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
    setMeals(updatedMeals);
    setDraggedId(null);

    supabase.from('meals').update({ score: newScore }).eq('id', mealId)
      .then(({ error }) => {
        if (error) {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
          setMeals(oldMeals);
          Alert.alert('Reorder failed', 'Could not save the new ranking. Please try again.');
        }
      });
  }

  // ── Yearly drag handler ──
  // Dragging an item in the yearly list pins it at its new rank position.
  function handleDropYearly(mealId, translationY) {
    const current = yearlyMealsRef.current;
    const layout  = rowLayoutsRef.current[mealId];
    if (!layout || current.length < 2) { setDraggedId(null); return; }

    const draggingCenterY = layout.y + layout.height / 2 + translationY;
    const remaining = current.filter(m => m.id !== mealId);

    let insertionIdx = remaining.length;
    for (let i = 0; i < remaining.length; i++) {
      const rLayout = rowLayoutsRef.current[remaining[i].id];
      if (!rLayout) continue;
      if (draggingCenterY < rLayout.y + rLayout.height / 2) { insertionIdx = i; break; }
    }

    const newOrder = [...remaining];
    newOrder.splice(insertionIdx, 0, current.find(m => m.id === mealId));

    if (newOrder.every((m, i) => m.id === current[i]?.id)) { setDraggedId(null); return; }

    const newRank = insertionIdx + 1;

    // Build new pinned slots: carry over existing pins (except displaced), pin dragged item at new rank
    const newSlots = {};
    for (const [id, r] of Object.entries(yearlyPinnedSlotsRef.current)) {
      if (id !== mealId && r !== newRank) newSlots[id] = r;
    }
    newSlots[mealId] = newRank;

    const rebuilt = buildYearlyList(allYearMealsRef.current, newSlots);
    const oldMeals = [...current];
    const oldSlots = { ...yearlyPinnedSlotsRef.current };

    LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
    setYearlyMeals(rebuilt);
    setYearlyPinnedSlots(newSlots);
    setDraggedId(null);

    persistYearlySlots(newSlots, oldMeals, oldSlots);
  }

  // ── Per-item pin toggle ──
  async function handleToggleItemPin(mealId, currentRank) {
    const current = yearlyPinnedSlotsRef.current;
    const isPinned = mealId in current;

    const newSlots = { ...current };
    if (isPinned) {
      delete newSlots[mealId];
    } else {
      // Remove any existing pin at this rank to avoid collisions
      for (const [id, r] of Object.entries(newSlots)) {
        if (r === currentRank) delete newSlots[id];
      }
      newSlots[mealId] = currentRank;
    }

    const rebuilt = buildYearlyList(allYearMealsRef.current, newSlots);
    const oldMeals = [...yearlyMealsRef.current];
    const oldSlots = { ...current };

    LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
    setYearlyMeals(rebuilt);
    setYearlyPinnedSlots(newSlots);

    persistYearlySlots(newSlots, oldMeals, oldSlots);
  }

  function persistYearlySlots(newSlots, rollbackMeals, rollbackSlots) {
    supabase.from('yearly_tier_lists')
      .upsert(
        { user_id: userIdRef.current, year: CURRENT_YEAR, pinned_slots: newSlots },
        { onConflict: 'user_id,year' }
      )
      .then(({ error }) => {
        if (error) {
          console.error('[TierList] pin persist failed:', error.message, error.details ?? '');
          LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
          setYearlyMeals(rollbackMeals);
          setYearlyPinnedSlots(rollbackSlots);
          Alert.alert('Save failed', error.message || 'Could not save pin. Please try again.');
        }
      })
      .catch(err => {
        console.error('[TierList] pin persist exception:', err);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
        setYearlyMeals(rollbackMeals);
        setYearlyPinnedSlots(rollbackSlots);
      });
  }

  // ── Reveal complete ──
  function onRevealComplete() {
    setShowReveal(false);
    if (revealData) {
      const mealId = revealData.meal.id;
      setTimeout(() => {
        const layout = rowLayoutsRef.current[mealId];
        if (layout) listRef.current?.scrollTo({ y: Math.max(0, layout.y - 120), animated: true });
      }, 80);
    }
  }

  // ── Loading / error states ──
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}><ActivityIndicator color={C.orange} /></View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>⚠️</Text>
          <Text style={styles.emptyTitle}>Couldn't load tier list</Text>
          <Text style={styles.emptySub}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Monthly content ──
  function renderMonthlyContent() {
    if (meals.length === 0) {
      return (
        <View style={styles.inlineCenter}>
          <Text style={styles.emptyEmoji}>🏆</Text>
          <Text style={styles.emptyTitle}>Nothing logged in {CURRENT_MONTH_LABEL} yet</Text>
          <Text style={styles.emptySub}>Log some meals this month and your rankings will show up here.</Text>
        </View>
      );
    }
    const displayMeals = nearMeOn
      ? [...meals].sort((a, b) => {
          const da = mealDistanceMi(a, userCoords);
          const db = mealDistanceMi(b, userCoords);
          if (da == null && db == null) return 0;
          if (da == null) return 1;
          if (db == null) return -1;
          return da - db;
        })
      : meals;

    return displayMeals.map((meal, idx) => {
      const rank = idx + 1;
      const isHero = rank === 1;
      const distance = nearMeOn ? formatDistance(mealDistanceMi(meal, userCoords)) : null;
      return (
        <DraggableRow
          key={meal.id}
          mealId={meal.id}
          draggedIdShared={draggedIdShared}
          dragTranslateY={dragTranslateY}
          onLayout={e => { rowLayoutsRef.current[meal.id] = { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }; }}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          dragEnabled={!nearMeOn}
          style={isHero ? [styles.topDragRow, { marginBottom: 12 }] : styles.rankDragRow}
        >
          {isHero ? (
            <TopCard meal={meal} rank={rank} index={idx}
              isNew={meal.id === highlightId}
              onLanded={() => setHighlightId(cur => cur === meal.id ? null : cur)}
              distance={distance}
              onPress={() => navigation.navigate('MealDetail', { mealId: meal.id })} />
          ) : (
            <RankRow meal={meal} rank={rank} listIndex={idx - 1}
              isNew={meal.id === highlightId}
              onLanded={() => setHighlightId(cur => cur === meal.id ? null : cur)}
              distance={distance}
              onPress={() => navigation.navigate('MealDetail', { mealId: meal.id })} />
          )}
        </DraggableRow>
      );
    });
  }

  // ── Yearly content ──
  function renderYearlyContent() {
    if (yearlyLoading) {
      return <View style={styles.inlineCenter}><ActivityIndicator color={C.orange} /></View>;
    }
    if (yearlyError) {
      return (
        <View style={styles.inlineCenter}>
          <Text style={styles.emptyEmoji}>⚠️</Text>
          <Text style={styles.emptyTitle}>Couldn't load {CURRENT_YEAR}</Text>
          <Text style={styles.emptySub}>{yearlyError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadYearly} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (yearlyMeals.length === 0) {
      return (
        <View style={styles.inlineCenter}>
          <Text style={styles.emptyEmoji}>📅</Text>
          <Text style={styles.emptyTitle}>Nothing logged in {CURRENT_YEAR} yet</Text>
          <Text style={styles.emptySub}>Log meals this year and your top picks will appear here.</Text>
        </View>
      );
    }
    return yearlyMeals.map((meal, idx) => {
      const rank = idx + 1;
      const isHero = rank === 1;
      const isPinned = meal._pinned === true;
      return (
        <DraggableRow
          key={meal.id}
          mealId={meal.id}
          draggedIdShared={draggedIdShared}
          dragTranslateY={dragTranslateY}
          onLayout={e => { rowLayoutsRef.current[meal.id] = { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }; }}
          onDragStart={handleDragStart}
          onDrop={handleDropYearly}
          style={isHero ? [styles.topDragRow, { marginBottom: 12 }] : styles.rankDragRow}
        >
          {isHero ? (
            <TopCard meal={meal} rank={rank} index={idx} isNew={false} onLanded={null}
              isPinned={isPinned}
              onTogglePin={() => handleToggleItemPin(meal.id, rank)}
              onPress={() => navigation.navigate('MealDetail', { mealId: meal.id })} />
          ) : (
            <RankRow meal={meal} rank={rank} listIndex={idx - 1} isNew={false} onLanded={null}
              isPinned={isPinned}
              onTogglePin={() => handleToggleItemPin(meal.id, rank)}
              onPress={() => navigation.navigate('MealDetail', { mealId: meal.id })} />
          )}
        </DraggableRow>
      );
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        scrollEnabled={draggedId === null}
        onScroll={e => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
      >
        <Animated.View style={{
          opacity: headerEnter,
          transform: [{ translateY: headerEnter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}>
          <Text style={styles.kicker}>TIER LIST</Text>
          <Text style={styles.heading}>Your rankings</Text>
          <SegmentedControl value={mode} onChange={switchMode} />
          {mode === 'monthly' && meals.length > 0 && (
            <View style={styles.nearMeRow}>
              <NearMeToggle active={nearMeOn} hasCoords={!!userCoords} onToggle={handleToggleNearMe} />
            </View>
          )}
          <Text style={styles.subheading}>
            {mode === 'monthly'
              ? nearMeOn
                ? `${meals.length} ${meals.length === 1 ? 'meal' : 'meals'} · sorted by distance`
                : `${meals.length} ${meals.length === 1 ? 'meal' : 'meals'} in ${CURRENT_MONTH_LABEL}`
              : yearlyMeals.length === 0
                ? `No entries in ${CURRENT_YEAR}`
                : `Top ${yearlyMeals.length} of ${CURRENT_YEAR} · tap rank to pin`}
          </Text>
        </Animated.View>

        {mode === 'monthly' ? renderMonthlyContent() : renderYearlyContent()}
      </ScrollView>

      {showReveal && revealData && (
        <RankReveal rank={revealData.rank} meal={revealData.meal} meals={meals} onComplete={onRevealComplete} />
      )}

      {tooltipVisible && (
        <FirstVisitTooltip
          message="Drag the ≡ handle on the right to reorder meals"
          onDismiss={dismissTooltip}
          style={{ bottom: 90, right: 16 }}
        />
      )}
      {pinTooltipVisible && mode === 'yearly' && !tooltipVisible && (
        <FirstVisitTooltip
          message="Tap the rank badge to pin a meal in place — it holds its spot even as better ones come in."
          onDismiss={dismissPinTooltip}
          style={{ bottom: 90, alignSelf: 'center' }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  inlineCenter: { paddingTop: 60, alignItems: 'center', paddingHorizontal: 32 },
  list: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  listContent: { paddingBottom: 40, paddingTop: 16 },

  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontWeight: '700', fontSize: 20, color: C.white, marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, color: C.gray1, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  retryBtn: { backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13 },
  retryBtnText: { fontSize: 15, fontWeight: '700', color: C.white },

  kicker: {
    fontWeight: '700', fontSize: 12, letterSpacing: 1.5, color: C.orange,
    textTransform: 'uppercase', paddingHorizontal: 24, paddingTop: 4, marginBottom: 6,
  },
  heading: {
    fontFamily: C.serif, fontSize: 36, color: C.white,
    paddingHorizontal: 24, marginBottom: 16,
  },
  subheading: { fontSize: 12, color: RANK_GRAY, paddingHorizontal: 24, marginTop: 4, marginBottom: 26 },

  // Segmented control
  segWrap: {
    flexDirection: 'row', marginHorizontal: 24, backgroundColor: C.glassBg,
    borderRadius: C.pill, borderWidth: 1, borderColor: C.glassBorder, padding: 4,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: C.pill, alignItems: 'center' },
  segBtnActive: { backgroundColor: C.orange },
  segBtnText: { fontWeight: '700', fontSize: 13, color: C.gray2 },
  segBtnTextActive: { color: C.white },

  // Near Me toggle
  nearMeRow: { paddingHorizontal: 24, marginTop: 12, flexDirection: 'row' },
  nearMeChip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  nearMeChipActive: { backgroundColor: C.orange + '20', borderColor: C.orange },
  nearMeChipDim: { opacity: 0.55 },
  nearMeChipText: { fontSize: 12, fontWeight: '700', color: C.gray1 },
  nearMeChipTextActive: { color: C.orange },

  // Drag
  topDragRow: { marginHorizontal: 24 },
  rankDragRow: { marginHorizontal: 16, marginBottom: 8 },
  dragHandle: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 40,
    justifyContent: 'center', alignItems: 'center', gap: 4,
  },
  handleLine: { width: 14, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.28)' },

  // #1 hero card — full-bleed photo, gold border/glow, bottom-left serif
  // name, bottom-right huge serif gold score. Matches the mockup's single
  // hero treatment (only rank 1 ever renders this; 2+ use rowCard below).
  heroCard: {
    height: 220, borderRadius: 22, overflow: 'hidden', position: 'relative',
    backgroundColor: '#1a1a1a',
    borderWidth: 1.5, borderColor: 'rgba(233,184,114,0.5)',
    shadowColor: C.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8,
  },
  heroImgFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 44 },
  heroBadge: {
    position: 'absolute', top: 14, left: 14, zIndex: 2,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.gold, borderRadius: C.pill,
    paddingHorizontal: 11, paddingVertical: 5,
  },
  heroBadgeText: { fontSize: 11, fontWeight: '800', color: C.bg, letterSpacing: 0.3 },
  heroBottomRow: {
    position: 'absolute', left: 16, right: 16, bottom: 14, zIndex: 2,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10,
  },
  heroName: { fontFamily: C.serif, fontSize: 24, color: C.white },
  heroMeta: { fontSize: 12, color: 'rgba(245,245,247,0.6)', marginTop: 2 },
  heroScore: { fontFamily: C.serif, fontSize: 40, color: C.gold },

  landGlow: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderWidth: 2, borderColor: C.gold, borderRadius: 24 },
  landBadge: { position: 'absolute', top: -11, right: 16, backgroundColor: C.gold, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, zIndex: 5 },
  landBadgeText: { fontWeight: '800', fontSize: 10, letterSpacing: 0.8, color: C.bg },

  // Plain list rows (rank 2+) — matches the mockup's flat list under the hero.
  rowCard: { backgroundColor: C.glassBg, borderRadius: 16, borderWidth: 1, borderColor: C.glassBorder, overflow: 'hidden' },
  rowCardPinned: { borderColor: C.orange + '50', borderWidth: 1, borderLeftWidth: 3, borderLeftColor: C.orange },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 40, paddingVertical: 12 },
  rowGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,107,61,0.13)' },
  rowBadge: { position: 'absolute', right: 14, top: -1, backgroundColor: C.orange, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  rowBadgeText: { fontWeight: '800', fontSize: 9, letterSpacing: 0.6, color: '#000000' },
  rowRankPressable: { width: 30, alignItems: 'center', justifyContent: 'center', gap: 1 },
  rowRank: { width: 30, fontFamily: C.serif, fontSize: 20, color: 'rgba(245,245,247,0.6)', textAlign: 'center' },
  rowRankPinDot: { fontSize: 9, textAlign: 'center' },
  rowImg: { width: 46, height: 46, borderRadius: 12, backgroundColor: C.bg },
  rowImgFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  rowEmoji: { fontSize: 20 },
  rowNameWrap: { flex: 1 },
  rowName: { fontSize: 14, color: C.white, fontWeight: '600' },
  rowDistance: { fontSize: 10, color: C.gray3, marginTop: 1, fontWeight: '500' },
  rowScore: { fontWeight: '700', fontSize: 15, color: C.white },

  // Rank reveal overlay
  slotPhase: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  slotMealEmoji: { fontSize: 52, marginBottom: 10 },
  slotMealName: { fontWeight: '700', fontSize: 20, color: C.white, marginBottom: 6, textAlign: 'center' },
  slotFindingLabel: { fontSize: 11, color: C.gray3, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 28 },
  slotViewport: { width: '100%', height: SLOT_VISIBLE * SLOT_ITEM_H, overflow: 'hidden' },
  slotFadeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: SLOT_ITEM_H * 2.2, zIndex: 2 },
  slotFadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: SLOT_ITEM_H * 2.2, zIndex: 2 },
  slotCenterBand: { position: 'absolute', top: SLOT_CENTER * SLOT_ITEM_H, left: 0, right: 0, height: SLOT_ITEM_H, borderTopWidth: 1, borderBottomWidth: 1, zIndex: 1 },
  slotRow: { height: SLOT_ITEM_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  slotRankNum: { fontWeight: '700', fontSize: 13, color: C.gray4, width: 36, textAlign: 'right' },
  slotRowEmoji: { fontSize: 26 },
  slotRowName: { flex: 1, fontSize: 15, color: C.gray3 },
  celebPhase: { alignItems: 'center', justifyContent: 'center' },
  celebMedal: { fontSize: 72, marginBottom: 6 },
  celebRankNum: { fontFamily: C.serif, fontSize: 110, lineHeight: 116 },
  celebTitle: { fontWeight: '800', fontSize: 16, letterSpacing: 4, marginTop: 6 },
  celebMealName: { fontSize: 16, color: C.gray1, marginTop: 20, textAlign: 'center', fontWeight: '500', paddingHorizontal: 40 },
});
