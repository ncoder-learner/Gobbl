import { useCallback, useEffect, useRef, useState, Fragment } from 'react';
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
  UIManager,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import RAnimated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { supabase } from '../lib/supabase';
import { FirstVisitTooltip, useFirstVisit } from '../lib/firstVisit';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const C = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  border: '#2a2a2a',
  orange: '#FF6B3D',
  rankGray: '#8a8a8a',
  white: '#ffffff',
  gray1: '#888888',
  gray2: '#666666',
  gray3: '#555555',
  gray4: '#444444',
  gray5: '#333333',
  purple: '#8B5CF6',
};

const ACCENTS = { 1: '#ffd166', 2: '#cfd6e4', 3: '#cd8b5a' };
const DEFAULT_ACCENT = C.orange;

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth();
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CURRENT_MONTH_LABEL = MONTH_NAMES[CURRENT_MONTH];

function formatScore(score) {
  const n = typeof score === 'string' ? Number(score) : score;
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return (Math.round(n * 2) / 2).toFixed(1);
}

function scoreBarWidth(score) {
  const n = typeof score === 'string' ? Number(score) : score;
  const pct = typeof n === 'number' && !Number.isNaN(n) ? Math.max(0, Math.min(n, 10)) / 10 : 0;
  return Math.max(6, pct * 40);
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
function DraggableRow({ mealId, draggedIdShared, dragTranslateY, onLayout, onDragStart, onDrop, style, children }) {
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
      <DragHandle panGesture={panGesture} />
    </RAnimated.View>
  );
}

// ─── AnimatedRow ──────────────────────────────────────────────────────────────
function AnimatedRow({ index, children, style, pressableStyle, isNew }) {
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
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut} style={pressableStyle}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ─── TopCard ──────────────────────────────────────────────────────────────────
// isPinned / onTogglePin are yearly-only; undefined on the monthly list.
function TopCard({ meal, rank, index, isNew, onLanded, isPinned, onTogglePin }) {
  const accent = ACCENTS[rank] || DEFAULT_ACCENT;
  const isFirst = rank === 1;
  const targetBarWidth = scoreBarWidth(meal.score);

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

  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fill, {
      toValue: 1, duration: 750, delay: index * 90 + 320,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, []);
  const barWidth = fill.interpolate({ inputRange: [0, 1], outputRange: [0, targetBarWidth] });
  const scoreOpacity = fill.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0, 1] });
  const scoreScale   = fill.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.82, 0.82, 1] });

  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isFirst) return;
    Animated.loop(
      Animated.sequence([
        Animated.delay(1800),
        Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-140, 360] });

  const rankBadgeContent = onTogglePin ? (
    <Pressable
      onPress={onTogglePin}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.rankBadge, styles.rankBadgePinnable, isPinned && styles.rankBadgePinned]}
    >
      <Text style={[styles.topRankNum, isPinned && { color: C.orange }]}>{rank}</Text>
      <Text style={[styles.topRankPinDot, isPinned && styles.topRankPinDotActive]}>📌</Text>
    </Pressable>
  ) : (
    <View style={styles.rankBadge}>
      <Text style={styles.topRankNum}>{rank}</Text>
    </View>
  );

  return (
    <AnimatedRow
      index={index}
      isNew={isNew}
      style={[styles.topShadow, { shadowColor: accent }]}
      pressableStyle={[
        styles.topCard,
        isFirst ? styles.topCardGold : { borderColor: accent + '40' },
        isPinned && styles.topCardPinned,
      ]}
    >
      {isFirst && (
        <Animated.View pointerEvents="none" style={[styles.sweepWrap, { transform: [{ translateX: sweepX }, { rotate: '18deg' }] }]}>
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.14)', 'transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.sweepGradient}
          />
        </Animated.View>
      )}

      {isNew && <Animated.View pointerEvents="none" style={[styles.landGlow, { borderColor: accent, opacity: glow }]} />}
      {isNew && (
        <Animated.View pointerEvents="none" style={[styles.landBadge, { backgroundColor: accent, opacity: badgeIn, transform: [{ scale: badgeScale }] }]}>
          <Text style={styles.landBadgeText}>LANDED HERE</Text>
        </Animated.View>
      )}

      {rankBadgeContent}

      {meal.photo_url ? (
        <Image source={{ uri: meal.photo_url }} style={styles.topImg} resizeMode="cover" />
      ) : (
        <View style={[styles.topImg, styles.topImgFallback]}>
          <Text style={styles.topEmoji}>{meal.emoji || '🍽️'}</Text>
        </View>
      )}

      <View style={styles.topNameWrap}>
        <Text style={styles.topName} numberOfLines={1}>{meal.name}</Text>
      </View>

      <View style={styles.scoreWrap}>
        <Animated.Text style={[styles.topScore, { color: accent, opacity: scoreOpacity, transform: [{ scale: scoreScale }] }]}>
          {formatScore(meal.score)}
        </Animated.Text>
        <View style={styles.scoreTrack}>
          <Animated.View style={[styles.scoreBar, { backgroundColor: accent, shadowColor: accent, width: barWidth }]} />
        </View>
      </View>
    </AnimatedRow>
  );
}

// ─── RankRow ──────────────────────────────────────────────────────────────────
// isPinned / onTogglePin are yearly-only; undefined on the monthly list.
function RankRow({ meal, rank, listIndex, isNew, onLanded, isPinned, onTogglePin }) {
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
      <View style={styles.row}>
        {rankArea}
        {meal.photo_url ? (
          <Image source={{ uri: meal.photo_url }} style={styles.rowImg} resizeMode="cover" />
        ) : (
          <View style={[styles.rowImg, styles.rowImgFallback]}>
            <Text style={styles.rowEmoji}>{meal.emoji || '🍽️'}</Text>
          </View>
        )}
        <Text style={styles.rowName} numberOfLines={1}>{meal.name}</Text>
        <Text style={styles.rowScore}>{formatScore(meal.score)}</Text>
        {isNew && (
          <Animated.View pointerEvents="none" style={[styles.rowBadge, { opacity: badgeIn, transform: [{ scale: badgeScale }] }]}>
            <Text style={styles.rowBadgeText}>NEW</Text>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

// ─── Rank reveal ──────────────────────────────────────────────────────────────
const SLOT_ITEM_H = 64;
const SLOT_VISIBLE = 5;
const SLOT_CENTER = 2;

const RANK_TIER = {
  1: { accent: '#ffd166', bg: ['#241900', '#0d0d0d'], medal: '🥇', title: 'LEGENDARY',  confetti: ['#ffd166', '#ff9e3d', '#fff', '#ffcc44', '#ffa040'] },
  2: { accent: '#d8e0ec', bg: ['#181e26', '#0d0d0d'], medal: '🥈', title: 'INCREDIBLE', confetti: ['#d8e0ec', '#a0b8cc', '#fff', '#d0ddf0'] },
  3: { accent: '#e09060', bg: ['#201000', '#0d0d0d'], medal: '🥉', title: 'IMPRESSIVE', confetti: ['#e09060', '#ff6b3d', '#fff', '#e8a87a'] },
};
function rankTier(rank) {
  if (RANK_TIER[rank]) return { ...RANK_TIER[rank], special: true };
  if (rank <= 10) return { accent: C.orange, bg: ['#1a0600', '#0d0d0d'], medal: null, title: 'TOP 10', confetti: ['#ff6b3d', '#ff9e3d', '#fff'], special: false };
  return { accent: C.gray1, bg: ['#111', '#0d0d0d'], medal: null, title: null, confetti: null, special: false };
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
        .from('meals').select('*').eq('user_id', user.id)
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
    return meals.map((meal, idx) => {
      const rank = idx + 1;
      const isTop = rank <= 5;
      return (
        <Fragment key={meal.id}>
          {rank === 6 && (
            <View>
              <View style={styles.restDivider} />
              <Text style={styles.restLabel}>The rest of the lineup</Text>
            </View>
          )}
          <DraggableRow
            mealId={meal.id}
            draggedIdShared={draggedIdShared}
            dragTranslateY={dragTranslateY}
            onLayout={e => { rowLayoutsRef.current[meal.id] = { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }; }}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            style={isTop ? [styles.topDragRow, idx < Math.min(4, meals.length - 1) && { marginBottom: 12 }] : styles.rankDragRow}
          >
            {isTop ? (
              <TopCard meal={meal} rank={rank} index={idx}
                isNew={meal.id === highlightId}
                onLanded={() => setHighlightId(cur => cur === meal.id ? null : cur)} />
            ) : (
              <RankRow meal={meal} rank={rank} listIndex={idx - 5}
                isNew={meal.id === highlightId}
                onLanded={() => setHighlightId(cur => cur === meal.id ? null : cur)} />
            )}
          </DraggableRow>
        </Fragment>
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
      const isPinned = meal._pinned === true;
      return (
        <Fragment key={meal.id}>
          <DraggableRow
            mealId={meal.id}
            draggedIdShared={draggedIdShared}
            dragTranslateY={dragTranslateY}
            onLayout={e => { rowLayoutsRef.current[meal.id] = { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }; }}
            onDragStart={handleDragStart}
            onDrop={handleDropYearly}
            style={[styles.topDragRow, idx < yearlyMeals.length - 1 && { marginBottom: 12 }]}
          >
            <TopCard meal={meal} rank={rank} index={idx} isNew={false} onLanded={null}
              isPinned={isPinned}
              onTogglePin={() => handleToggleItemPin(meal.id, rank)} />
          </DraggableRow>
        </Fragment>
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
          <Text style={styles.subheading}>
            {mode === 'monthly'
              ? `${meals.length} ${meals.length === 1 ? 'meal' : 'meals'} in ${CURRENT_MONTH_LABEL}`
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
    fontWeight: '800', fontSize: 30, color: '#f5f5f5',
    letterSpacing: -0.5, paddingHorizontal: 24, marginBottom: 16,
  },
  subheading: { fontSize: 12, color: C.rankGray, paddingHorizontal: 24, marginTop: 4, marginBottom: 26 },

  // Segmented control
  segWrap: {
    flexDirection: 'row', marginHorizontal: 24, backgroundColor: C.surface,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: C.orange },
  segBtnText: { fontWeight: '700', fontSize: 13, color: C.gray2 },
  segBtnTextActive: { color: C.white },

  // Drag
  topDragRow: { marginHorizontal: 24 },
  rankDragRow: { marginHorizontal: 16, marginBottom: 8 },
  dragHandle: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 40,
    justifyContent: 'center', alignItems: 'center', gap: 4,
  },
  handleLine: { width: 14, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.28)' },

  // Top 5 cards
  topSection: { paddingHorizontal: 24, gap: 12 },
  topShadow: { borderRadius: 20, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 6 },
  topCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, height: 80,
    paddingLeft: 16, paddingRight: 40,
    backgroundColor: C.surface, borderWidth: 1, borderRadius: 20, overflow: 'hidden',
  },
  topCardGold: { backgroundColor: '#1c1710', borderColor: 'rgba(255,209,102,0.25)' },
  topCardPinned: { borderColor: C.orange + '50' },
  sweepWrap: { position: 'absolute', top: -30, bottom: -30, width: 60 },
  sweepGradient: { flex: 1 },

  rankBadge: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  rankBadgePinnable: {
    height: 46, borderRadius: 10,
    flexDirection: 'column', justifyContent: 'center', gap: 2,
  },
  rankBadgePinned: {
    backgroundColor: 'rgba(255,107,61,0.15)',
    borderWidth: 1, borderColor: C.orange + '60',
  },
  topRankNum: { fontWeight: '800', fontSize: 16, textAlign: 'center', color: C.rankGray },
  topRankPinDot: { fontSize: 9, textAlign: 'center', opacity: 0.22 },
  topRankPinDotActive: { opacity: 1 },

  topImg: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.bg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  topImgFallback: { alignItems: 'center', justifyContent: 'center' },
  topEmoji: { fontSize: 22 },
  topNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  topName: { fontWeight: '700', fontSize: 16, color: C.white, letterSpacing: 0.2, flexShrink: 1 },
  scoreWrap: { alignItems: 'flex-end', minWidth: 46 },
  topScore: { fontWeight: '800', fontSize: 18, letterSpacing: 0.3 },
  scoreTrack: { width: 48, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  scoreBar: { height: '100%', borderRadius: 3, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 3 },

  landGlow: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderWidth: 2, borderRadius: 24 },
  landBadge: { position: 'absolute', top: -11, right: 16, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, zIndex: 5 },
  landBadgeText: { fontWeight: '800', fontSize: 10, letterSpacing: 0.8, color: '#0d0d0d' },

  // Rest section
  restLabel: {
    fontSize: 11, color: C.gray3, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', paddingHorizontal: 24, marginTop: 32, marginBottom: 14,
  },
  restDivider: { height: 1, marginHorizontal: 24, marginTop: 32, marginBottom: 16, backgroundColor: C.border },
  rowCard: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 0.5, borderColor: C.border, overflow: 'hidden' },
  rowCardPinned: { borderColor: C.orange + '50', borderWidth: 1, borderLeftWidth: 3, borderLeftColor: C.orange },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 40, paddingVertical: 12 },
  rowGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,107,61,0.13)' },
  rowBadge: { position: 'absolute', right: 14, top: -1, backgroundColor: C.orange, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  rowBadgeText: { fontWeight: '800', fontSize: 9, letterSpacing: 0.6, color: '#0d0d0d' },
  rowRankPressable: { width: 30, alignItems: 'center', justifyContent: 'center', gap: 1 },
  rowRank: { width: 30, fontWeight: '800', fontSize: 13, color: C.gray4, textAlign: 'center' },
  rowRankPinDot: { fontSize: 9, textAlign: 'center' },
  rowImg: { width: 44, height: 44, borderRadius: 11, backgroundColor: C.bg },
  rowImgFallback: { alignItems: 'center', justifyContent: 'center' },
  rowEmoji: { fontSize: 20 },
  rowName: { flex: 1, fontSize: 14, color: C.white, fontWeight: '500', letterSpacing: 0.1 },
  rowScore: { fontWeight: '700', fontSize: 14, color: C.gray2 },

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
  celebRankNum: { fontWeight: '800', fontSize: 100, letterSpacing: -5, lineHeight: 108 },
  celebTitle: { fontWeight: '800', fontSize: 16, letterSpacing: 4, marginTop: 6 },
  celebMealName: { fontSize: 16, color: C.gray1, marginTop: 20, textAlign: 'center', fontWeight: '500', paddingHorizontal: 40 },
});
