import { useRef, useEffect } from 'react';
import { View, Text, Animated, PanResponder, StyleSheet } from 'react-native';
import { THEME as C } from '../lib/theme';

// Shared between LogMealScreen (creation) and EditMealScreen (editing) —
// drag to rate 1.0–10.0 in 0.5 steps, with color/mood feedback as it climbs.

const SCORE_MIN = 1;
const SCORE_MAX = 10;
const THUMB_SIZE = 26;

export function scoreTone(score) {
  if (score < 3) return { label: 'Rough', color: '#e5484d' };
  if (score < 5) return { label: 'Meh', color: '#f5a524' };
  if (score < 7) return { label: 'Good', color: C.orange };
  if (score < 9) return { label: 'Great', color: C.green };
  return { label: 'Amazing', color: C.gold };
}

// min/max/step/left-right labels default to the standard 1.0-10.0 whole-scale
// behavior (LogMeal/EditMeal usage is unaffected). The tier-list reorder
// slider passes a narrow bounded range instead (e.g. 8-8.5, between two
// neighboring meals) plus their names as the end labels.
export default function ScoreSlider({ value, onChange, min = SCORE_MIN, max = SCORE_MAX, step = 0.1, leftLabel, rightLabel }) {
  const trackWidthRef = useRef(0);
  const thumbX = useRef(new Animated.Value(0)).current;
  // Keep onChange in a ref so the PanResponder (created once) always calls the latest version
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  // value/min/max in refs too, for the same reason — PanResponder is built
  // once via useRef, so its callbacks would otherwise always see the props
  // from the very first render.
  const valueRef = useRef(value);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const stepRef = useRef(step);
  useEffect(() => { valueRef.current = value; minRef.current = min; maxRef.current = max; stepRef.current = step; });

  function valueToX(v, width, mn = min, mx = max) {
    const usable = width - THUMB_SIZE;
    if (mx === mn) return 0;
    return ((v - mn) / (mx - mn)) * usable;
  }

  // Anchors each drag to the thumb's own on-screen x at the moment the
  // gesture starts, then moves purely by gestureState.dx (cumulative finger
  // displacement) from there — never by nativeEvent.locationX. locationX is
  // computed relative to whichever view is directly under the finger, which
  // RN (especially on Android) can report inconsistently as the *thumb* vs
  // the *track* mid-gesture — the exact mismatch that made the slider jump
  // to an unrelated value partway through a drag.
  const grantXRef = useRef(0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        grantXRef.current = valueToX(valueRef.current, trackWidthRef.current, minRef.current, maxRef.current);
      },
      onPanResponderMove: (_e, gestureState) => {
        const width = trackWidthRef.current;
        const mn = minRef.current;
        const mx = maxRef.current;
        if (!width || mx === mn) return;
        const usable = width - THUMB_SIZE;
        const x = Math.max(0, Math.min(usable, grantXRef.current + gestureState.dx));
        const raw = mn + (x / usable) * (mx - mn);
        const snapped = Math.round(raw / stepRef.current) * stepRef.current;
        onChangeRef.current(Math.max(mn, Math.min(mx, snapped)));
      },
    })
  ).current;

  useEffect(() => {
    const width = trackWidthRef.current;
    if (!width) return;
    Animated.spring(thumbX, {
      toValue: valueToX(value, width),
      useNativeDriver: false,
      speed: 22,
      bounciness: 5,
    }).start();
  }, [value, min, max]);

  const tone = scoreTone(value);

  return (
    <View>
      <View style={styles.scoreReadout}>
        <Text style={[styles.scoreReadoutNum, { color: tone.color }]}>{value.toFixed(1)}</Text>
        <Text style={[styles.scoreReadoutLabel, { color: tone.color }]}>{tone.label}</Text>
      </View>

      <View
        style={styles.sliderTrack}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          trackWidthRef.current = w;
          thumbX.setValue(valueToX(value, w));
        }}
        {...pan.panHandlers}
      >
        <Animated.View style={[styles.sliderFill, { width: thumbX, backgroundColor: tone.color }]} />
        <Animated.View
          style={[
            styles.sliderThumb,
            { backgroundColor: tone.color, transform: [{ translateX: Animated.subtract(thumbX, THUMB_SIZE / 2) }] },
          ]}
        />
      </View>

      <View style={styles.sliderScaleRow}>
        <Text style={styles.sliderScaleText} numberOfLines={1}>{leftLabel ?? min}</Text>
        <Text style={styles.sliderScaleText} numberOfLines={1}>{rightLabel ?? max}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scoreReadout: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 14 },
  scoreReadoutNum: { fontFamily: C.serif, fontSize: 40 },
  scoreReadoutLabel: { fontSize: 16, fontWeight: '700' },
  sliderTrack: {
    height: 40,
    justifyContent: 'center',
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: THUMB_SIZE / 2,
    overflow: 'visible',
  },
  sliderFill: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    height: 6,
    borderRadius: 3,
    opacity: 0.9,
  },
  sliderThumb: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    borderColor: C.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  sliderScaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2, gap: 8 },
  sliderScaleText: { fontSize: 11, color: C.gray3, fontWeight: '600', flexShrink: 1, maxWidth: '48%' },
});
