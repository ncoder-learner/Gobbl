import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Modal, ScrollView, TextInput, TouchableOpacity,
  Image, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, Pressable,
  Animated, Easing, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeTierRank, createPost, mealTagSlot } from '../lib/postUtils';
import { THEME as C } from '../lib/theme';
import StripedPlaceholder from './StripedPlaceholder';
import { logShareEvent } from '../lib/analytics';

function scoreToneColor(score) {
  const n = Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return C.orange;
  if (n < 9) return C.green;
  return C.gold;
}

function formatScore(score) {
  const n = Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

// meal: { id, name, emoji, score, photo_url, tag }
// onPosted(postId): called after successful post
// onDismiss(): called on cancel or after post
export default function ShareBottomSheet({ visible, meal, onDismiss, onPosted }) {
  // Modal renders as its own native window on Android — `statusBarTranslucent`
  // makes it extend edge-to-edge, so `sheetPositioner`'s `bottom: 0` is the
  // true physical screen edge, behind the system nav bar. `sheet` has no
  // fixed height (just a maxHeight cap) and is flex-end-aligned inside that
  // positioner, so its bottom boundary always sits flush against that same
  // edge regardless of how much padding is added *inside* its scrollable
  // content — growing the content only extends how much is revealed at the
  // top, not where the bottom boundary actually is. The inset has to go on
  // `sheet` itself (a margin, so flex-end alignment respects it) to actually
  // move that boundary — and everything near it, like the post button —
  // above the nav bar.
  const insets = useSafeAreaInsets();
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

  useEffect(() => {
    if (!visible || !meal) return;
    setCaption('');
    setError(null);
  }, [visible, meal?.id]);

  async function handlePost() {
    if (!meal) return;
    setPosting(true);
    setError(null);
    try {
      const tierRank = await computeTierRank(meal.id).catch(() => null);
      const postId = await createPost({ [mealTagSlot(meal.tag)]: meal.id }, caption, tierRank);
      
      // Log share event
      await logShareEvent({
        mealName: meal.name,
        shareType: 'share_list',
        contentType: 'meal',
      });
      
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
          <Pressable style={[styles.sheet, { marginBottom: insets.bottom }]} onPress={() => {}}>
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

              {/* The single meal being posted */}
              <View style={styles.previewCard}>
                {meal.photo_url ? (
                  <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <StripedPlaceholder style={StyleSheet.absoluteFill}>
                    <View style={styles.previewFallback}>
                      <Text style={{ fontSize: 32 }}>{meal.emoji || '🍽️'}</Text>
                    </View>
                  </StripedPlaceholder>
                )}
                <View style={[styles.previewScoreBadge, { backgroundColor: scoreToneColor(meal.score) }]}>
                  <Text style={styles.previewScoreText}>{formatScore(meal.score)}</Text>
                </View>
                <Text style={styles.previewName} numberOfLines={1}>{meal.name}</Text>
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
                style={[styles.postBtn, posting && styles.disabled]}
                onPress={handlePost}
                disabled={posting}
                activeOpacity={0.85}
              >
                {posting ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={styles.postBtnText}>Post to feed →</Text>
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
    backgroundColor: C.glassBorder,
    alignSelf: 'center', marginTop: 12,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  title: { fontSize: 17, fontWeight: '700', color: C.white },
  cancelText: { fontSize: 15, color: C.gray2, fontWeight: '500' },

  // The single meal being posted
  previewCard: {
    marginHorizontal: 24, marginBottom: 20, height: 180, borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#111', justifyContent: 'flex-end',
  },
  previewFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  previewScoreBadge: {
    position: 'absolute', top: 10, right: 10,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
  },
  previewScoreText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  previewName: {
    fontFamily: C.serif, fontSize: 20, color: '#fff',
    paddingHorizontal: 14, paddingBottom: 12,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },

  fieldGroup: { paddingHorizontal: 24, marginBottom: 20 },
  fieldLabel: { fontSize: 13, color: C.gray2, marginBottom: 8, fontWeight: '500' },
  optional: { color: C.gray4, fontWeight: '400' },
  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.white,
  },
  textArea: { height: 88, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: C.gray2, textAlign: 'right', marginTop: 4 },

  errorBox: {
    marginHorizontal: 24, marginBottom: 16,
    backgroundColor: C.redDim, borderWidth: 0.5, borderColor: C.redBorder,
    borderRadius: 10, padding: 12,
  },
  errorText: { fontSize: 13, color: C.red, lineHeight: 18 },

  postBtn: {
    marginHorizontal: 24, backgroundColor: C.orange,
    borderRadius: C.pill, paddingVertical: 15, alignItems: 'center',
  },
  postBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
  disabled: { opacity: 0.6 },
});
