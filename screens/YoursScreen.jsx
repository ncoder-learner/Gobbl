import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import HistoryScreen from './HistoryScreen';
import TierListScreen from './TierListScreen';
import RecapsScreen from './RecapsScreen';
import { THEME as C } from '../lib/theme';

const SEGMENTS = [
  ['history', 'History'],
  ['rank', 'Tier List'],
  ['recaps', 'Recaps'],
];

function YoursSegmentedControl({ value, onChange }) {
  return (
    <View style={styles.segWrap}>
      {SEGMENTS.map(([key, label]) => (
        <TouchableOpacity
          key={key}
          onPress={() => onChange(key)}
          activeOpacity={0.8}
          style={styles.segBtnTouch}
        >
          {value === key ? (
            <LinearGradient colors={[C.orange, C.orangeDim]} style={styles.segBtn}>
              <Text style={[styles.segBtnText, styles.segBtnTextActive]}>{label}</Text>
            </LinearGradient>
          ) : (
            <View style={styles.segBtn}>
              <Text style={styles.segBtnText}>{label}</Text>
            </View>
          )}
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
    fontFamily: C.serif, fontSize: 34, color: C.white,
    marginTop: 4, marginBottom: 14,
  },

  segWrap: {
    flexDirection: 'row', backgroundColor: C.glassBg,
    borderRadius: 13, borderWidth: 1, borderColor: C.glassBorder, padding: 4,
  },
  segBtnTouch: { flex: 1 },
  segBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segBtnText: { fontWeight: '500', fontSize: 12, color: 'rgba(245,245,247,0.5)' },
  segBtnTextActive: { color: C.bg, fontWeight: '700' },
});
