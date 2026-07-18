import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

// Stand-in for the mockup's `repeating-linear-gradient(135deg, ...)` diagonal
// stripe fill used on every mock/missing-photo tile. RN has no CSS gradients
// and react-native-svg isn't installed, so this covers the container with a
// grid of rotated bars sized from a measured onLayout rather than a fixed
// size, so it fully tiles any tile/grid/full-bleed container it's dropped into.
const DEFAULT_LIGHT = '#242424';
const DEFAULT_DARK = '#1a1a1a';
const STRIPE_THICKNESS = 10;
const STRIPE_PERIOD = STRIPE_THICKNESS * 2;

export default function StripedPlaceholder({ style, light = DEFAULT_LIGHT, dark = DEFAULT_DARK, children }) {
  const [size, setSize] = useState(null);

  function handleLayout(e) {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.width !== width || size.height !== height) {
      setSize({ width, height });
    }
  }

  const diag = size ? Math.ceil(size.width + size.height) : 0;
  const stripeCount = diag ? Math.ceil(diag / STRIPE_PERIOD) + 2 : 0;

  return (
    <View style={[styles.container, { backgroundColor: dark }, style]} onLayout={handleLayout}>
      {size && (
        <View
          style={[
            styles.rotatedWrap,
            {
              width: diag,
              height: diag,
              left: (size.width - diag) / 2,
              top: (size.height - diag) / 2,
            },
          ]}
        >
          {Array.from({ length: stripeCount }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.stripe,
                { backgroundColor: light, width: STRIPE_THICKNESS, left: i * STRIPE_PERIOD },
              ]}
            />
          ))}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', position: 'relative' },
  rotatedWrap: { position: 'absolute', transform: [{ rotate: '135deg' }] },
  stripe: { position: 'absolute', top: 0, bottom: 0 },
});
