import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { THEME as C } from '../lib/theme';

// Shared between LogMealScreen (creation) and EditMealScreen (editing) — one
// implementation so the two never visually drift apart.
export const TAG_OPTIONS = [
  ['breakfast', '🌅', 'Breakfast'],
  ['lunch', '☀️', 'Lunch'],
  ['dinner', '🌙', 'Dinner'],
];

export default function MealTagPicker({ value, onChange }) {
  return (
    <View style={styles.tagPickerWrap}>
      {TAG_OPTIONS.map(([key, , label]) => (
        <TouchableOpacity
          key={key}
          onPress={() => onChange(key)}
          activeOpacity={0.8}
          style={styles.tagPickerTouch}
        >
          {value === key ? (
            <LinearGradient colors={[C.orange, C.orangeDim]} style={styles.tagPickerBtn}>
              <Text style={[styles.tagPickerText, styles.tagPickerTextActive]}>{label}</Text>
            </LinearGradient>
          ) : (
            <View style={styles.tagPickerBtn}>
              <Text style={styles.tagPickerText}>{label}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tagPickerWrap: {
    flexDirection: 'row', backgroundColor: C.glassBg,
    borderRadius: 13, borderWidth: 1, borderColor: C.glassBorder, padding: 4, gap: 4,
  },
  tagPickerTouch: { flex: 1 },
  tagPickerBtn: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 9, borderRadius: 10,
  },
  tagPickerText: { fontWeight: '500', fontSize: 13, color: 'rgba(245,245,247,0.5)' },
  tagPickerTextActive: { color: C.bg, fontWeight: '700' },
});
