import { useEffect, useState } from 'react';
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase'; // adjust path as needed

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

// ─── Mock data (replace with Supabase queries) ────────────────────────────────
const MOCK_MEALS = [
  {
    id: '1',
    type: 'personal',
    name: 'Blueberry pancakes',
    emoji: '🥞',
    time: '8:15 AM',
    rating: 4,
    bgColor: '#1e1510',
  },
  {
    id: '2',
    type: 'business',
    name: 'Birria tacos',
    emoji: '🌮',
    time: '1:00 PM',
    rating: 5,
    bgColor: '#0f1a0f',
    businessName: 'Taco Loco PHX',
  },
  {
    id: '3',
    type: 'personal',
    name: 'Spicy tuna roll',
    emoji: '🍣',
    time: '7:00 PM',
    rating: 5,
    bgColor: '#151018',
  },
];

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

const MOCK_STATS = {
  mealsThisMonth: 47,
  avgRating: 4.2,
  cityRank: 3,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRating({ rating, size = 10 }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text
          key={i}
          style={[
            styles.star,
            { fontSize: size, color: i <= rating ? C.orange : C.gray5 },
          ]}
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
        <Text style={styles.mealName} numberOfLines={2}>
          {meal.name}
        </Text>
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
          <Text style={styles.bizBadgeText}>📍 Logged here</Text>
        </View>
      </View>
      <View style={styles.mealBody}>
        <Text style={styles.mealName} numberOfLines={1}>
          {meal.name}
        </Text>
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

function StreakBanner({ streak }) {
  const days = Math.min(streak, 7);
  return (
    <View style={styles.streakBanner}>
      <View style={styles.streakLeft}>
        <Text style={styles.streakFlame}>🔥</Text>
        <View>
          <Text style={styles.streakLabel}>Current streak</Text>
          <Text style={styles.streakCount}>{streak} days</Text>
        </View>
      </View>
      <View style={styles.streakDots}>
        {[...Array(7)].map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < days && styles.dotActive]}
          />
        ))}
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
    // Replace with Clipboard.setString(coupon.code) if expo-clipboard is installed
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

function StatCard({ emoji, value, label }) {
  return (
    <View style={styles.statCard}>
      <Text style={{ fontSize: 18, marginBottom: 6 }}>{emoji}</Text>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function WrappedTeaser({ mealsRemaining }) {
  return (
    <View style={styles.wrappedTeaser}>
      <View style={styles.wrappedArt}>
        <Text style={{ fontSize: 26 }}>✨</Text>
      </View>
      <View style={styles.wrappedText}>
        <Text style={styles.wrappedLabel}>Coming soon</Text>
        <Text style={styles.wrappedTitle}>Your June Wrapped is almost ready</Text>
        <Text style={styles.wrappedSub}>
          Log {mealsRemaining} more meal{mealsRemaining !== 1 ? 's' : ''} to unlock
        </Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useNavigation();
  const [meals, setMeals] = useState(MOCK_MEALS);
  const [sponsored, setSponsored] = useState(MOCK_SPONSORED);
  const [coupons, setCoupons] = useState(MOCK_COUPONS);
  const [stats, setStats] = useState(MOCK_STATS);
  const [streak, setStreak] = useState(12);
  const [showAd, setShowAd] = useState(true);
  const [userName, setUserName] = useState('Nople');

  // Replace mock data with real Supabase queries
  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Today's meals
      const today = new Date().toISOString().split('T')[0];
      const { data: mealData } = await supabase
        .from('meals')
        .select('*, businesses(name)')
        .eq('user_id', user.id)
        .gte('created_at', `${today}T00:00:00`)
        .order('created_at', { ascending: true });

      if (mealData) {
        const mapped = mealData.map((m) => ({
          id: m.id,
          type: m.business_id ? 'business' : 'personal',
          name: m.name,
          emoji: m.emoji || '🍽️',
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          rating: m.rating,
          bgColor: m.bg_color || '#1a1a1a',
          businessName: m.businesses?.name,
        }));
        setMeals(mapped);
      }

      // Active coupons for user's city
      const { data: couponData } = await supabase
        .from('coupons')
        .select('*, businesses(name)')
        .gt('expires_at', new Date().toISOString())
        .eq('active', true)
        .limit(3);

      if (couponData) {
        setCoupons(
          couponData.map((c) => ({
            id: c.id,
            title: c.title,
            businessName: c.businesses?.name,
            discount: c.discount_label,
            code: c.code,
            expiry: new Date(c.expires_at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
          }))
        );
      }

      // Sponsored ad — pick one active ad for this user's city
      const { data: adData } = await supabase
        .from('sponsored_posts')
        .select('*, businesses(name, emoji)')
        .eq('active', true)
        .limit(1)
        .single();

      if (adData) {
        setSponsored({
          id: adData.id,
          businessName: adData.businesses?.name,
          businessEmoji: adData.businesses?.emoji || '🍽️',
          title: adData.title,
          description: adData.description,
          emoji: adData.image_emoji || '🍽️',
          bgColor: '#0f1a10',
        });
      }

      // Streak — count consecutive days with at least 1 meal
      const { data: streakData } = await supabase
        .rpc('get_user_streak', { uid: user.id });
      if (streakData !== null) setStreak(streakData);

      // Profile name
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();
      if (profile?.display_name) setUserName(profile.display_name);
    }

    loadData();
  }, []);

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
            <Text style={styles.titleAccent}>{userName}?</Text>
          </Text>
        </View>

        {/* Streak */}
        <StreakBanner streak={streak} />

        {/* Today's meals */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's meals</Text>
          <TouchableOpacity onPress={() => navigation.navigate('AllMeals')}>
            <Text style={styles.sectionAction}>see all</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={meals}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MealCard meal={item} />}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mealsScrollPadding}
          ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
        />

        {/* Log meal CTA */}
        <TouchableOpacity
          style={styles.logBtn}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('LogMeal')}
        >
          <View style={styles.logLeft}>
            <View style={styles.logIcon}>
              <Text style={{ fontSize: 20 }}>📸</Text>
            </View>
            <View>
              <Text style={styles.logLabel}>Log a meal</Text>
              <Text style={styles.logSub}>Snap a photo to identify it</Text>
            </View>
          </View>
          <Text style={styles.logArrow}>→</Text>
        </TouchableOpacity>

        {/* Sponsored ad */}
        {showAd && sponsored && (
          <SponsoredBanner
            ad={sponsored}
            onLogAndTry={() => navigation.navigate('LogMeal', { sponsored: sponsored })}
            onDismiss={() => setShowAd(false)}
          />
        )}

        {/* Coupons */}
        {coupons.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Deals near you</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Coupons')}>
                <Text style={styles.sectionAction}>see all</Text>
              </TouchableOpacity>
            </View>
            {coupons.map((c) => (
              <CouponCard key={c.id} coupon={c} />
            ))}
          </>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard emoji="🍽️" value={stats.mealsThisMonth} label="meals logged" />
          <StatCard emoji="⭐" value={stats.avgRating.toFixed(1)} label="avg rating" />
          <StatCard emoji="🏆" value={`#${stats.cityRank}`} label="PHX rank" />
        </View>

        {/* Wrapped teaser */}
        <WrappedTeaser mealsRemaining={3} />
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
  streakBanner: { marginHorizontal: 24, marginTop: 16, backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.border, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streakFlame: { fontSize: 22 },
  streakLabel: { fontSize: 12, color: C.gray2 },
  streakCount: { fontFamily: 'Syne_800ExtraBold', fontSize: 18, color: C.orange },
  streakDots: { flexDirection: 'row', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dotActive: { backgroundColor: C.orange },

  // Section headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, marginTop: 24, marginBottom: 12 },
  sectionTitle: { fontFamily: 'Syne_700Bold', fontSize: 16, color: C.white },
  sectionAction: { fontSize: 13, color: C.orange, fontWeight: '500' },

  // Meal cards
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
  star: { },

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
});
