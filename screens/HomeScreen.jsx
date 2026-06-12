import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  SafeAreaView,
  StatusBar,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { loadNotifPrefs, getPermissionStatus, syncStreakRiskNotification } from '../lib/notifications';
import { useFirstVisit } from '../lib/firstVisit';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Theme ───────────────────────────────────────────────────────────────────
const C = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  border: '#2a2a2a',
  orange: '#FF6B3D',
  green: '#00c896',
  greenDim: '#0a2820',
  greenBorder: '#1a3a34',
  greenText: '#4a8a7a',
  purple: '#8855cc',
  purpleDim: '#1a0d1a',
  purpleBorder: '#3a2a4a',
  purpleText: '#ddb8ff',
  white: '#ffffff',
  gray1: '#888888',
  gray2: '#666666',
  gray3: '#555555',
  gray4: '#444444',
  gray5: '#333333',
};

const WRAPPED_THRESHOLD = 5; // meals needed before Wrapped is unlockable

// ─── Timezone-safe helpers ────────────────────────────────────────────────────

// Returns YYYY-MM-DD for any Date using the device's local timezone.
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Returns the ISO string of local midnight (so Supabase gte/lte comparisons are timezone-correct).
function localMidnightISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Compute streak, loggedToday, and last-7-days booleans from a list of { created_at } rows.
// All grouping is done in the device's local timezone.
function computeStreakData(rows) {
  if (!rows || rows.length === 0) {
    return { streak: 0, loggedToday: false, last7Days: Array(7).fill(false) };
  }

  const dateSet = new Set(rows.map((r) => localDateKey(new Date(r.created_at))));

  const todayKey = localDateKey(new Date());
  const loggedToday = dateSet.has(todayKey);

  // Walk back from today (or yesterday if not yet logged today).
  let streak = 0;
  const cursor = new Date();
  if (!loggedToday) cursor.setDate(cursor.getDate() - 1);
  while (dateSet.has(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Last 7 days: index 0 = 6 days ago, index 6 = today.
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return dateSet.has(localDateKey(d));
  });

  return { streak, loggedToday, last7Days };
}

// ─── Mock data kept for ad/coupon sections (not yet implemented) ──────────────
const MOCK_SPONSORED = {
  id: 'sp1',
  businessName: 'Shake Shack',
  businessEmoji: '🍔',
  title: 'The new Truffle Smash Burger is here',
  description:
    'Crispy smash patty, black truffle aioli, aged cheddar. Now at all Phoenix locations.',
  emoji: '🍔',
  bgColor: '#0f1a10',
};

const MOCK_COUPONS = [
  {
    id: 'c1',
    title: 'Free chips & salsa',
    businessName: 'Taco Loco PHX',
    discount: 'FREE',
    code: 'FW2024',
    expiry: 'Jun 12',
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRating({ rating, size = 10 }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text
          key={i}
          style={[styles.star, { fontSize: size, color: i <= rating ? C.orange : C.gray5 }]}
        >
          ★
        </Text>
      ))}
    </View>
  );
}

function PersonalMealCard({ meal }) {
  return (
    <View style={styles.mealCard}>
      <View style={[styles.mealImgBox, { backgroundColor: meal.bgColor }]}>
        <Text style={styles.mealEmoji}>{meal.emoji}</Text>
      </View>
      <View style={styles.mealBody}>
        <Text style={styles.mealName} numberOfLines={2}>{meal.name}</Text>
        <View style={styles.mealMeta}>
          <Text style={styles.mealTime}>{meal.time}</Text>
          <StarRating rating={meal.rating} />
        </View>
      </View>
    </View>
  );
}

function BusinessMealCard({ meal }) {
  return (
    <View style={[styles.mealCard, styles.bizMealCard]}>
      <View style={[styles.mealImgBox, { backgroundColor: meal.bgColor }]}>
        <Text style={styles.mealEmoji}>{meal.emoji}</Text>
        <View style={styles.bizBadge}>
          <Text style={styles.bizBadgeText}>Logged here</Text>
        </View>
      </View>
      <View style={styles.mealBody}>
        <Text style={styles.mealName} numberOfLines={1}>{meal.name}</Text>
        <Text style={styles.bizSource}>{meal.businessName}</Text>
        <View style={styles.mealMeta}>
          <Text style={styles.mealTime}>{meal.time}</Text>
          <StarRating rating={meal.rating} />
        </View>
      </View>
    </View>
  );
}

function MealCard({ meal }) {
  if (meal.type === 'business') return <BusinessMealCard meal={meal} />;
  return <PersonalMealCard meal={meal} />;
}

// One-time nudge to enable notifications, shown after the user has at least one meal.
function NotifNudge({ onEnable, onDismiss }) {
  return (
    <View style={styles.notifNudge}>
      <View style={styles.notifNudgeLeft}>
        <Text style={styles.notifNudgeTitle}>Get meal reminders</Text>
        <Text style={styles.notifNudgeSub}>Never miss a day — keep your streak going.</Text>
      </View>
      <View style={styles.notifNudgeBtns}>
        <TouchableOpacity style={styles.notifNudgeEnable} onPress={onEnable} activeOpacity={0.8}>
          <Text style={styles.notifNudgeEnableText}>Enable</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.notifNudgeDismiss}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Streak banner: flame, day count, and 7-dot history.
// Dots show the last 7 days (index 0 = oldest, 6 = today).
// If the streak is alive but the user hasn't logged today, the today dot pulses with a ring.
function StreakBanner({ streak, loggedToday, last7Days }) {
  const alive = streak > 0;

  return (
    <View style={styles.streakBanner}>
      <View style={styles.streakLeft}>
        {alive
          ? <Text style={styles.streakFlame}>🔥</Text>
          : <Ionicons name="moon-outline" size={22} color={C.gray3} style={{ width: 28 }} />
        }
        <View>
          <Text style={styles.streakLabel}>
            {alive ? 'Day streak' : 'Start your streak'}
          </Text>
          <Text style={[styles.streakCount, !alive && { color: C.gray2, fontSize: 14 }]}>
            {alive
              ? `${streak} day${streak !== 1 ? 's' : ''}`
              : 'Log a meal today'}
          </Text>
        </View>
      </View>

      <View style={styles.streakRight}>
        <View style={styles.streakDots}>
          {last7Days.map((logged, i) => {
            const isToday = i === 6;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  logged && styles.dotActive,
                  isToday && !loggedToday && styles.dotTodayRing,
                ]}
              />
            );
          })}
        </View>
        {alive && !loggedToday && (
          <Text style={styles.streakWarning}>Log today to keep it!</Text>
        )}
      </View>
    </View>
  );
}

function SponsoredBanner({ ad, onLogAndTry, onDismiss }) {
  return (
    <View style={styles.adBanner}>
      <View style={styles.adHeader}>
        <View style={styles.adBizRow}>
          <View style={styles.adLogo}>
            <Text style={{ fontSize: 14 }}>{ad.businessEmoji}</Text>
          </View>
          <View>
            <Text style={styles.adBizName}>{ad.businessName}</Text>
            <Text style={styles.adSponsored}>Sponsored</Text>
          </View>
        </View>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.adClose}>✕</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.adImg, { backgroundColor: ad.bgColor }]}>
        <Text style={{ fontSize: 50 }}>{ad.emoji}</Text>
      </View>
      <View style={styles.adBody}>
        <Text style={styles.adTitle}>{ad.title}</Text>
        <Text style={styles.adDesc}>{ad.description}</Text>
        <View style={styles.adFooter}>
          <TouchableOpacity style={styles.adCta} onPress={onLogAndTry}>
            <Text style={styles.adCtaText}>Log &amp; try it</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss}>
            <Text style={styles.adDismiss}>Not interested</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function CouponCard({ coupon }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <TouchableOpacity style={styles.coupon} activeOpacity={0.85} onPress={handleCopy}>
      <View style={styles.couponStripe} />
      <View style={styles.couponIcon}>
        <Text style={{ fontSize: 22 }}>🎟️</Text>
      </View>
      <View style={styles.couponText}>
        <Text style={styles.couponTag}>Coupon · expires {coupon.expiry}</Text>
        <Text style={styles.couponTitle}>{coupon.title}</Text>
        <Text style={styles.couponBiz}>{coupon.businessName} · tap to copy code</Text>
      </View>
      <View style={styles.couponRight}>
        <Text style={styles.couponAmount}>{coupon.discount}</Text>
        <View style={styles.couponCodeBox}>
          <Text style={styles.couponCode}>{copied ? 'COPIED!' : coupon.code}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function StatCard({ iconName, iconColor, value, label }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={iconName} size={18} color={iconColor || C.gray1} style={{ marginBottom: 6 }} />
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// Wrapped tease: shows whenever the user has logged ≥1 meal this month.
// Becomes tappable (and says "ready") once they hit WRAPPED_THRESHOLD.
function WrappedTeaser({ mealsThisMonth, monthName, onPress }) {
  if (mealsThisMonth === 0) return null;

  const ready = mealsThisMonth >= WRAPPED_THRESHOLD;
  const remaining = WRAPPED_THRESHOLD - mealsThisMonth;

  return (
    <TouchableOpacity
      style={styles.wrappedTeaser}
      activeOpacity={ready ? 0.82 : 1}
      onPress={ready ? onPress : undefined}
    >
      <View style={styles.wrappedArt}>
        <Ionicons
          name={ready ? 'film-outline' : 'hourglass-outline'}
          size={26}
          color={ready ? '#ddb8ff' : C.gray2}
        />
      </View>
      <View style={styles.wrappedText}>
        <Text style={styles.wrappedLabel}>{ready ? 'READY TO VIEW' : 'BUILDING'}</Text>
        <Text style={styles.wrappedTitle}>
          {ready
            ? `Your ${monthName} Wrapped is ready`
            : `Your ${monthName} Wrapped is building`}
        </Text>
        <Text style={styles.wrappedSub}>
          {ready
            ? 'Tap to see your story →'
            : `${remaining} more meal${remaining !== 1 ? 's' : ''} to unlock`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function HomeScreen() {
  const navigation = useNavigation();

  // Auth / profile
  const [userName, setUserName] = useState('');

  // Today's meal cards
  const [meals, setMeals] = useState([]);
  const [mealsLoading, setMealsLoading] = useState(true);

  // Streak & today state
  const [streak, setStreak] = useState(0);
  const [loggedToday, setLoggedToday] = useState(false);
  const [last7Days, setLast7Days] = useState(Array(7).fill(false));

  // This-month stats
  const [mealsThisMonth, setMealsThisMonth] = useState(0);
  const [avgScore, setAvgScore] = useState(null);

  // Ad / coupons (still mock-backed)
  const [sponsored, setSponsored] = useState(MOCK_SPONSORED);
  const [coupons, setCoupons] = useState(MOCK_COUPONS);
  const [showAd, setShowAd] = useState(true);

  // Notification nudge (shown once after the user has ≥1 meal and hasn't set up notifs)
  const [notifNudgeVisible, dismissNotifNudge] = useFirstVisit('@fw_notif_nudge_v1');
  const [notifPermStatus, setNotifPermStatus] = useState('undetermined');

  const monthName = MONTH_NAMES[new Date().getMonth()];

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Run independent queries in parallel.
      const todayStart = localMidnightISO();
      const monthStart = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
      ).toISOString();

      const [
        profileResult,
        todayResult,
        streakResult,
        monthResult,
        couponResult,
        adResult,
      ] = await Promise.allSettled([
        supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .single(),

        supabase
          .from('meals')
          .select('id, name, emoji, score, rating, created_at, business_id, businesses(name)')
          .eq('user_id', user.id)
          .gte('created_at', todayStart)
          .order('created_at', { ascending: true }),

        supabase
          .from('meals')
          .select('created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500),

        supabase
          .from('meals')
          .select('score')
          .eq('user_id', user.id)
          .gte('created_at', monthStart),

        supabase
          .from('coupons')
          .select('*, businesses(name)')
          .gt('expires_at', new Date().toISOString())
          .eq('active', true)
          .limit(3),

        supabase
          .from('sponsored_posts')
          .select('*, businesses(name, emoji)')
          .eq('active', true)
          .limit(1)
          .single(),
      ]);

      // Profile
      if (profileResult.status === 'fulfilled') {
        const p = profileResult.value.data;
        if (p?.display_name) setUserName(p.display_name);
      }

      // Today's meals
      if (todayResult.status === 'fulfilled') {
        const data = todayResult.value.data || [];
        setMeals(data.map((m) => ({
          id: m.id,
          type: m.business_id ? 'business' : 'personal',
          name: m.name,
          emoji: m.emoji || '🍽️',
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          rating: m.rating,
          bgColor: '#1a1a1a',
          businessName: m.businesses?.name,
        })));
      }

      // Streak (client-side, timezone-aware)
      if (streakResult.status === 'fulfilled') {
        const { streak: s, loggedToday: lt, last7Days: l7 } =
          computeStreakData(streakResult.value.data || []);
        setStreak(s);
        setLoggedToday(lt);
        setLast7Days(l7);
      }

      // This-month stats
      if (monthResult.status === 'fulfilled') {
        const data = monthResult.value.data || [];
        setMealsThisMonth(data.length);
        if (data.length > 0) {
          const total = data.reduce((sum, m) => sum + (m.score ?? 5), 0);
          setAvgScore(total / data.length);
        }
      }

      // Coupons
      if (couponResult.status === 'fulfilled' && couponResult.value.data?.length) {
        setCoupons(
          couponResult.value.data.map((c) => ({
            id: c.id,
            title: c.title,
            businessName: c.businesses?.name,
            discount: c.discount_label,
            code: c.code,
            expiry: new Date(c.expires_at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
          }))
        );
      }

      // Sponsored ad
      if (adResult.status === 'fulfilled' && adResult.value.data) {
        const ad = adResult.value.data;
        setSponsored({
          id: ad.id,
          businessName: ad.businesses?.name,
          businessEmoji: ad.businesses?.emoji || '🍽️',
          title: ad.title,
          description: ad.description,
          emoji: ad.image_emoji || '🍽️',
          bgColor: '#0f1a10',
        });
      }

      // Sync streak-risk notification and check permission status for nudge.
      const [prefs, permStatus] = await Promise.all([
        loadNotifPrefs(),
        getPermissionStatus(),
      ]);
      setNotifPermStatus(permStatus);
      if (prefs.enabled && permStatus === 'granted') {
        const { streak: s, loggedToday: lt } = computeStreakData(
          streakResult.status === 'fulfilled' ? (streakResult.value.data || []) : []
        );
        syncStreakRiskNotification(s, lt).catch(() => {});
      }
    } catch {
      // Non-fatal: stale data is better than a crash.
    } finally {
      setMealsLoading(false);
    }
  }, []);

  // Refresh every time this tab comes into focus so a freshly-logged meal shows up.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.title}>
            What are you{'\n'}eating,{' '}
            <Text style={styles.titleAccent}>{userName || 'friend'}?</Text>
          </Text>
        </View>

        {/* Streak */}
        <StreakBanner streak={streak} loggedToday={loggedToday} last7Days={last7Days} />

        {/* Notification nudge — one-time, shown once user has meals and hasn't enabled notifs */}
        {notifNudgeVisible &&
          notifPermStatus === 'undetermined' &&
          (streak > 0 || mealsThisMonth > 0) && (
          <NotifNudge
            onEnable={() => navigation.navigate('Account')}
            onDismiss={dismissNotifNudge}
          />
        )}

        {/* Today's meals */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's meals</Text>
          <TouchableOpacity onPress={() => navigation.navigate('History')}>
            <Text style={styles.sectionAction}>see all</Text>
          </TouchableOpacity>
        </View>

        {mealsLoading ? (
          <View style={styles.mealsLoadingBox}>
            <ActivityIndicator color={C.orange} size="small" />
          </View>
        ) : meals.length === 0 ? (
          <View style={styles.todayEmpty}>
            <Ionicons name="restaurant-outline" size={20} color={C.gray3} />
            <Text style={styles.todayEmptyText}>Nothing logged yet today</Text>
          </View>
        ) : (
          <FlatList
            data={meals}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MealCard meal={item} />}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mealsScrollPadding}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            scrollEnabled
          />
        )}

        {/* Log meal CTA — copy changes depending on whether user has logged today */}
        <TouchableOpacity
          style={styles.logBtn}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('LogMeal')}
        >
          <View style={styles.logLeft}>
            <View style={styles.logIcon}>
              <Ionicons name="camera" size={22} color={C.white} />
            </View>
            <View>
              <Text style={styles.logLabel}>Log a meal</Text>
              <Text style={styles.logSub}>
                {loggedToday
                  ? 'Keep the streak going!'
                  : "You haven't logged today yet"}
              </Text>
            </View>
          </View>
          <Text style={styles.logArrow}>→</Text>
        </TouchableOpacity>

        {/* Sponsored ad */}
        {showAd && sponsored && (
          <SponsoredBanner
            ad={sponsored}
            onLogAndTry={() => navigation.navigate('LogMeal', { sponsored })}
            onDismiss={() => setShowAd(false)}
          />
        )}

        {/* Coupons */}
        {coupons.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Deals near you</Text>
            </View>
            {coupons.map((c) => (
              <CouponCard key={c.id} coupon={c} />
            ))}
          </>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard
            iconName="restaurant-outline"
            iconColor={C.orange}
            value={mealsThisMonth}
            label="this month"
          />
          <StatCard
            iconName="star-outline"
            iconColor="#ffd166"
            value={avgScore != null ? avgScore.toFixed(1) : '—'}
            label="avg score"
          />
          <StatCard
            iconName="flame-outline"
            iconColor={C.orange}
            value={streak}
            label="day streak"
          />
        </View>

        {/* Wrapped tease */}
        <WrappedTeaser
          mealsThisMonth={mealsThisMonth}
          monthName={monthName}
          onPress={() => navigation.navigate('Recaps')}
        />

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  // Header
  header: { paddingHorizontal: 24, paddingTop: 8 },
  greeting: { fontSize: 13, color: C.gray1, marginBottom: 2 },
  title: { fontFamily: 'Syne_800ExtraBold', fontSize: 28, color: C.white, letterSpacing: -0.5, lineHeight: 34 },
  titleAccent: { color: C.orange },

  // Streak
  streakBanner: {
    marginHorizontal: 24,
    marginTop: 16,
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  streakLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streakFlame: { fontSize: 22 },
  streakLabel: { fontSize: 12, color: C.gray2 },
  streakCount: { fontFamily: 'Syne_800ExtraBold', fontSize: 18, color: C.orange },
  streakRight: { alignItems: 'flex-end', gap: 4 },
  streakDots: { flexDirection: 'row', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dotActive: { backgroundColor: C.orange },
  // Today's dot gets a ring when the streak is alive but today is not yet logged
  dotTodayRing: {
    borderWidth: 1.5,
    borderColor: C.orange,
    backgroundColor: 'transparent',
  },
  streakWarning: { fontSize: 11, color: C.orange, fontWeight: '600', opacity: 0.85 },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: { fontFamily: 'Syne_700Bold', fontSize: 16, color: C.white },
  sectionAction: { fontSize: 13, color: C.orange, fontWeight: '500' },

  // Meal cards
  mealsLoadingBox: { paddingHorizontal: 24, paddingVertical: 20, alignItems: 'flex-start' },
  mealsScrollPadding: { paddingHorizontal: 24 },
  mealCard: { width: 150, backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border, borderRadius: 16, overflow: 'hidden' },
  bizMealCard: { width: 160, borderColor: '#2a3a2a' },
  mealImgBox: { width: '100%', height: 100, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  mealEmoji: { fontSize: 40 },
  bizBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: '#0a2a0a', borderWidth: 0.5, borderColor: '#1a4a1a', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  bizBadgeText: { fontSize: 10, color: '#4caf50', fontWeight: '500' },
  mealBody: { padding: 10, paddingHorizontal: 12 },
  mealName: { fontSize: 13, fontWeight: '500', color: C.white, lineHeight: 18, marginBottom: 4 },
  bizSource: { fontSize: 11, color: '#4caf50', marginBottom: 4 },
  mealMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mealTime: { fontSize: 11, color: C.gray3 },
  starsRow: { flexDirection: 'row', gap: 1 },
  star: {},

  // Today empty state
  todayEmpty: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  todayEmptyText: { fontSize: 14, color: C.gray2 },

  // Log CTA
  logBtn: { marginHorizontal: 24, marginTop: 20, backgroundColor: C.orange, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logIcon: { width: 40, height: 40, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logLabel: { fontFamily: 'Syne_700Bold', fontSize: 16, color: C.white },
  logSub: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  logArrow: { fontSize: 20, color: 'rgba(255,255,255,0.7)' },

  // Sponsored ad
  adBanner: { marginHorizontal: 24, marginTop: 20, backgroundColor: '#111', borderWidth: 0.5, borderColor: C.border, borderRadius: 16, overflow: 'hidden' },
  adHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingBottom: 8 },
  adBizRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adLogo: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#1a2a1a', alignItems: 'center', justifyContent: 'center' },
  adBizName: { fontSize: 13, fontWeight: '500', color: C.white },
  adSponsored: { fontSize: 10, color: C.gray3 },
  adClose: { fontSize: 14, color: C.gray4 },
  adImg: { width: '100%', height: 120, alignItems: 'center', justifyContent: 'center' },
  adBody: { padding: 14 },
  adTitle: { fontFamily: 'Syne_700Bold', fontSize: 15, color: C.white, marginBottom: 4 },
  adDesc: { fontSize: 12, color: C.gray2, lineHeight: 18, marginBottom: 10 },
  adFooter: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  adCta: { backgroundColor: C.orange, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  adCtaText: { fontSize: 13, fontWeight: '500', color: C.white },
  adDismiss: { fontSize: 13, color: C.gray4 },

  // Coupon
  coupon: { marginHorizontal: 24, marginTop: 12, backgroundColor: C.greenDim, borderWidth: 0.5, borderColor: C.greenBorder, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, position: 'relative', overflow: 'hidden' },
  couponStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C.green, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  couponIcon: { width: 44, height: 44, backgroundColor: '#0a2820', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  couponText: { flex: 1 },
  couponTag: { fontSize: 10, color: C.green, fontWeight: '500', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  couponTitle: { fontSize: 14, fontWeight: '500', color: C.white, marginBottom: 1 },
  couponBiz: { fontSize: 12, color: C.greenText },
  couponRight: { alignItems: 'flex-end' },
  couponAmount: { fontFamily: 'Syne_800ExtraBold', fontSize: 20, color: C.green },
  couponCodeBox: { marginTop: 4, backgroundColor: '#0a2820', borderWidth: 0.5, borderStyle: 'dashed', borderColor: '#1a5a4a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  couponCode: { fontSize: 11, color: C.green, fontWeight: '500', letterSpacing: 1 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, marginTop: 20 },
  statCard: { flex: 1, backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border, borderRadius: 14, padding: 14 },
  statNum: { fontFamily: 'Syne_800ExtraBold', fontSize: 22, color: C.white, lineHeight: 24 },
  statLabel: { fontSize: 11, color: C.gray3, marginTop: 3 },

  // Wrapped teaser
  wrappedTeaser: { marginHorizontal: 24, marginTop: 20, backgroundColor: C.purpleDim, borderWidth: 0.5, borderColor: C.purpleBorder, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  wrappedArt: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#2a1a3a', alignItems: 'center', justifyContent: 'center' },
  wrappedText: { flex: 1 },
  wrappedLabel: { fontSize: 10, color: C.purple, fontWeight: '500', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 },
  wrappedTitle: { fontFamily: 'Syne_700Bold', fontSize: 15, color: C.purpleText, lineHeight: 20 },
  wrappedSub: { fontSize: 12, color: '#6644aa', marginTop: 2 },

  // Notification nudge
  notifNudge: {
    marginHorizontal: 24,
    marginTop: 14,
    backgroundColor: '#0d1a0d',
    borderWidth: 0.5,
    borderColor: '#1a3a1a',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notifNudgeLeft: { flex: 1 },
  notifNudgeTitle: { fontSize: 13, fontWeight: '600', color: C.white, marginBottom: 2 },
  notifNudgeSub: { fontSize: 12, color: C.gray2 },
  notifNudgeBtns: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  notifNudgeEnable: {
    backgroundColor: C.orange,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  notifNudgeEnableText: { fontSize: 12, fontWeight: '600', color: C.white },
  notifNudgeDismiss: { fontSize: 14, color: C.gray3 },
});
