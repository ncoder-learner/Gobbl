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

export default function ScoreSlider({ value, onChange }) {
  const trackWidthRef = useRef(0);
  const thumbX = useRef(new Animated.Value(0)).current;
  // Keep onChange in a ref so the PanResponder (created once) always calls the latest version
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  function valueToX(v, width) {
    const usable = width - THUMB_SIZE;
    return ((v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * usable;
  }

  // Stored in a ref so the PanResponder closure never goes stale
  const reportRef = useRef((locationX) => {
    const width = trackWidthRef.current;
    if (!width) return;
    const usable = width - THUMB_SIZE;
    const x = Math.max(0, Math.min(usable, locationX - THUMB_SIZE / 2));
    const raw = SCORE_MIN + (x / usable) * (SCORE_MAX - SCORE_MIN);
    onChangeRef.current(Math.round(raw * 2) / 2); // snap to nearest 0.5
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => reportRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => reportRef.current(e.nativeEvent.locationX),
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
  }, [value]);

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
        <Text style={styles.sliderScaleText}>1</Text>
        <Text style={styles.sliderScaleText}>10</Text>
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
  sliderScaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 },
  sliderScaleText: { fontSize: 11, color: C.gray3, fontWeight: '600' },
});
