import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { FirstVisitTooltip, useFirstVisit } from '../lib/firstVisit';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', green: '#00c896', purple: '#8855cc',
  purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a', purpleText: '#ddb8ff',
  white: '#ffffff', gray1: '#888888', gray2: '#666666',
  gray3: '#555555', gray4: '#444444', gray5: '#333333',
};

const SLIDE_GRADIENT = {
  teaser:      ['#1c0d00', '#0d0d0d'],
  meals:       ['#1a0800', '#0d0d0d'],
  cuisines:    ['#001a18', '#0d0d0d'],
  streak:      ['#200400', '#0d0d0d'],
  rating:      ['#1a1400', '#0d0d0d'],
  mostLogged:  ['#0e0d1c', '#0d0d0d'],
  topRated:    ['#001a0a', '#0d0d0d'],
  personality: ['#14091f', '#0d0d0d'],
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Personality ──────────────────────────────────────────────────────────────
function getPersonality({ totalMeals, avgRating, uniqueRatio, topFoodRatio }) {
  if (totalMeals < 3) return { emoji: '🌱', name: 'The Newcomer', tagline: 'just getting started' };
  if (avgRating <= 2.5) return { emoji: '🧐', name: 'The Critic', tagline: 'tough to impress' };
  if (avgRating >= 4.5) return { emoji: '🤩', name: 'The Enthusiast', tagline: 'loves every bite' };
  if (uniqueRatio > 0.7) return { emoji: '🗺️', name: 'The Adventurer', tagline: 'never the same thing twice' };
  if (topFoodRatio >= 0.3) return { emoji: '🫶', name: 'The Loyalist', tagline: 'ride or die for the faves' };
  return { emoji: '🍴', name: 'The Foodie', tagline: 'well-rounded eater' };
}

// ─── computeWrappedStats ──────────────────────────────────────────────────────
// Pure function — takes raw meal rows and returns a serialisable stats object
// safe to store as JSON in wrapped_snapshots.stats.
export function computeWrappedStats(meals, month, year, streak = 0) {
  if (!meals || meals.length === 0) return null;

  const monthName   = MONTH_NAMES[month];
  const totalMeals  = meals.length;
  const avgRating   = meals.reduce((s, m) => s + (m.rating || 0), 0) / totalMeals;

  const topRatedMeal = meals.reduce((best, m) => {
    if (!best) return m;
    if (m.rating > best.rating) return m;
    if (m.rating === best.rating && !best.photo_url && m.photo_url) return m;
    return best;
  }, null);

  const nameCounts = {};
  meals.forEach(m => {
    const key = (m.name || '').trim().toLowerCase();
    if (key) nameCounts[key] = (nameCounts[key] || 0) + 1;
  });
  let mostLoggedFood = null, topFoodCount = 0;
  Object.entries(nameCounts).forEach(([key, count]) => {
    if (count > topFoodCount) {
      topFoodCount = count;
      mostLoggedFood = meals.find(m => (m.name || '').trim().toLowerCase() === key)?.name ?? null;
    }
  });

  const uniqueRatio  = Object.keys(nameCounts).length / totalMeals;
  const topFoodRatio = topFoodCount / totalMeals;
  const personality  = getPersonality({ totalMeals, avgRating, uniqueRatio, topFoodRatio });

  const cuisineMap = {};
  meals.forEach(m => {
    const c = (m.cuisine || '').trim();
    if (c) cuisineMap[c] = (cuisineMap[c] || 0) + 1;
  });
  const cuisineEntries = Object.entries(cuisineMap).sort((a, b) => b[1] - a[1]);
  const cuisinesCount  = cuisineEntries.length;
  const topCuisine     = cuisineEntries[0]?.[0] ?? null;

  const scoredMeals = meals.filter(m => m.score != null);
  const avgScore    = scoredMeals.length > 0
    ? scoredMeals.reduce((s, m) => s + m.score, 0) / scoredMeals.length
    : avgRating * 2;

  const bestMeal = meals.reduce((best, m) => {
    const mScore = m.score ?? (m.rating * 2) ?? 0;
    const bScore = best ? (best.score ?? (best.rating * 2) ?? 0) : -1;
    return mScore > bScore ? m : best;
  }, null);

  const lateNightMeals = meals.filter(m => {
    const h = new Date(m.created_at).getHours();
    return h >= 21 || h < 4;
  }).length;

  const DAY_NAMES  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayCounts  = [0, 0, 0, 0, 0, 0, 0];
  meals.forEach(m => { dayCounts[new Date(m.created_at).getDay()]++; });
  const topDayIdx  = dayCounts.indexOf(Math.max(...dayCounts));
  const topDay     = dayCounts[topDayIdx] > 1 ? DAY_NAMES[topDayIdx] : null;

  // Snapshot only the fields used for display so historical recaps are immutable
  const snapMeal = m => m ? {
    name: m.name, photo_url: m.photo_url, emoji: m.emoji,
    rating: m.rating, score: m.score, cuisine: m.cuisine,
  } : null;

  return {
    month, year, monthName, totalMeals, avgRating, avgScore,
    topRatedMeal: snapMeal(topRatedMeal),
    bestMeal:     snapMeal(bestMeal),
    mostLoggedFood, mostLoggedCount: topFoodCount,
    personality, cuisinesCount, topCuisine,
    streak, lateNightMeals, topDay,
  };
}

// ─── CountUpNumber ────────────────────────────────────────────────────────────
function CountUpNumber({ to, decimals = 0, style, active }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState('0');
  useEffect(() => {
    if (!active) return;
    anim.setValue(0);
    const id = anim.addListener(({ value }) => setDisplay(value.toFixed(decimals)));
    Animated.timing(anim, { toValue: to, duration: 900, useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [active, to]);
  return <Text style={style}>{display}</Text>;
}

// ─── Slide ────────────────────────────────────────────────────────────────────
function Slide({ active, direction, gradient, children, noPadding }) {
  const fade   = useRef(new Animated.Value(0)).current;
  const slideX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (active) {
      slideX.setValue((direction ?? 1) * 48);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(fade,   { toValue: 1, duration: 340, useNativeDriver: true }),
        Animated.spring(slideX, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 2 }),
      ]).start();
    }
  }, [active]);
  if (!active) return null;
  return (
    <Animated.View style={[noPadding ? styles.slideFull : styles.slide, { opacity: fade, transform: [{ translateX: slideX }] }]}>
      <LinearGradient colors={gradient ?? ['#0d0d0d', '#0d0d0d']} style={StyleSheet.absoluteFill} />
      {children}
    </Animated.View>
  );
}

// ─── ProgressBar ──────────────────────────────────────────────────────────────
function ProgressBar({ count, index }) {
  return (
    <View style={styles.progressRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: i <= index ? '100%' : '0%' }]} />
        </View>
      ))}
    </View>
  );
}

// ─── RevealSlide ──────────────────────────────────────────────────────────────
function RevealSlide({ revealed, prompt, children }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (revealed) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [revealed]);
  if (!revealed) {
    return (
      <View style={styles.revealPrompt}>
        <Text style={styles.revealPromptText}>{prompt}</Text>
        <Text style={styles.revealDots}>· · ·</Text>
        <Text style={styles.revealHint}>tap to reveal</Text>
      </View>
    );
  }
  return <Animated.View style={{ opacity: fade, alignItems: 'center' }}>{children}</Animated.View>;
}

// ─── StatCell ─────────────────────────────────────────────────────────────────
function StatCell({ value, label, sub }) {
  return (
    <View style={styles.finaleStatCell}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 1 }}>
        <Text style={styles.finaleStatNum}>{value}</Text>
        {sub ? <Text style={styles.finaleStatSub}>{sub}</Text> : null}
      </View>
      <Text style={styles.finaleStatLabel}>{label}</Text>
    </View>
  );
}

// ─── InsightPill ──────────────────────────────────────────────────────────────
function InsightPill({ icon, text }) {
  return (
    <View style={styles.insightPill}>
      <Text style={styles.insightPillIcon}>{icon}</Text>
      <Text style={styles.insightPillText}>{text}</Text>
    </View>
  );
}

// ─── WrappedShareCard ─────────────────────────────────────────────────────────
const CARD_W = 360;

function ShareCardInsightPill({ icon, text }) {
  return (
    <View style={sc.pill}>
      <Text style={sc.pillIcon}>{icon}</Text>
      <Text style={sc.pillText}>{text}</Text>
    </View>
  );
}

function WrappedShareCard({ cardRef, personality, totalMeals, avgScore, cuisinesCount, bestMeal, pills, monthName, year }) {
  return (
    <ViewShot ref={cardRef} options={{ format: 'png', quality: 1.0 }}>
      <View style={sc.card}>
        <LinearGradient
          colors={['#2d1050', '#1a0828', '#110820', '#0d0d0d']}
          locations={[0, 0.35, 0.65, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Text style={sc.kicker}>FOODWRAPPED · {monthName.toUpperCase()} {year}</Text>
        <View style={sc.hero}>
          <View style={sc.emojiBadge}><Text style={sc.emoji}>{personality.emoji}</Text></View>
          <Text style={sc.youAre}>YOU ARE</Text>
          <Text style={sc.name}>{personality.name}</Text>
          <Text style={sc.tagline}>"{personality.tagline}"</Text>
        </View>
        <View style={sc.divider} />
        <View style={sc.statsRow}>
          <View style={sc.statCell}>
            <Text style={sc.statNum}>{totalMeals}</Text>
            <Text style={sc.statLabel}>{totalMeals === 1 ? 'MEAL' : 'MEALS'}</Text>
          </View>
          <View style={sc.statSep} />
          <View style={sc.statCell}>
            <Text style={sc.statNum}>{typeof avgScore === 'number' ? avgScore.toFixed(1) : '—'}<Text style={sc.statDenom}>/10</Text></Text>
            <Text style={sc.statLabel}>AVG SCORE</Text>
          </View>
          <View style={sc.statSep} />
          <View style={sc.statCell}>
            <Text style={sc.statNum}>{cuisinesCount}</Text>
            <Text style={sc.statLabel}>{cuisinesCount === 1 ? 'CUISINE' : 'CUISINES'}</Text>
          </View>
        </View>
        <View style={sc.divider} />
        {bestMeal && (
          <View style={sc.mealSection}>
            <Text style={sc.sectionLabel}>MEAL OF THE MONTH</Text>
            <View style={sc.mealRow}>
              {bestMeal.photo_url
                ? <Image source={{ uri: bestMeal.photo_url }} style={sc.mealPhoto} resizeMode="cover" />
                : <View style={[sc.mealPhoto, sc.mealPhotoFallback]}><Text style={{ fontSize: 28 }}>{bestMeal.emoji || '🍽️'}</Text></View>
              }
              <View style={{ flex: 1 }}>
                <Text style={sc.mealName} numberOfLines={2}>{bestMeal.name}</Text>
                {bestMeal.cuisine ? <Text style={sc.mealCuisine}>{bestMeal.cuisine}</Text> : null}
              </View>
              <View style={sc.scoreBadge}>
                <Text style={sc.scoreNum}>{(bestMeal.score ?? (bestMeal.rating * 2) ?? 0).toFixed(1)}</Text>
                <Text style={sc.scoreDenom}>/10</Text>
              </View>
            </View>
          </View>
        )}
        {pills.length > 0 && (
          <View style={sc.pillsWrap}>
            {pills.map((p, i) => <ShareCardInsightPill key={i} icon={p.icon} text={p.text} />)}
          </View>
        )}
        <View style={sc.footer}><Text style={sc.footerText}>MADE WITH FOODWRAPPED</Text></View>
      </View>
    </ViewShot>
  );
}

const sc = StyleSheet.create({
  card: { width: CARD_W, paddingHorizontal: 28, paddingTop: 36, paddingBottom: 28, overflow: 'hidden' },
  kicker: { fontSize: 10, fontWeight: '700', letterSpacing: 2.5, color: '#c49aff', textAlign: 'center', marginBottom: 22, opacity: 0.85 },
  hero: { alignItems: 'center', marginBottom: 22 },
  emojiBadge: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(136,85,204,0.2)', borderWidth: 1, borderColor: 'rgba(136,85,204,0.35)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emoji: { fontSize: 32 },
  youAre: { fontSize: 11, letterSpacing: 3, color: '#c49aff', textTransform: 'uppercase', marginBottom: 4, opacity: 0.8 },
  name: { fontSize: 28, fontWeight: '800', color: '#ffffff', textAlign: 'center', letterSpacing: -0.5, lineHeight: 33 },
  tagline: { fontSize: 13, fontStyle: 'italic', color: '#ddb8ff', marginTop: 5, opacity: 0.85, textAlign: 'center' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 20 },
  statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.07)', marginBottom: 20, overflow: 'hidden' },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  statSep: { width: 0.5, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 12 },
  statNum: { fontSize: 28, fontWeight: '800', color: '#ffffff', letterSpacing: -1 },
  statDenom: { fontSize: 12, fontWeight: '600', color: '#666666' },
  statLabel: { fontSize: 8, letterSpacing: 1.5, color: '#555555', textTransform: 'uppercase', marginTop: 3, textAlign: 'center' },
  mealSection: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.06)', padding: 14, marginBottom: 16 },
  sectionLabel: { fontSize: 8.5, letterSpacing: 2, color: '#555555', textTransform: 'uppercase', fontWeight: '700', marginBottom: 10 },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mealPhoto: { width: 50, height: 50, borderRadius: 12, backgroundColor: '#1a1a1a' },
  mealPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
  mealName: { fontSize: 15, fontWeight: '700', color: '#ffffff', lineHeight: 20 },
  mealCuisine: { fontSize: 11, color: '#666666', marginTop: 2 },
  scoreBadge: { alignItems: 'flex-end' },
  scoreNum: { fontSize: 24, fontWeight: '800', color: '#FF6B3D', letterSpacing: -1 },
  scoreDenom: { fontSize: 11, fontWeight: '600', color: '#666666' },
  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 6 },
  pillIcon: { fontSize: 11 },
  pillText: { fontSize: 11, color: '#888888', fontWeight: '500' },
  footer: { alignItems: 'center', marginTop: 4 },
  footerText: { fontSize: 9, letterSpacing: 2, color: '#444444', textTransform: 'uppercase' },
});

// ─── FinaleSlide ──────────────────────────────────────────────────────────────
function FinaleSlide({
  personality, totalMeals, avgScore, bestMeal,
  mostLoggedFood, mostLoggedCount,
  cuisinesCount, topCuisine,
  streak, lateNightMeals, topDay,
  monthName, year,
  shareCardRef,
}) {
  const headerAnim   = useRef(new Animated.Value(0)).current;
  const statsAnim    = useRef(new Animated.Value(0)).current;
  const bestMealAnim = useRef(new Animated.Value(0)).current;
  const insightsAnim = useRef(new Animated.Value(0)).current;
  const glowAnim     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.spring(headerAnim, { toValue: 1, useNativeDriver: true, speed: 8, bounciness: 10 }),
        Animated.timing(glowAnim,   { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
      Animated.delay(180),
      Animated.timing(statsAnim,    { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(120),
      Animated.timing(bestMealAnim, { toValue: 1, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(80),
      Animated.timing(insightsAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const emojiScale = headerAnim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1.2, 1] });

  const pills = [
    mostLoggedFood && mostLoggedCount > 1 ? { icon: '🔄', text: `${mostLoggedFood} × ${mostLoggedCount} this month` } : null,
    topCuisine && cuisinesCount > 1        ? { icon: '🗺️', text: `Loved ${topCuisine}` }                             : null,
    streak > 1                             ? { icon: '🔥', text: `${streak}-day logging streak` }                     : null,
    lateNightMeals > 0                     ? { icon: '🌙', text: `${lateNightMeals} late-night meal${lateNightMeals > 1 ? 's' : ''}` } : null,
    topDay                                 ? { icon: '📅', text: `${topDay}s were your day` }                         : null,
  ].filter(Boolean);

  const displayScore = typeof avgScore === 'number' ? avgScore : 0;

  const [sharing, setSharing] = useState(false);
  async function handleShare() {
    if (!shareCardRef?.current) return;
    setSharing(true);
    try {
      const uri = await shareCardRef.current.capture();
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your Wrapped' });
      } else {
        Alert.alert('Sharing not available', 'Your device does not support sharing.');
      }
    } catch (e) {
      Alert.alert('Share failed', e.message || 'Could not create share image.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={{ flex: 1, width: '100%' }}>
      <Animated.View pointerEvents="none" style={[styles.finaleGlow, { opacity: glowAnim }]} />
      <ScrollView contentContainerStyle={styles.finaleContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.finaleKicker}>FOODWRAPPED · {monthName.toUpperCase()} {year}</Text>

        <Animated.View style={[styles.finalePersonality, {
          opacity: headerAnim,
          transform: [{ scale: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
        }]}>
          <Animated.Text style={[styles.finaleEmoji, { transform: [{ scale: emojiScale }] }]}>
            {personality.emoji}
          </Animated.Text>
          <Text style={styles.finaleYoure}>YOU ARE</Text>
          <Text style={styles.finaleName}>{personality.name}</Text>
          <Text style={styles.finaleTagline}>"{personality.tagline}"</Text>
        </Animated.View>

        <View style={styles.finaleLine} />

        <Animated.View style={[styles.finaleBigStats, {
          opacity: statsAnim,
          transform: [{ translateY: statsAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }]}>
          <StatCell value={String(totalMeals)} label={totalMeals === 1 ? 'MEAL' : 'MEALS'} />
          <View style={styles.finaleStatDivider} />
          <StatCell value={displayScore.toFixed(1)} label="AVG SCORE" sub="/10" />
          <View style={styles.finaleStatDivider} />
          <StatCell value={String(cuisinesCount)} label={cuisinesCount === 1 ? 'CUISINE' : 'CUISINES'} />
        </Animated.View>

        <View style={styles.finaleLine} />

        {bestMeal && (
          <Animated.View style={[styles.finaleBestWrap, {
            opacity: bestMealAnim,
            transform: [{ translateY: bestMealAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }]}>
            <Text style={styles.finaleSectionLabel}>MEAL OF THE MONTH</Text>
            <View style={styles.finaleBestRow}>
              {bestMeal.photo_url
                ? <Image source={{ uri: bestMeal.photo_url }} style={styles.finaleBestPhoto} />
                : <Text style={styles.finaleBestMealEmoji}>{bestMeal.emoji || '🍽️'}</Text>
              }
              <View style={{ flex: 1 }}>
                <Text style={styles.finaleBestName} numberOfLines={2}>{bestMeal.name}</Text>
                {bestMeal.cuisine ? <Text style={styles.finaleBestCuisine}>{bestMeal.cuisine}</Text> : null}
              </View>
              <View style={styles.finaleBestScoreWrap}>
                <Text style={styles.finaleBestScore}>{(bestMeal.score ?? bestMeal.rating * 2 ?? 0).toFixed(1)}</Text>
                <Text style={styles.finaleBestScoreDenom}>/10</Text>
              </View>
            </View>
          </Animated.View>
        )}

        {pills.length > 0 && (
          <Animated.View style={[styles.finaleInsights, {
            opacity: insightsAnim,
            transform: [{ translateY: insightsAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          }]}>
            {pills.map((p, i) => <InsightPill key={i} icon={p.icon} text={p.text} />)}
          </Animated.View>
        )}

        <Animated.View style={{ opacity: insightsAnim, marginBottom: 20 }}>
          <Pressable
            onPress={handleShare}
            disabled={sharing}
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.shareBtnIcon}>↑</Text>
            <Text style={styles.shareBtnText}>{sharing ? 'Creating…' : 'Share your Wrapped'}</Text>
          </Pressable>
        </Animated.View>

        <Animated.Text style={[styles.finaleFooter, { opacity: insightsAnim }]}>
          Made with FoodWrapped
        </Animated.Text>
      </ScrollView>
    </View>
  );
}

// ─── WrappedPlayer ────────────────────────────────────────────────────────────
// Full tap-through Wrapped experience. Accepts a stats object and an optional
// onClose callback (shown as ✕ button; also called when user taps past the last slide).
export function WrappedPlayer({ stats, onClose }) {
  const [index, setIndex]       = useState(0);
  const [revealed, setRevealed] = useState(false);
  const directionRef            = useRef(1);
  const shareCardRef            = useRef(null);
  const [tooltipVisible, dismissTooltip] = useFirstVisit('@fw_tt_wrapped');

  useEffect(() => { setRevealed(false); }, [index]);

  const {
    monthName, year, totalMeals, avgRating, avgScore, topRatedMeal, bestMeal,
    mostLoggedFood, mostLoggedCount, personality, cuisinesCount, topCuisine,
    streak, lateNightMeals, topDay,
  } = stats;

  const slides = [{ key: 'teaser' }, { key: 'meals' }];
  if (cuisinesCount > 1) slides.push({ key: 'cuisines' });
  if (streak > 0)        slides.push({ key: 'streak' });
  slides.push({ key: 'rating' });
  if (mostLoggedFood) slides.push({ key: 'mostLogged' });
  if (topRatedMeal)   slides.push({ key: 'topRated' });
  slides.push({ key: 'personality' });

  const lastIndex      = slides.length - 1;
  const safeIndex      = Math.min(index, lastIndex);
  const slide          = slides[safeIndex];
  const isRevealSlide  = slide.key === 'mostLogged' || slide.key === 'topRated';

  function handleTap() {
    if (isRevealSlide && !revealed) { setRevealed(true); return; }
    if (safeIndex >= lastIndex)     { onClose?.(); return; }
    directionRef.current = 1;
    setIndex(i => Math.min(i + 1, lastIndex));
  }

  const sharePills = [
    mostLoggedFood && mostLoggedCount > 1 ? { icon: '🔄', text: `${mostLoggedFood} × ${mostLoggedCount}` } : null,
    topCuisine && cuisinesCount > 1        ? { icon: '🗺️', text: `Loved ${topCuisine}` }                   : null,
    streak > 1                             ? { icon: '🔥', text: `${streak}-day streak` }                   : null,
    lateNightMeals > 0                     ? { icon: '🌙', text: `${lateNightMeals} late-night` }           : null,
    topDay                                 ? { icon: '📅', text: `Best on ${topDay}s` }                     : null,
  ].filter(Boolean);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.playerHeaderRow}>
        <ProgressBar count={slides.length} index={safeIndex} />
        {onClose && (
          <TouchableOpacity onPress={onClose} hitSlop={16} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {tooltipVisible && safeIndex === 0 && (
        <FirstVisitTooltip
          message="Tap anywhere to explore your monthly stats"
          onDismiss={dismissTooltip}
          style={{ bottom: 60, alignSelf: 'center' }}
        />
      )}

      <Pressable style={styles.stage} onPress={handleTap}>
        {slide.key === 'teaser' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.teaser}>
            <Text style={styles.teaserSparkle}>✨</Text>
            <Text style={styles.teaserMonth}>{monthName.toUpperCase()} {year}</Text>
            <Text style={styles.teaserTitle}>Your Wrapped{'\n'}is ready</Text>
            <Text style={styles.teaserHint}>tap anywhere to begin →</Text>
          </Slide>
        )}
        {slide.key === 'meals' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.meals}>
            <Text style={styles.bigLabel}>This month you logged</Text>
            <CountUpNumber to={totalMeals} style={styles.bigNumber} active />
            <Text style={styles.bigEmoji}>🍽️</Text>
            <Text style={styles.bigSuffix}>{totalMeals === 1 ? 'meal' : 'meals'}</Text>
          </Slide>
        )}
        {slide.key === 'cuisines' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.cuisines}>
            <Text style={styles.bigLabel}>Cuisines explored</Text>
            <CountUpNumber to={cuisinesCount} style={styles.bigNumber} active />
            <Text style={styles.bigEmoji}>🌍</Text>
            <Text style={styles.bigSuffix}>different cuisines</Text>
          </Slide>
        )}
        {slide.key === 'streak' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.streak}>
            <Text style={styles.bigLabel}>Longest streak</Text>
            <View style={styles.streakRow}>
              <CountUpNumber to={streak} style={styles.bigNumber} active />
              <Text style={styles.streakSuffix}> days</Text>
            </View>
            <Text style={styles.bigEmoji}>🔥</Text>
          </Slide>
        )}
        {slide.key === 'rating' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.rating}>
            <Text style={styles.bigLabel}>Average rating</Text>
            <CountUpNumber to={avgRating} decimals={1} style={styles.bigNumber} active />
            <Text style={styles.bigEmoji}>⭐</Text>
            <Text style={styles.subLine}>
              {avgRating >= 4 ? 'you love what you eat' : avgRating >= 3 ? 'a balanced critic' : 'tough to impress'}
            </Text>
          </Slide>
        )}
        {slide.key === 'mostLogged' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.mostLogged}>
            <RevealSlide revealed={revealed} prompt="Your most-logged food this month">
              <Text style={styles.revealEmoji}>🍴</Text>
              <Text style={styles.revealName}>{mostLoggedFood}</Text>
            </RevealSlide>
          </Slide>
        )}
        {slide.key === 'topRated' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.topRated}>
            <RevealSlide revealed={revealed} prompt="But your favorite meal was">
              {topRatedMeal?.photo_url
                ? <Image source={{ uri: topRatedMeal.photo_url }} style={styles.revealPhoto} resizeMode="cover" />
                : <View style={[styles.revealPhoto, styles.revealPhotoFallback]}><Text style={styles.revealEmoji}>{topRatedMeal?.emoji || '🍽️'}</Text></View>
              }
              <Text style={styles.revealName}>{topRatedMeal?.name}</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Text key={i} style={[styles.star, { color: i <= (topRatedMeal?.rating || 0) ? C.orange : C.gray5 }]}>★</Text>
                ))}
              </View>
            </RevealSlide>
          </Slide>
        )}
        {slide.key === 'personality' && (
          <Slide active direction={directionRef.current} gradient={SLIDE_GRADIENT.personality} noPadding>
            <FinaleSlide
              personality={personality} totalMeals={totalMeals} avgScore={avgScore}
              bestMeal={bestMeal} mostLoggedFood={mostLoggedFood} mostLoggedCount={mostLoggedCount}
              cuisinesCount={cuisinesCount} topCuisine={topCuisine}
              streak={streak} lateNightMeals={lateNightMeals} topDay={topDay}
              monthName={monthName} year={year}
              shareCardRef={shareCardRef}
            />
          </Slide>
        )}
      </Pressable>

      <View style={{ position: 'absolute', left: -10000, top: 0 }} pointerEvents="none" collapsable={false}>
        <WrappedShareCard
          cardRef={shareCardRef} personality={personality}
          totalMeals={totalMeals} avgScore={avgScore}
          cuisinesCount={cuisinesCount} bestMeal={bestMeal}
          pills={sharePills} monthName={monthName} year={year}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── WrappedScreen (default export) ──────────────────────────────────────────
// Thin wrapper: loads current-month data and hands it to WrappedPlayer.
// No longer used as a tab; kept for backwards compatibility.
export default function WrappedScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [loadKey, setLoadKey] = useState(0);
  const [stats, setStats]     = useState(null);

  useEffect(() => {
    async function load() {
      setError(null);
      setLoading(true);
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) return;

        const now              = new Date();
        const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

        const { data: meals, error: fetchError } = await supabase
          .from('meals').select('*').eq('user_id', user.id)
          .gte('created_at', startOfMonth).lt('created_at', startOfNextMonth);
        if (fetchError) throw fetchError;

        if (meals && meals.length > 0) {
          let streak = 0;
          try {
            const { data: sd, error: se } = await supabase.rpc('get_user_streak', { uid: user.id });
            if (!se && typeof sd === 'number') streak = sd;
          } catch {}
          setStats(computeWrappedStats(meals, now.getMonth(), now.getFullYear(), streak));
        } else {
          setStats(null);
        }
      } catch (err) {
        setError(err.message || 'Failed to load your Wrapped. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadKey]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}><ActivityIndicator color={C.orange} /></View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>⚠️</Text>
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptySub}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setLoadKey(k => k + 1)} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!stats) {
    const monthName = MONTH_NAMES[new Date().getMonth()];
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyTitle}>No {monthName} Wrapped yet</Text>
          <Text style={styles.emptySub}>Log a few meals this month and your recap will show up here.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return <WrappedPlayer stats={stats} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  emptyEmoji:   { fontSize: 48, marginBottom: 16 },
  emptyTitle:   { fontWeight: '700', fontSize: 20, color: C.white, marginBottom: 8, textAlign: 'center' },
  emptySub:     { fontSize: 14, color: C.gray1, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  retryBtn:     { backgroundColor: C.orange, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13 },
  retryBtnText: { fontSize: 15, fontWeight: '700', color: C.white },

  playerHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  closeBtn:     { paddingHorizontal: 14, paddingVertical: 10 },
  closeBtnText: { fontSize: 16, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },

  progressRow:   { flex: 1, flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  progressTrack: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: C.orange, borderRadius: 2 },

  stage:     { flex: 1 },
  slide:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  slideFull: { flex: 1 },

  teaserSparkle: { fontSize: 64, marginBottom: 12 },
  teaserMonth:   { fontSize: 11, fontWeight: '700', letterSpacing: 2.5, color: C.orange, marginBottom: 14 },
  teaserTitle:   { fontWeight: '800', fontSize: 38, color: C.white, textAlign: 'center', lineHeight: 46, letterSpacing: -0.5 },
  teaserHint:    { fontSize: 14, color: C.gray2, marginTop: 32, letterSpacing: 0.3 },

  bigLabel:  { fontSize: 13, color: C.gray1, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: '600' },
  bigNumber: { fontWeight: '800', fontSize: 80, color: C.white, letterSpacing: -2 },
  bigEmoji:  { fontSize: 44, marginTop: 10 },
  bigSuffix: { fontSize: 16, color: C.gray2, marginTop: 8, letterSpacing: 0.3 },
  subLine:   { fontSize: 15, color: C.gray2, marginTop: 20, fontStyle: 'italic', textAlign: 'center' },
  streakRow:    { flexDirection: 'row', alignItems: 'baseline' },
  streakSuffix: { fontWeight: '800', fontSize: 38, color: C.white, letterSpacing: -1 },

  revealPrompt:     { alignItems: 'center', justifyContent: 'center', flex: 1, width: '100%' },
  revealPromptText: { fontWeight: '700', fontSize: 22, color: C.white, textAlign: 'center' },
  revealDots:       { fontSize: 36, color: C.gray2, marginTop: 12, letterSpacing: 4 },
  revealHint:       { fontSize: 13, color: C.gray3, marginTop: 28 },
  revealEmoji:      { fontSize: 48, marginBottom: 12 },
  revealName:       { fontWeight: '800', fontSize: 26, color: C.white, textAlign: 'center', marginBottom: 10 },
  revealPhoto:      { width: 180, height: 180, borderRadius: 20, backgroundColor: C.surface, marginBottom: 16 },
  revealPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
  starsRow: { flexDirection: 'row', gap: 4 },
  star:     { fontSize: 20 },

  finaleGlow: { position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: C.purple, opacity: 0.14, top: '8%', alignSelf: 'center', zIndex: 0 },
  finaleContent:     { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 44 },
  finaleKicker:      { fontSize: 10, fontWeight: '700', letterSpacing: 2.5, color: C.purple, textAlign: 'center', marginBottom: 24, opacity: 0.75 },
  finalePersonality: { alignItems: 'center', marginBottom: 24 },
  finaleEmoji:       { fontSize: 80, marginBottom: 14 },
  finaleYoure:       { fontSize: 11, color: C.gray2, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 5 },
  finaleName:        { fontWeight: '800', fontSize: 32, color: C.white, textAlign: 'center', letterSpacing: -0.5, lineHeight: 38 },
  finaleTagline:     { fontSize: 14, color: C.purpleText, fontStyle: 'italic', marginTop: 7, textAlign: 'center', opacity: 0.85 },
  finaleLine:        { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 24 },

  finaleBigStats:    { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 24, overflow: 'hidden' },
  finaleStatCell:    { flex: 1, alignItems: 'center', paddingVertical: 18 },
  finaleStatDivider: { width: 0.5, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 14 },
  finaleStatNum:     { fontWeight: '800', fontSize: 34, color: C.white, letterSpacing: -1 },
  finaleStatSub:     { fontSize: 13, color: C.gray2, fontWeight: '600', paddingBottom: 2 },
  finaleStatLabel:   { fontSize: 9, color: C.gray3, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4, textAlign: 'center' },

  finaleBestWrap:       { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.06)', padding: 16, marginBottom: 16 },
  finaleSectionLabel:   { fontSize: 9, color: C.gray3, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 12 },
  finaleBestRow:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  finaleBestPhoto:      { width: 52, height: 52, borderRadius: 12, backgroundColor: C.surface },
  finaleBestMealEmoji:  { fontSize: 40 },
  finaleBestName:       { fontWeight: '700', fontSize: 16, color: C.white, lineHeight: 21 },
  finaleBestCuisine:    { fontSize: 12, color: C.gray2, marginTop: 2 },
  finaleBestScoreWrap:  { alignItems: 'flex-end' },
  finaleBestScore:      { fontWeight: '800', fontSize: 30, color: C.orange, letterSpacing: -1 },
  finaleBestScoreDenom: { fontSize: 12, color: C.gray2, fontWeight: '600' },

  finaleInsights: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  insightPill:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.045)', borderRadius: 20, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 8 },
  insightPillIcon: { fontSize: 13 },
  insightPillText: { fontSize: 12, color: C.gray1, fontWeight: '500' },

  finaleFooter:  { fontSize: 10, color: C.gray4, letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' },
  shareBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.purple, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 24 },
  shareBtnIcon:  { fontSize: 16, color: C.white },
  shareBtnText:  { fontSize: 15, fontWeight: '700', color: C.white, letterSpacing: 0.2 },
});
