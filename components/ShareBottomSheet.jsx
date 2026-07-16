import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Modal, ScrollView, TextInput, TouchableOpacity,
  Image, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, Pressable,
  Animated, Easing, Dimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { computeTierRank, createPost, fetchPostedMealIds, mealTagSlot, MEAL_TAGS, TAG_META } from '../lib/postUtils';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', white: '#ffffff',
  gray2: '#666666', gray4: '#444444', inputBg: '#161616',
};

function scoreToneColor(score) {
  const n = Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return C.orange;
  if (n < 9) return '#00c896';
  return '#ffd166';
}

function formatScore(score) {
  const n = Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

// Pops a slot card in with a quick scale+flash whenever its content changes
// (fills, or swaps to a different meal) — keyed by the caller on meal id so
// React remounts this on every such change, re-triggering the animation.
function SlotFillPop({ children, filled }) {
  const scale = useRef(new Animated.Value(filled ? 0.86 : 1)).current;
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!filled) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 320, delay: 220, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {children}
      {filled && (
        <Animated.View pointerEvents="none" style={[styles.fillFlash, { opacity: flash }]}>
          <Text style={styles.fillFlashCheck}>✓</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ─── Date helpers ───────────────────────────────────────────────────────────
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dateLabel(d) {
  const today = new Date();
  if (isSameDay(d, today)) return 'Today';
  const yesterday = addDays(today, -1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// meal: { id, name, emoji, score, photo_url }
// onPosted(postId): called after successful post
// onDismiss(): called on cancel or after post
export default function ShareBottomSheet({ visible, meal, onDismiss, onPosted }) {
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  // Custom open/close transition — Modal's own `visible` is delayed on close
  // until the exit animation finishes, so the sheet slides/fades out instead
  // of just vanishing when the parent flips `visible` to false.
  const [shown, setShown] = useState(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      setShown(true);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 6 }),
        ]).start();
      });
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sheetY, { toValue: SCREEN_HEIGHT, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(() => setShown(false));
    }
  }, [visible]);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [seedDate, setSeedDate] = useState(new Date());
  const [slots, setSlots] = useState({ breakfast: null, lunch: null, dinner: null });
  const [slotsLoading, setSlotsLoading] = useState(false);

  const loadSlotsForDate = useCallback(async (date, seedMeal, seedDay) => {
    setSlotsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const dayStart = startOfDay(date);
      const dayEnd = addDays(dayStart, 1);

      const [{ data: dayMeals }, postedIds] = await Promise.all([
        supabase
          .from('meals')
          .select('id, name, emoji, score, photo_url, tag')
          .eq('user_id', user.id)
          .gte('created_at', dayStart.toISOString())
          .lt('created_at', dayEnd.toISOString()),
        fetchPostedMealIds(user.id).catch(() => new Set()),
      ]);

      const next = { breakfast: null, lunch: null, dinner: null };
      for (const tag of MEAL_TAGS) {
        const found = (dayMeals || []).find(m => m.tag === tag && !postedIds.has(m.id));
        if (found) next[tag] = found;
      }
      // The seed meal (just logged / picked from History) always occupies its
      // slot on its own day, regardless of whether it turned up in the scan
      // above (e.g. untagged meals default to breakfast but wouldn't match
      // `m.tag === 'breakfast'` literally).
      if (seedMeal && isSameDay(date, seedDay)) {
        next[mealTagSlot(seedMeal.tag)] = seedMeal;
      }
      setSlots(next);
    } catch {
      setSlots(seedMeal ? { breakfast: null, lunch: null, dinner: null, [mealTagSlot(seedMeal.tag)]: seedMeal } : { breakfast: null, lunch: null, dinner: null });
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || !meal) return;
    setCaption('');
    setError(null);
    const day = meal.created_at ? new Date(meal.created_at) : new Date();
    setSeedDate(day);
    setSelectedDate(day);
    loadSlotsForDate(day, meal, day);
  }, [visible, meal?.id]);

  function goToDate(newDate) {
    setSelectedDate(newDate);
    loadSlotsForDate(newDate, meal, seedDate);
  }

  function clearSlot(tag) {
    setSlots(s => ({ ...s, [tag]: null }));
  }

  const filledCount = MEAL_TAGS.filter(t => slots[t]).length;
  const isToday = isSameDay(selectedDate, new Date());

  async function handlePost() {
    const primary = slots.breakfast || slots.lunch || slots.dinner;
    if (!primary) {
      setError('Pick at least one meal to post.');
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const tierRank = await computeTierRank(primary.id).catch(() => null);
      const postId = await createPost(
        {
          breakfast: slots.breakfast?.id ?? null,
          lunch: slots.lunch?.id ?? null,
          dinner: slots.dinner?.id ?? null,
        },
        caption,
        tierRank,
      );
      onPosted?.(postId);
      onDismiss();
    } catch (err) {
      setError(err.message || 'Could not post. Try again.');
    } finally {
      setPosting(false);
    }
  }

  if (!meal) return null;

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        </Pressable>

        <Animated.View
          style={[styles.sheetPositioner, { transform: [{ translateY: sheetY }] }]}
          pointerEvents="box-none"
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View style={styles.header}>
                <TouchableOpacity onPress={onDismiss} hitSlop={8}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Share to feed</Text>
                <View style={{ width: 52 }} />
              </View>

              {/* Date switcher */}
              <View style={styles.dateRow}>
                <TouchableOpacity
                  onPress={() => goToDate(addDays(selectedDate, -1))}
                  hitSlop={10}
                  style={styles.dateArrowBtn}
                >
                  <Text style={styles.dateArrow}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.dateLabel}>{dateLabel(selectedDate)}</Text>
                <TouchableOpacity
                  onPress={() => !isToday && goToDate(addDays(selectedDate, 1))}
                  hitSlop={10}
                  disabled={isToday}
                  style={styles.dateArrowBtn}
                >
                  <Text style={[styles.dateArrow, isToday && styles.dateArrowDisabled]}>›</Text>
                </TouchableOpacity>
              </View>

              {/* 3 meal slots */}
              <View style={styles.slotsRow}>
                {slotsLoading ? (
                  <View style={styles.slotsLoading}>
                    <ActivityIndicator color={C.orange} size="small" />
                  </View>
                ) : (
                  MEAL_TAGS.map(tag => {
                    const slotMeal = slots[tag];
                    const meta = TAG_META[tag];
                    return (
                      <View key={tag} style={styles.slotCol}>
                        <Text style={styles.slotLabel}>{meta.emoji} {meta.label}</Text>
                        {slotMeal ? (
                          <SlotFillPop key={`${tag}-${slotMeal.id}`} filled>
                            <View style={styles.slotCard}>
                              {slotMeal.photo_url ? (
                                <Image source={{ uri: slotMeal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                              ) : (
                                <View style={[StyleSheet.absoluteFill, styles.slotFallback]}>
                                  <Text style={{ fontSize: 24 }}>{slotMeal.emoji || '🍽️'}</Text>
                                </View>
                              )}
                              <TouchableOpacity
                                style={styles.slotClearBtn}
                                onPress={() => clearSlot(tag)}
                                hitSlop={8}
                              >
                                <Text style={styles.slotClearText}>×</Text>
                              </TouchableOpacity>
                              <View style={[styles.slotScoreBadge, { backgroundColor: scoreToneColor(slotMeal.score) }]}>
                                <Text style={styles.slotScoreText}>{formatScore(slotMeal.score)}</Text>
                              </View>
                              <Text style={styles.slotName} numberOfLines={1}>{slotMeal.name}</Text>
                            </View>
                          </SlotFillPop>
                        ) : (
                          <View style={[styles.slotCard, styles.slotEmpty]}>
                            <Text style={styles.slotEmptyText}>No {tag} meal</Text>
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>

              {/* Caption input */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Caption <Text style={styles.optional}>(optional, max 200 chars)</Text>
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={caption}
                  onChangeText={t => setCaption(t.slice(0, 200))}
                  placeholder="Say something about this meal…"
                  placeholderTextColor={C.gray4}
                  multiline
                  numberOfLines={3}
                  returnKeyType="done"
                />
                <Text style={styles.charCount}>{caption.length}/200</Text>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.postBtn, (posting || filledCount === 0) && styles.disabled]}
                onPress={handlePost}
                disabled={posting || filledCount === 0}
                activeOpacity={0.85}
              >
                {posting ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={styles.postBtnText}>
                    {filledCount > 1 ? `Post ${filledCount} meals →` : 'Post to feed →'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheetPositioner: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center', marginTop: 12,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  title: { fontSize: 17, fontWeight: '700', color: C.white },
  cancelText: { fontSize: 15, color: C.gray2, fontWeight: '500' },

  // Date switcher
  dateRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 20, marginBottom: 16,
  },
  dateArrowBtn: { padding: 4 },
  dateArrow: { fontSize: 22, color: C.orange, fontWeight: '700' },
  dateArrowDisabled: { color: C.gray4 },
  dateLabel: { fontSize: 14, fontWeight: '700', color: C.white, minWidth: 96, textAlign: 'center' },

  // Meal slots
  slotsRow: {
    flexDirection: 'row', gap: 10, marginHorizontal: 24, marginBottom: 20,
  },
  slotsLoading: { flex: 1, height: 150, alignItems: 'center', justifyContent: 'center' },
  slotCol: { flex: 1 },
  slotLabel: { fontSize: 11, color: C.gray2, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  slotCard: {
    height: 130, borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#111', justifyContent: 'flex-end',
  },
  slotFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' },
  slotEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' },
  slotEmptyText: { fontSize: 11, color: C.gray4, textAlign: 'center', paddingHorizontal: 6 },
  slotClearBtn: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  slotClearText: { fontSize: 13, color: '#fff', fontWeight: '700', lineHeight: 15 },
  slotScoreBadge: {
    position: 'absolute', top: 4, left: 4,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  slotScoreText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  slotName: {
    fontSize: 10, color: 'rgba(255,255,255,0.85)', fontWeight: '600',
    paddingHorizontal: 6, paddingBottom: 5,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  fillFlash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,200,150,0.32)',
  },
  fillFlashCheck: { fontSize: 26, color: '#fff', fontWeight: '800' },

  fieldGroup: { paddingHorizontal: 24, marginBottom: 20 },
  fieldLabel: { fontSize: 13, color: C.gray2, marginBottom: 8, fontWeight: '500' },
  optional: { color: C.gray4, fontWeight: '400' },
  input: {
    backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.white,
  },
  textArea: { height: 88, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: C.gray2, textAlign: 'right', marginTop: 4 },

  errorBox: {
    marginHorizontal: 24, marginBottom: 16,
    backgroundColor: '#2a0a0a', borderWidth: 0.5, borderColor: '#5a1a1a',
    borderRadius: 10, padding: 12,
  },
  errorText: { fontSize: 13, color: '#ff6b6b', lineHeight: 18 },

  postBtn: {
    marginHorizontal: 24, backgroundColor: C.orange,
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
  },
  postBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
  disabled: { opacity: 0.6 },
});
