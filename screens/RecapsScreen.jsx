import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import { WrappedPlayer, computeWrappedStats, MONTH_NAMES } from './WrappedScreen';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc', purpleDim: '#1a0d1a',
  white: '#ffffff', gray1: '#888888', gray2: '#666666', gray3: '#555555',
};

const CARD_GRADIENTS = [
  ['#2d1050', '#1a0828'],
  ['#0d1f3c', '#0d0d0d'],
  ['#1a2010', '#0d0d0d'],
  ['#200d0d', '#0d0d0d'],
  ['#1a1400', '#0d0d0d'],
];

// ─── RecapCard ────────────────────────────────────────────────────────────────
function RecapCard({ snap, index, onPress }) {
  const enter   = useRef(new Animated.Value(0)).current;
  const { month, year, stats, viewed } = snap;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 400, delay: index * 70,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, []);

  const gradient = CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  const monthLabel = MONTH_NAMES[month];
  const personality = stats?.personality;

  return (
    <Animated.View style={[styles.cardWrap, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.82 }]}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {!viewed && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        )}

        <View style={styles.cardInner}>
          <View style={styles.cardEmoji}>
            <Text style={styles.cardEmojiText}>{personality?.emoji ?? '✨'}</Text>
          </View>

          <View style={styles.cardInfo}>
            <Text style={styles.cardMonth}>{monthLabel} {year}</Text>
            <Text style={styles.cardPersonality}>{personality?.name ?? 'Your Wrapped'}</Text>
            <Text style={styles.cardMealCount}>{stats?.totalMeals ?? '?'} meals</Text>
          </View>

          <Text style={styles.cardChevron}>›</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── ThisMonthCard ────────────────────────────────────────────────────────────
function ThisMonthCard({ stats, onPress }) {
  const now        = new Date();
  const monthLabel = MONTH_NAMES[now.getMonth()];
  const year       = now.getFullYear();
  const personality = stats?.personality;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.thisMonthCard, pressed && { opacity: 0.82 }]}
    >
      <LinearGradient
        colors={['#1c0d00', '#0d0d0d']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.thisMonthLivePill}>
        <View style={styles.liveDot} />
        <Text style={styles.livePillText}>LIVE</Text>
      </View>

      <View style={styles.cardInner}>
        <View style={[styles.cardEmoji, { backgroundColor: 'rgba(255,107,61,0.15)', borderColor: 'rgba(255,107,61,0.3)' }]}>
          <Text style={styles.cardEmojiText}>{personality?.emoji ?? '✨'}</Text>
        </View>

        <View style={styles.cardInfo}>
          <Text style={styles.cardMonth}>{monthLabel} {year}</Text>
          <Text style={styles.cardPersonality}>{personality?.name ?? 'In progress…'}</Text>
          <Text style={styles.cardMealCount}>{stats?.totalMeals ?? 0} meals so far</Text>
        </View>

        <Text style={styles.cardChevron}>›</Text>
      </View>

      <Text style={styles.thisMonthHint}>Preview · finalises when month ends</Text>
    </Pressable>
  );
}

// ─── RecapsScreen ─────────────────────────────────────────────────────────────
export default function RecapsScreen() {
  const [loading, setLoading]           = useState(true);
  const [generating, setGenerating]     = useState(false);
  const [snapshots, setSnapshots]       = useState([]);
  const [thisMonthStats, setThisMonthStats] = useState(null);
  const [selected, setSelected]         = useState(null);   // { stats } when playback open
  const generatedRef                    = useRef(false);
  const uidRef                          = useRef(null);

  useFocusEffect(useCallback(() => {
    if (!generatedRef.current) {
      generatedRef.current = true;
      loadAll();
    } else {
      refreshSnapshots();
    }
  }, []));

  async function loadAll() {
    setLoading(true);
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) { setLoading(false); return; }
      uidRef.current = user.id;

      // Load current month (live) and existing snapshots in parallel
      const now              = new Date();
      const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

      const [{ data: thisMonthMeals }, { data: existingSnaps }] = await Promise.all([
        supabase.from('meals').select('*').eq('user_id', user.id)
          .gte('created_at', startOfMonth).lt('created_at', startOfNextMonth),
        supabase.from('wrapped_snapshots').select('*').eq('user_id', user.id)
          .order('year', { ascending: false }).order('month', { ascending: false }),
      ]);

      // Compute live this-month stats
      if (thisMonthMeals && thisMonthMeals.length > 0) {
        let streak = 0;
        try {
          const { data: sd, error: se } = await supabase.rpc('get_user_streak', { uid: user.id });
          if (!se && typeof sd === 'number') streak = sd;
        } catch {}
        setThisMonthStats(computeWrappedStats(thisMonthMeals, now.getMonth(), now.getFullYear(), streak));
      }

      setSnapshots(existingSnaps || []);
      setLoading(false);

      // Generate any missing past-month snapshots in the background
      generateMissingSnapshots(user.id, existingSnaps || []);
    } catch {
      setLoading(false);
    }
  }

  async function refreshSnapshots() {
    if (!uidRef.current) return;
    const { data } = await supabase.from('wrapped_snapshots').select('*')
      .eq('user_id', uidRef.current)
      .order('year', { ascending: false }).order('month', { ascending: false });
    if (data) setSnapshots(data);
  }

  async function generateMissingSnapshots(uid, existing) {
    // Find earliest meal to know how far back to check
    const { data: firstMeal } = await supabase
      .from('meals').select('created_at').eq('user_id', uid)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();

    if (!firstMeal) return;

    const existingKeys = new Set(existing.map(s => `${s.year}-${s.month}`));
    const now          = new Date();
    const lastComplete = new Date(now.getFullYear(), now.getMonth(), 1); // start of current month (exclusive)

    // Build list of complete months that don't have a snapshot
    const missing = [];
    let d = new Date(new Date(firstMeal.created_at).getFullYear(), new Date(firstMeal.created_at).getMonth(), 1);
    while (d < lastComplete) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!existingKeys.has(key)) {
        missing.push({ month: d.getMonth(), year: d.getFullYear() });
      }
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    if (missing.length === 0) return;
    setGenerating(true);

    const created = [];
    for (const { month, year } of missing) {
      const monthStart = new Date(year, month, 1).toISOString();
      const monthEnd   = new Date(year, month + 1, 1).toISOString();

      const { data: meals } = await supabase.from('meals').select('*').eq('user_id', uid)
        .gte('created_at', monthStart).lt('created_at', monthEnd);

      if (!meals || meals.length === 0) continue;

      const statsData = computeWrappedStats(meals, month, year, 0);
      if (!statsData) continue;

      const { data: snap } = await supabase.from('wrapped_snapshots')
        .insert({ user_id: uid, month, year, stats: statsData, viewed: false })
        .select().single();

      if (snap) created.push(snap);
    }

    if (created.length > 0) {
      setSnapshots(prev => {
        const all = [...created, ...prev].sort((a, b) => {
          if (b.year !== a.year) return b.year - a.year;
          return b.month - a.month;
        });
        return all;
      });
    }
    setGenerating(false);
  }

  async function handleSelectSnapshot(snap) {
    if (!snap.viewed) {
      supabase.from('wrapped_snapshots').update({ viewed: true }).eq('id', snap.id).then(() => {});
      setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, viewed: true } : s));
    }
    setSelected({ stats: snap.stats });
  }

  const newCount = snapshots.filter(s => !s.viewed).length;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.center}><ActivityIndicator color={C.orange} /></View>
      </SafeAreaView>
    );
  }

  const hasContent = thisMonthStats || snapshots.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.kicker}>YOUR STORY</Text>
              <Text style={styles.heading}>Recaps</Text>
            </View>
            {newCount > 0 && (
              <View style={styles.newCountBadge}>
                <Text style={styles.newCountText}>{newCount} new</Text>
              </View>
            )}
          </View>

          {generating && (
            <View style={styles.generatingRow}>
              <ActivityIndicator color={C.orange} size="small" />
              <Text style={styles.generatingText}>Building your recaps…</Text>
            </View>
          )}

          {!hasContent && !generating && (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>📭</Text>
              <Text style={styles.emptyTitle}>No recaps yet</Text>
              <Text style={styles.emptySub}>
                Log meals this month and your first Recap will appear here at the end of the month.
              </Text>
            </View>
          )}

          {thisMonthStats && (
            <>
              <Text style={styles.sectionLabel}>THIS MONTH</Text>
              <View style={styles.sectionContent}>
                <ThisMonthCard stats={thisMonthStats} onPress={() => setSelected({ stats: thisMonthStats })} />
              </View>
            </>
          )}

          {snapshots.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, thisMonthStats && { marginTop: 28 }]}>PAST RECAPS</Text>
              <View style={styles.sectionContent}>
                {snapshots.map((snap, i) => (
                  <RecapCard
                    key={snap.id}
                    snap={snap}
                    index={i}
                    onPress={() => handleSelectSnapshot(snap)}
                  />
                ))}
              </View>
            </>
          )}

          {thisMonthStats && snapshots.length === 0 && !generating && (
            <Text style={styles.comingSoonHint}>
              Your first full Recap drops at the end of {MONTH_NAMES[new Date().getMonth()]}.
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Full-screen playback overlay */}
      {selected && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 200 }]}>
          <WrappedPlayer
            stats={selected.stats}
            onClose={() => setSelected(null)}
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: C.bg },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:     { flex: 1 },
  listContent: { paddingBottom: 60 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20, marginBottom: 8 },
  kicker:    { fontWeight: '700', fontSize: 12, letterSpacing: 1.5, color: C.orange, textTransform: 'uppercase', marginBottom: 6 },
  heading:   { fontWeight: '800', fontSize: 30, color: '#f5f5f5', letterSpacing: -0.5 },

  newCountBadge: { backgroundColor: C.orange, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 4 },
  newCountText:  { fontSize: 12, fontWeight: '700', color: C.white },

  generatingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 10 },
  generatingText: { fontSize: 13, color: C.gray2 },

  sectionLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: C.gray3, textTransform: 'uppercase', paddingHorizontal: 24, marginTop: 24, marginBottom: 12 },
  sectionContent: { paddingHorizontal: 16 },

  emptyWrap:  { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 52, marginBottom: 20 },
  emptyTitle: { fontWeight: '700', fontSize: 22, color: C.white, marginBottom: 10, textAlign: 'center' },
  emptySub:   { fontSize: 14, color: C.gray1, textAlign: 'center', lineHeight: 22 },

  comingSoonHint: { fontSize: 13, color: C.gray3, textAlign: 'center', paddingHorizontal: 40, marginTop: 24, fontStyle: 'italic' },

  // Cards
  cardWrap: { marginBottom: 12 },
  card: {
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  cardInner: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, paddingRight: 14 },
  cardEmoji: {
    width: 50, height: 50, borderRadius: 16,
    backgroundColor: 'rgba(136,85,204,0.2)',
    borderWidth: 1, borderColor: 'rgba(136,85,204,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardEmojiText: { fontSize: 26 },
  cardInfo: { flex: 1 },
  cardMonth:       { fontSize: 11, color: C.gray2, fontWeight: '600', letterSpacing: 0.5, marginBottom: 3 },
  cardPersonality: { fontWeight: '700', fontSize: 18, color: C.white, letterSpacing: -0.2, marginBottom: 3 },
  cardMealCount:   { fontSize: 12, color: C.gray2 },
  cardChevron: { fontSize: 22, color: C.gray3, paddingRight: 4 },

  newBadge: { position: 'absolute', top: 14, right: 14, backgroundColor: C.orange, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  newBadgeText: { fontWeight: '800', fontSize: 9, letterSpacing: 1, color: '#0d0d0d' },

  // This Month card
  thisMonthCard: {
    marginBottom: 0, borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,107,61,0.2)',
  },
  thisMonthLivePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    position: 'absolute', top: 14, right: 14,
    backgroundColor: 'rgba(255,107,61,0.12)',
    borderRadius: 8, borderWidth: 0.5, borderColor: 'rgba(255,107,61,0.3)',
    paddingHorizontal: 8, paddingVertical: 3,
  },
  liveDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange },
  livePillText: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: C.orange },
  thisMonthHint: { fontSize: 11, color: C.gray3, fontStyle: 'italic', paddingHorizontal: 18, paddingBottom: 14, paddingTop: 0 },
});
