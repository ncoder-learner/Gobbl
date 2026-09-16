import { View, StyleSheet } from 'react-native';

const TICKS = 32;

export default function ProgressRing({
  progress = 0,
  size = 118,
  color,
  trackColor = '#2a2a2e',
  overColor,
  children,
}) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const over = (Number(progress) || 0) > 1;
  const active = over ? (overColor || color) : color;
  const radius = (size - 14) / 2;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      {Array.from({ length: TICKS }, (_, i) => {
        const angle = (i / TICKS) * 360 - 90;
        const rad = (angle * Math.PI) / 180;
        const on = i / TICKS < p;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: cx + radius * Math.cos(rad) - 1.5,
              top: cy + radius * Math.sin(rad) - 5,
              width: 3,
              height: 11,
              borderRadius: 2,
              backgroundColor: on ? active : trackColor,
              transform: [{ rotate: `${angle + 90}deg` }],
            }}
          />
        );
      })}
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
