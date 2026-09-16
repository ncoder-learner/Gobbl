import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MyProfileScreen from './MyProfileScreen';
import HistoryScreen from './HistoryScreen';
import { THEME as C } from '../lib/theme';

const SEGMENTS = [
  ['profile', 'Profile'],
  ['history', 'History'],
];

function YoursSegmentedControl({ value, onChange }) {
  return (
    <View style={styles.segWrap}>
      {SEGMENTS.map(([key, label]) => {
        const active = value === key;
        return (
          <TouchableOpacity
            key={key}
            onPress={() => onChange(key)}
            activeOpacity={0.85}
            style={[styles.segBtn, active && styles.segBtnActive]}
          >
            <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function YoursScreen() {
  const [active, setActive] = useState('profile');

  return (
    <View style={styles.flex}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Text style={styles.headerTitle}>{active === 'profile' ? 'Profile' : 'History'}</Text>
        <YoursSegmentedControl value={active} onChange={setActive} />
      </SafeAreaView>

      <View style={[styles.flex, active !== 'profile' && styles.hidden]}>
        <MyProfileScreen embedded />
      </View>
      <View style={[styles.flex, active !== 'history' && styles.hidden]}>
        <HistoryScreen embedded />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.bg },
  hidden: { display: 'none' },

  header: { backgroundColor: C.bg, paddingHorizontal: 16, paddingBottom: 10 },
  headerTitle: {
    fontFamily: C.serif, fontSize: 32, color: C.white,
    marginTop: 2, marginBottom: 10,
  },

  segWrap: {
    flexDirection: 'row',
    backgroundColor: '#141416',
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  segBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    backgroundColor: C.orange,
  },
  segBtnText: { fontWeight: '600', fontSize: 13, color: 'rgba(245,245,247,0.5)' },
  segBtnTextActive: { color: '#000', fontWeight: '800' },
});
