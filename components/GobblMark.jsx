import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME as C } from '../lib/theme';

// "The Bite" — Gobbl's brand mark (see the "Gobbl Logo System" design spec):
// a disc with a circular bite taken from its edge, plus (in the primary
// variant) a small morsel floating just past the bite. React Native has no
// CSS mask/SVG here (react-native-svg isn't installed), so the bite is
// faked with a solid circle in whatever color this mark sits on top of —
// this only reads correctly on a solid background, never directly on a
// photo, which is also a hard rule in the spec itself ("Don't put the mark
// on a busy photo without a chip").
//
// The bite circle's position is *derived* from the disc's own geometry
// (not a separate magic-number offset) so it always lands centered exactly
// on the disc's right edge, at any `size` — a fixed-ratio offset drifts off
// the disc as soon as discSize/discOffset change even slightly.
function biteRightInset(size, discSize, discOffset, biteSize) {
  const discCenterX = size / 2 + discOffset;
  const discRightEdge = discCenterX + discSize / 2;
  return size - (discRightEdge + biteSize / 2);
}

// Primary mark — disc + bite + morsel. Ratios lifted from the spec's 196px
// reference icon (disc ⌀126/marginLeft -22, bite ⌀78, morsel ⌀26 inset 40).
export function GobblMark({ size = 56, bg = C.bg, colors = [C.orange, '#B8461C'], morselColor = C.white }) {
  const discSize = size * 0.6429;
  const discOffset = -size * 0.1122;
  const biteSize = size * 0.3980;
  const morselSize = size * 0.1327;
  const biteRight = biteRightInset(size, discSize, discOffset, biteSize);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <LinearGradient
        colors={colors}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ width: discSize, height: discSize, borderRadius: discSize / 2, marginLeft: discOffset }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', width: biteSize, height: biteSize, borderRadius: biteSize / 2,
          backgroundColor: bg, right: biteRight, top: size / 2 - biteSize / 2,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', width: morselSize, height: morselSize, borderRadius: morselSize / 2,
          backgroundColor: morselColor, right: size * 0.2041, top: size / 2 - morselSize / 2,
        }}
      />
    </View>
  );
}

// The "tab / compose, down to 24px" glyph from the same spec — a rounded-
// square gradient chip with a bitten white disc, no morsel. Ratios lifted
// from the spec's 56/40/24px examples (disc ⌀0.61, offset -0.108, bite
// diameter a consistent 0.375 of the container across all three sizes).
export function GobblChip({ size = 34, colors = [C.orange, '#B8461C'], style }) {
  const radius = size * 0.268;
  const discSize = size * 0.61;
  const discOffset = -size * 0.108;
  const biteSize = size * 0.375;
  const biteRight = biteRightInset(size, discSize, discOffset, biteSize);
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[{ width: size, height: size, borderRadius: radius, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <View style={{ width: discSize, height: discSize, borderRadius: discSize / 2, backgroundColor: C.white, marginLeft: discOffset }} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', width: biteSize, height: biteSize, borderRadius: biteSize / 2,
          backgroundColor: colors[1], right: biteRight, top: size / 2 - biteSize / 2,
        }}
      />
    </LinearGradient>
  );
}
