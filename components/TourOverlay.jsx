import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useTour } from '../lib/tourContext';
import { TOUR_STEPS } from '../lib/tourSteps';

const { height: SCREEN_H } = Dimensions.get('window');
const PAD = 8;

// Renders once, at the root, above the whole navigator — a step can be
// spotlighting an element on whatever screen is currently on top. Steps
// with no registered target (feature locked, or nothing posted yet) fall
// back to a plain centered card instead of pointing at nothing.
export default function TourOverlay() {
  const { active, stepIndex, targets, advance, skipTour } = useTour();
  const [rect, setRect] = useState(null);
  const [resolved, setResolved] = useState(false);
  const timerRef = useRef(null);

  const step = active ? TOUR_STEPS[stepIndex] : null;

  useEffect(() => {
    setRect(null);
    setResolved(false);
    if (!step || step.mode === 'auto-action') return;
    if (!step.targetId && !step.navigateTo) {
      setResolved(true);
      return;
    }
    clearTimeout(timerRef.current);
    // Give a just-navigated-to screen a moment to mount and measure before
    // falling back — most steps resolve well under this.
    timerRef.current = setTimeout(() => {
      const t = step.targetId ? targets.current[step.targetId] : null;
      if (t) setRect(t.rect);
      setResolved(true);
    }, 550);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, active]);

  if (!step || step.mode === 'auto-action' || !resolved) return null;

  const message = rect ? step.text : (step.fallbackText || step.text);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {rect ? <Spotlight rect={rect} /> : <View style={styles.dimAll} pointerEvents="auto" />}

      <View pointerEvents="box-none" style={rect ? tooltipStyleFor(rect) : styles.centerWrap}>
        <View style={styles.card}>
          <Text style={styles.cardText}>{message}</Text>
          <View style={styles.cardActions}>
            <TouchableOpacity onPress={skipTour} hitSlop={10}>
              <Text style={styles.skipText}>Skip tour</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => advance(step)} style={styles.nextBtn} activeOpacity={0.85}>
              <Text style={styles.nextBtnText}>{step.isFinal ? 'Done' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function Spotlight({ rect }) {
  const x = Math.max(rect.x - PAD, 0);
  const y = Math.max(rect.y - PAD, 0);
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      <View style={[styles.dimSlice, { top: 0, left: 0, right: 0, height: y }]} />
      <View style={[styles.dimSlice, { top: y + h, left: 0, right: 0, bottom: 0 }]} />
      <View style={[styles.dimSlice, { top: y, left: 0, width: x, height: h }]} />
      <View style={[styles.dimSlice, { top: y, left: x + w, right: 0, height: h }]} />
      <View pointerEvents="none" style={[styles.ring, { top: y, left: x, width: w, height: h }]} />
    </View>
  );
}

function tooltipStyleFor(rect) {
  const spaceBelow = SCREEN_H - (rect.y + rect.height);
  const placeBelow = spaceBelow > 160;
  return placeBelow
    ? { position: 'absolute', left: 16, right: 16, top: rect.y + rect.height + PAD + 14 }
    : { position: 'absolute', left: 16, right: 16, bottom: SCREEN_H - rect.y + PAD + 14 };
}

const styles = StyleSheet.create({
  dimAll: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.78)' },
  dimSlice: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.78)' },
  ring: { position: 'absolute', borderRadius: 18, borderWidth: 2, borderColor: '#FF6B3D' },
  centerWrap: { position: 'absolute', left: 16, right: 16, top: '42%' },
  card: {
    backgroundColor: '#2a1040', borderWidth: 1, borderColor: '#5a2a8a',
    borderRadius: 16, padding: 16,
    shadowColor: '#8855cc', shadowOpacity: 0.3, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  cardText: { fontSize: 14, color: '#e8d0ff', lineHeight: 20, fontWeight: '500', marginBottom: 14 },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skipText: { fontSize: 13, color: '#9966cc', fontWeight: '600' },
  nextBtn: { backgroundColor: '#8855cc', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  nextBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
