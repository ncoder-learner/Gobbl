import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME as C } from '../lib/theme';
import ScoreSlider from './ScoreSlider';

// Shown when a tier-list drag-and-drop lands between two neighbors, so the
// user can pick exactly where the dragged meal's rating falls in that gap —
// including landing on a neighbor's exact rating to tie with it on purpose.
// Confirming persists the rating and commits the reorder; dismissing does
// neither, leaving the list exactly as it was before the drag.
export default function TierRatingSliderModal({
  visible,
  itemName,
  initialValue,
  min,
  max,
  lowerLabel,
  upperLabel,
  onCancel,
  onConfirm,
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(initialValue);

  // Re-seed the slider each time a new drag opens the modal (visible flips
  // false->true with a fresh initialValue/min/max for the new drop spot).
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(20, insets.bottom) }]} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>Rate {itemName}</Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.hint}>
              Dropped between {lowerLabel ?? 'the bottom'} and {upperLabel ?? 'the top'} — drag to set the exact rating.
            </Text>
            <ScoreSlider
              value={value}
              onChange={setValue}
              min={min}
              max={max}
              step={0.1}
              leftLabel={lowerLabel}
              rightLabel={upperLabel}
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => onConfirm(value)} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: C.glassBorder,
  },
  handle: {
    width: 36, height: 4, backgroundColor: C.glassBorder,
    borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  sheetHeader: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.glassBorder,
  },
  sheetTitle: { fontFamily: C.serif, fontSize: 20, color: C.white },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  hint: { fontSize: 13, color: C.gray2, lineHeight: 19, marginBottom: 18 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 16 },
  cancelBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '700', color: C.gray1 },
  saveBtn: { flex: 2, borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: C.orange },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
});
