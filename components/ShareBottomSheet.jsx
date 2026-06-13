import { useState, useEffect } from 'react';
import {
  View, Text, Modal, ScrollView, TextInput, TouchableOpacity,
  Image, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { computeTierRank, createPost } from '../lib/postUtils';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', white: '#ffffff',
  gray2: '#666666', gray4: '#444444', inputBg: '#161616',
};

function scoreToneColor(score) {
  const n = Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return C.orange;
  if (n < 9) return '#00c896';
  return '#ffd166';
}

function formatScore(score) {
  const n = Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

// meal: { id, name, emoji, score, photo_url }
// onPosted(postId): called after successful post
// onDismiss(): called on cancel or after post
export default function ShareBottomSheet({ visible, meal, onDismiss, onPosted }) {
  const [caption, setCaption] = useState('');
  const [tierRank, setTierRank] = useState(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  const scoreColor = meal ? scoreToneColor(meal.score) : C.orange;

  useEffect(() => {
    if (!visible || !meal) return;
    setCaption('');
    setError(null);
    setTierRank(null);
    computeTierRank(meal.id).then(setTierRank).catch(() => setTierRank(null));
  }, [visible, meal?.id]);

  async function handlePost() {
    setPosting(true);
    setError(null);
    try {
      const postId = await createPost(meal.id, caption, tierRank);
      onPosted?.(postId);
      onDismiss();
    } catch (err) {
      setError(err.message || 'Could not post. Try again.');
    } finally {
      setPosting(false);
    }
  }

  if (!meal) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.overlay} onPress={onDismiss}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View style={styles.header}>
                <TouchableOpacity onPress={onDismiss} hitSlop={8}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Share to feed</Text>
                <View style={{ width: 52 }} />
              </View>

              {/* Preview card */}
              <View style={styles.preview}>
                {meal.photo_url ? (
                  <Image
                    source={{ uri: meal.photo_url }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    resizeMethod="scale"
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.previewFallback]}>
                    <Text style={{ fontSize: 38 }}>{meal.emoji || '🍽️'}</Text>
                  </View>
                )}

                <View style={[styles.scoreBadge, { backgroundColor: scoreColor }]}>
                  <Text style={styles.scoreBadgeNum}>{formatScore(meal.score)}</Text>
                  <Text style={styles.scoreBadgeDen}>/10</Text>
                </View>

                {tierRank != null && (
                  <View style={[styles.tierRibbon, { borderColor: scoreColor + 'aa' }]}>
                    <Text style={[styles.tierText, { color: scoreColor }]}>
                      #{tierRank} · {new Date().getFullYear()}
                    </Text>
                  </View>
                )}

                <View style={styles.previewBottom}>
                  <Text style={styles.previewName} numberOfLines={1}>{meal.name}</Text>
                </View>
              </View>

              {/* Caption input */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Caption <Text style={styles.optional}>(optional, max 200 chars)</Text>
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={caption}
                  onChangeText={t => setCaption(t.slice(0, 200))}
                  placeholder="Say something about this meal…"
                  placeholderTextColor={C.gray4}
                  multiline
                  numberOfLines={3}
                  returnKeyType="done"
                />
                <Text style={styles.charCount}>{caption.length}/200</Text>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.postBtn, posting && styles.disabled]}
                onPress={handlePost}
                disabled={posting}
                activeOpacity={0.85}
              >
                {posting ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={styles.postBtnText}>Post to feed →</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center', marginTop: 12,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24,
  },
  title: { fontSize: 17, fontWeight: '700', color: C.white },
  cancelText: { fontSize: 15, color: C.gray2, fontWeight: '500' },

  preview: {
    marginHorizontal: 24, marginBottom: 20, borderRadius: 16,
    height: 180, overflow: 'hidden', backgroundColor: '#111',
  },
  previewFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' },
  scoreBadge: {
    position: 'absolute', top: 10, right: 10,
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
  },
  scoreBadgeNum: { fontSize: 15, fontWeight: '800', color: '#fff', lineHeight: 17 },
  scoreBadgeDen: { fontSize: 9, color: 'rgba(255,255,255,0.65)', lineHeight: 11 },
  tierRibbon: {
    position: 'absolute', top: 10, left: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  tierText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  previewBottom: { position: 'absolute', bottom: 10, left: 12, right: 12 },
  previewName: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },

  fieldGroup: { paddingHorizontal: 24, marginBottom: 20 },
  fieldLabel: { fontSize: 13, color: C.gray2, marginBottom: 8, fontWeight: '500' },
  optional: { color: C.gray4, fontWeight: '400' },
  input: {
    backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.white,
  },
  textArea: { height: 88, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: C.gray2, textAlign: 'right', marginTop: 4 },

  errorBox: {
    marginHorizontal: 24, marginBottom: 16,
    backgroundColor: '#2a0a0a', borderWidth: 0.5, borderColor: '#5a1a1a',
    borderRadius: 10, padding: 12,
  },
  errorText: { fontSize: 13, color: '#ff6b6b', lineHeight: 18 },

  postBtn: {
    marginHorizontal: 24, backgroundColor: C.orange,
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
  },
  postBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
  disabled: { opacity: 0.6 },
});
