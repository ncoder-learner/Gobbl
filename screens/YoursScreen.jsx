import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HistoryScreen from './HistoryScreen';
import TierListScreen from './TierListScreen';
import RecapsScreen from './RecapsScreen';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', white: '#ffffff', gray2: '#666666',
};

const SEGMENTS = [
  ['rank', 'Rank'],
  ['history', 'History'],
  ['recaps', 'Recaps'],
];

function YoursSegmentedControl({ value, onChange }) {
  return (
    <View style={styles.segWrap}>
      {SEGMENTS.map(([key, label]) => (
        <TouchableOpacity
          key={key}
          style={[styles.segBtn, value === key && styles.segBtnActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.8}
        >
          <Text style={[styles.segBtnText, value === key && styles.segBtnTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Merges History, Tier List, and Recaps behind one segmented control — three
// sorts of the same underlying meal data (by date, by rank, by month), not
// three separate concerns, so they didn't need three separate tabs. Each
// screen is reused verbatim (mounted as-is, not rewritten) and kept mounted
// simultaneously via `display: none` on the inactive ones rather than
// conditional rendering, so switching segments doesn't remount and re-fetch
// — matching how they behaved as separate tabs before (bottom-tabs keeps
// inactive screens mounted by default).
//
// Known trade-off: each embedded screen still wraps itself in its own
// `SafeAreaView edges={['top']}`, which insets against the device's actual
// top edge regardless of this screen's own header already occupying that
// space — so the active segment gets a bit of extra top padding beyond what
// it needs. Fixing that means editing each of the three files, which this
// task explicitly asked to reuse rather than rewrite.
export default function YoursScreen() {
  const [active, setActive] = useState('rank');

  return (
    <View style={styles.flex}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Text style={styles.headerTitle}>Yours</Text>
        <YoursSegmentedControl value={active} onChange={setActive} />
      </SafeAreaView>

      <View style={[styles.flex, active !== 'history' && styles.hidden]}>
        <HistoryScreen />
      </View>
      <View style={[styles.flex, active !== 'rank' && styles.hidden]}>
        <TierListScreen />
      </View>
      <View style={[styles.flex, active !== 'recaps' && styles.hidden]}>
        <RecapsScreen />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.bg },
  hidden: { display: 'none' },

  header: { backgroundColor: C.bg, paddingHorizontal: 24, paddingBottom: 12 },
  headerTitle: {
    fontSize: 26, fontWeight: '800', color: C.white, letterSpacing: -0.5,
    marginTop: 4, marginBottom: 14,
  },

  segWrap: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: C.orange },
  segBtnText: { fontWeight: '700', fontSize: 13, color: C.gray2 },
  segBtnTextActive: { color: C.white },
});
