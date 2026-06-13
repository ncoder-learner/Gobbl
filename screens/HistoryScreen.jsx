import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  ActivityIndicator,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { computeTierRank, createPost } from '../lib/postUtils';

const PAGE_SIZE = 20;

const C = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  border: '#2a2a2a',
  orange: '#FF6B3D',
  purple: '#8855cc',
  white: '#ffffff',
  gray1: '#888888',
  gray2: '#666666',
  gray3: '#555555',
  gray4: '#444444',
  gray5: '#333333',
  inputBg: '#161616',
  red: '#ff4444',
  redDim: '#2a0a0a',
  redBorder: '#5a1a1a',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreToneColor(score) {
  const n = typeof score === 'number' ? score : Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return C.orange;
  if (n < 9) return '#00c896';
  return '#ffd166';
}

function formatScore(score) {
  const n = typeof score === 'number' ? score : Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function localDateKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatSectionDate(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yestMidnight = new Date(todayMidnight);
  yestMidnight.setDate(yestMidnight.getDate() - 1);

  if (d.getTime() === todayMidnight.getTime()) return 'Today';
  if (d.getTime() === yestMidnight.getTime()) return 'Yesterday';

  const diffDays = Math.round((todayMidnight - d) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function buildFlatData(meals) {
  const dateMap = new Map();
  for (const meal of meals) {
    const key = localDateKey(meal.created_at);
    if (!dateMap.has(key)) dateMap.set(key, []);
    dateMap.get(key).push(meal);
  }
  const items = [];
  for (const [dateKey, dayMeals] of dateMap) {
    items.push({ type: 'header', key: `h-${dateKey}`, date: dateKey });
    for (const meal of dayMeals) {
      items.push({ type: 'item', key: meal.id, meal });
    }
  }
  return items;
}

// Extracts the storage object path from a Supabase Storage public URL.
// Returns null if the URL isn't from the meal-photos bucket.
function storagePathFromUrl(photoUrl) {
  if (!photoUrl) return null;
  const marker = '/storage/v1/object/public/meal-photos/';
  const idx = photoUrl.indexOf(marker);
  if (idx === -1) return null;
  return photoUrl.slice(idx + marker.length);
}

// ─── Score stepper ────────────────────────────────────────────────────────────
// Used in the edit form. Safer than a drag slider inside a scroll view / modal.

function ScoreStepper({ value, onChange }) {
  const color = scoreToneColor(value);

  function adjust(delta) {
    const next = Math.round((value + delta) * 2) / 2;
    onChange(Math.max(1, Math.min(10, next)));
  }

  return (
    <View style={styles.stepperRow}>
      <TouchableOpacity
        style={styles.stepperBtn}
        onPress={() => adjust(-0.5)}
        hitSlop={8}
        activeOpacity={0.7}
      >
        <Text style={styles.stepperBtnText}>−</Text>
      </TouchableOpacity>

      <View style={styles.stepperDisplay}>
        <Text style={[styles.stepperScore, { color }]}>{value.toFixed(1)}</Text>
        <Text style={[styles.stepperOut, { color }]}> / 10</Text>
      </View>

      <TouchableOpacity
        style={styles.stepperBtn}
        onPress={() => adjust(0.5)}
        hitSlop={8}
        activeOpacity={0.7}
      >
        <Text style={styles.stepperBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ date }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{formatSectionDate(date)}</Text>
    </View>
  );
}

function MealRow({ meal, onPress }) {
  const scoreColor = scoreToneColor(meal.score);
  const meta = [meal.cuisine, meal.businesses?.name].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity style={styles.row} onPress={() => onPress(meal)} activeOpacity={0.72}>
      {meal.photo_url ? (
        <Image source={{ uri: meal.photo_url }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Text style={styles.thumbEmoji}>{meal.emoji || '🍽️'}</Text>
        </View>
      )}

      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{meal.name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{meta || ' '}</Text>
      </View>

      <View style={styles.rowRight}>
        <Text style={[styles.rowScore, { color: scoreColor }]}>{formatScore(meal.score)}</Text>
        <Text style={styles.rowTime}>{formatTime(meal.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );
}

function EmptyState({ onLog }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>🍽️</Text>
      <Text style={styles.emptyTitle}>No meals logged yet</Text>
      <Text style={styles.emptyBody}>
        Start snapping your food to build your personal history and get your monthly Wrapped.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onLog} activeOpacity={0.85}>
        <Text style={styles.emptyBtnText}>Log your first meal →</Text>
      </TouchableOpacity>
    </View>
  );
}

function Chip({ text }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

// ─── Detail / Edit / Delete modal ─────────────────────────────────────────────
// Single Modal with three modes so we never nest modals.
//   'detail'        — read-only view with Edit + Delete buttons
//   'edit'          — editable form (name, score, notes)
//   'confirmDelete' — inline confirmation before hard-delete

function MealDetailModal({ meal, onClose, onUpdated, onDeleted, onPostChanged }) {
  const [mode, setMode] = useState('detail');

  // Edit form state — initialised from the meal at mount time.
  const initScore = typeof meal.score === 'number' ? meal.score : Number(meal.score);
  const [editName, setEditName] = useState(meal.name);
  const [editScore, setEditScore] = useState(isNaN(initScore) ? 5 : initScore);
  const [editNotes, setEditNotes] = useState(meal.notes ?? '');

  // Share form state
  const [shareCaption, setShareCaption] = useState('');
  const [shareTierRank, setShareTierRank] = useState(null);
  const [sharingPost, setSharingPost] = useState(false);
  const [isPosted, setIsPosted] = useState(!!(meal.posts?.length > 0));
  const [postId, setPostId] = useState(meal.posts?.[0]?.id ?? null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function enterShare() {
    setShareCaption('');
    setError(null);
    setMode('share');
    try {
      const rank = await computeTierRank(meal.id);
      setShareTierRank(rank);
    } catch { setShareTierRank(null); }
  }

  async function handlePost() {
    setSharingPost(true);
    setError(null);
    try {
      const newPostId = await createPost(meal.id, shareCaption, shareTierRank);
      setIsPosted(true);
      setPostId(newPostId);
      onPostChanged?.(meal.id, newPostId);
      setMode('detail');
    } catch (err) {
      setError(err.message || 'Could not post. Try again.');
    } finally {
      setSharingPost(false);
    }
  }

  async function handleUnpost() {
    setSharingPost(true);
    setError(null);
    try {
      const { error: delErr } = await supabase.from('posts').delete().eq('id', postId);
      if (delErr) throw delErr;
      setIsPosted(false);
      setPostId(null);
      onPostChanged?.(meal.id, null);
    } catch (err) {
      setError(err.message || 'Could not remove post.');
    } finally {
      setSharingPost(false);
    }
  }

  function enterEdit() {
    // Re-sync fields with the current meal in case it was updated earlier this session.
    const s = typeof meal.score === 'number' ? meal.score : Number(meal.score);
    setEditName(meal.name);
    setEditScore(isNaN(s) ? 5 : s);
    setEditNotes(meal.notes ?? '');
    setError(null);
    setMode('edit');
  }

  async function handleSave() {
    if (!editName.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const derivedRating = Math.max(1, Math.min(5, Math.round(editScore / 2)));
      const updates = {
        name: editName.trim(),
        score: editScore,
        rating: derivedRating,
        notes: editNotes.trim() || null,
      };
      const { error: updateError } = await supabase
        .from('meals')
        .update(updates)
        .eq('id', meal.id);
      if (updateError) throw updateError;
      onUpdated({ ...meal, ...updates });
      setMode('detail');
    } catch (err) {
      setError(err.message || 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      // Best-effort storage cleanup — don't block the row delete on this.
      const storagePath = storagePathFromUrl(meal.photo_url);
      if (storagePath) {
        await supabase.storage.from('meal-photos').remove([storagePath]);
      }

      const { error: deleteError } = await supabase
        .from('meals')
        .delete()
        .eq('id', meal.id);
      if (deleteError) throw deleteError;

      onDeleted(meal.id);
    } catch (err) {
      setError(err.message || 'Delete failed. Try again.');
      setDeleting(false);
      setMode('detail');
    }
  }

  const scoreColor = scoreToneColor(meal.score);
  const loggedAt = new Date(meal.created_at);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={mode === 'edit' ? () => setMode('detail') : onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.detailOverlay} onPress={mode === 'edit' ? undefined : onClose}>
          <Pressable style={styles.detailSheet} onPress={() => {}}>
            <View style={styles.detailHandle} />

            {/* ── DETAIL MODE ──────────────────────────────────────────── */}
            {mode === 'detail' && (
              <>
                {meal.photo_url ? (
                  <Image source={{ uri: meal.photo_url }} style={styles.detailPhoto} resizeMode="cover" />
                ) : (
                  <View style={[styles.detailPhoto, styles.detailPhotoFallback]}>
                    <Text style={styles.detailPhotoEmoji}>{meal.emoji || '🍽️'}</Text>
                  </View>
                )}

                <TouchableOpacity style={styles.detailClose} onPress={onClose} hitSlop={12}>
                  <Text style={styles.detailCloseText}>✕</Text>
                </TouchableOpacity>

                <ScrollView
                  style={styles.detailBody}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 32 }}
                >
                  <View style={styles.detailNameRow}>
                    <Text style={styles.detailEmoji}>{meal.emoji || '🍽️'}</Text>
                    <Text style={styles.detailName} numberOfLines={2}>{meal.name}</Text>
                    <Text style={[styles.detailScore, { color: scoreColor }]}>{formatScore(meal.score)}</Text>
                  </View>

                  <View style={styles.detailChips}>
                    {meal.cuisine ? <Chip text={meal.cuisine} /> : null}
                    {meal.businesses?.name ? <Chip text={`📍 ${meal.businesses.name}`} /> : null}
                    <Chip text={loggedAt.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} />
                    <Chip text={formatTime(meal.created_at)} />
                  </View>

                  {meal.description ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionLabel}>About this dish</Text>
                      <Text style={styles.detailSectionText}>{meal.description}</Text>
                    </View>
                  ) : null}

                  {meal.notes ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionLabel}>Your notes</Text>
                      <Text style={styles.detailSectionText}>{meal.notes}</Text>
                    </View>
                  ) : null}

                  {/* Action buttons */}
                  <View style={styles.detailActions}>
                    {/* Share to feed / remove from feed */}
                    {sharingPost ? (
                      <View style={[styles.shareBtn, { justifyContent: 'center' }]}>
                        <ActivityIndicator color={C.white} size="small" />
                      </View>
                    ) : isPosted ? (
                      <TouchableOpacity style={styles.sharePostedBtn} onPress={handleUnpost} activeOpacity={0.8}>
                        <Text style={styles.sharePostedBtnText}>✓ Posted · Remove</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.shareBtn} onPress={enterShare} activeOpacity={0.8}>
                        <Text style={styles.shareBtnText}>Share to feed →</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity style={styles.editBtn} onPress={enterEdit} activeOpacity={0.8}>
                      <Text style={styles.editBtnText}>Edit entry</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => { setError(null); setMode('confirmDelete'); }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.deleteBtnText}>Delete entry</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </>
            )}

            {/* ── EDIT MODE ────────────────────────────────────────────── */}
            {mode === 'edit' && (
              <ScrollView
                style={styles.editBody}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.editHeader}>
                  <TouchableOpacity onPress={() => { setError(null); setMode('detail'); }} hitSlop={8}>
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.editTitle}>Edit entry</Text>
                  <View style={{ width: 52 }} />
                </View>

                <View style={styles.editFieldGroup}>
                  <Text style={styles.editFieldLabel}>Meal name</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="e.g. Spicy tuna roll"
                    placeholderTextColor={C.gray4}
                    returnKeyType="done"
                    autoFocus
                  />
                </View>

                <View style={styles.editFieldGroup}>
                  <Text style={styles.editFieldLabel}>Your rating</Text>
                  <ScoreStepper value={editScore} onChange={setEditScore} />
                </View>

                <View style={styles.editFieldGroup}>
                  <Text style={styles.editFieldLabel}>
                    Notes <Text style={styles.editOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={[styles.editInput, styles.editTextArea]}
                    value={editNotes}
                    onChangeText={setEditNotes}
                    placeholder="Any thoughts?"
                    placeholderTextColor={C.gray4}
                    multiline
                    numberOfLines={3}
                    returnKeyType="done"
                  />
                </View>

                {error ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.saveBtn, saving && styles.btnDisabled]}
                  onPress={handleSave}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator color={C.white} />
                  ) : (
                    <Text style={styles.saveBtnText}>Save changes</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* ── CONFIRM DELETE MODE ──────────────────────────────────── */}
            {mode === 'confirmDelete' && (
              <View style={styles.confirmBody}>
                <Text style={styles.confirmEmoji}>🗑️</Text>
                <Text style={styles.confirmTitle}>Delete this entry?</Text>
                <Text style={styles.confirmMsg}>
                  This will permanently remove{' '}
                  <Text style={{ color: C.white, fontWeight: '600' }}>{meal.name}</Text>
                  {meal.photo_url ? ' and its photo' : ''} from your history. This cannot be undone.
                </Text>

                {error ? (
                  <View style={[styles.errorBox, { marginBottom: 16 }]}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.confirmDeleteBtn, deleting && styles.btnDisabled]}
                  onPress={handleDelete}
                  disabled={deleting}
                  activeOpacity={0.8}
                >
                  {deleting ? (
                    <ActivityIndicator color={C.red} />
                  ) : (
                    <Text style={styles.confirmDeleteText}>Yes, delete it</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.confirmCancelBtn}
                  onPress={() => setMode('detail')}
                  disabled={deleting}
                  activeOpacity={0.8}
                >
                  <Text style={styles.confirmCancelText}>Keep it</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── SHARE MODE ───────────────────────────────────────────── */}
            {mode === 'share' && (
              <ScrollView
                style={styles.editBody}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.editHeader}>
                  <TouchableOpacity onPress={() => { setError(null); setMode('detail'); }} hitSlop={8}>
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.editTitle}>Share to feed</Text>
                  <View style={{ width: 52 }} />
                </View>

                {/* Preview card */}
                <View style={styles.sharePreview}>
                  {meal.photo_url ? (
                    <Image source={{ uri: meal.photo_url }} style={styles.sharePreviewPhoto} resizeMode="cover" />
                  ) : (
                    <View style={[styles.sharePreviewPhoto, styles.sharePreviewFallback]}>
                      <Text style={{ fontSize: 38 }}>{meal.emoji || '🍽️'}</Text>
                    </View>
                  )}
                  <View style={[styles.shareScoreBadge, { backgroundColor: scoreColor }]}>
                    <Text style={styles.shareScoreNum}>{formatScore(meal.score)}</Text>
                    <Text style={styles.shareScoreDen}>/10</Text>
                  </View>
                  {shareTierRank != null && (
                    <View style={[styles.shareTierRibbon, { borderColor: scoreColor + 'aa' }]}>
                      <Text style={[styles.shareTierText, { color: scoreColor }]}>
                        #{shareTierRank} · {new Date().getFullYear()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.sharePreviewBottom}>
                    <Text style={styles.sharePreviewName} numberOfLines={1}>{meal.name}</Text>
                  </View>
                </View>

                {/* Caption */}
                <View style={styles.editFieldGroup}>
                  <Text style={styles.editFieldLabel}>
                    Caption <Text style={styles.editOptional}>(optional, max 200 chars)</Text>
                  </Text>
                  <TextInput
                    style={[styles.editInput, styles.editTextArea]}
                    value={shareCaption}
                    onChangeText={text => setShareCaption(text.slice(0, 200))}
                    placeholder="Say something about this meal…"
                    placeholderTextColor={C.gray4}
                    multiline
                    numberOfLines={3}
                    returnKeyType="done"
                  />
                  <Text style={styles.charCount}>{shareCaption.length}/200</Text>
                </View>

                {error ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.saveBtn, sharingPost && styles.btnDisabled]}
                  onPress={handlePost}
                  disabled={sharingPost}
                  activeOpacity={0.85}
                >
                  {sharingPost ? (
                    <ActivityIndicator color={C.white} />
                  ) : (
                    <Text style={styles.saveBtnText}>Post to feed →</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const navigation = useNavigation();
  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedMeal, setSelectedMeal] = useState(null);
  const [error, setError] = useState(null);

  const flatData = useMemo(() => buildFlatData(meals), [meals]);

  useFocusEffect(
    useCallback(() => {
      fetchMeals(0, true);
    }, [])
  );

  async function fetchMeals(pageNum, replace) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const from = pageNum * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error: fetchError } = await supabase
        .from('meals')
        .select('id, name, emoji, score, rating, photo_url, created_at, notes, cuisine, description, businesses(name), posts(id)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (fetchError) throw fetchError;

      setMeals((prev) => (replace ? data : [...prev, ...data]));
      setHasMore(data.length === PAGE_SIZE);
      setPage(pageNum);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load meals.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }

  function handleRefresh() {
    setRefreshing(true);
    fetchMeals(0, true);
  }

  function handleEndReached() {
    if (!hasMore || loadingMore || loading || refreshing) return;
    setLoadingMore(true);
    fetchMeals(page + 1, false);
  }

  function handleMealUpdated(updatedMeal) {
    setMeals((prev) => prev.map((m) => (m.id === updatedMeal.id ? { ...m, ...updatedMeal } : m)));
    setSelectedMeal((prev) => (prev?.id === updatedMeal.id ? { ...prev, ...updatedMeal } : prev));
  }

  function handleMealDeleted(mealId) {
    setMeals((prev) => prev.filter((m) => m.id !== mealId));
    setSelectedMeal(null);
  }

  function handlePostChanged(mealId, newPostId) {
    setMeals(prev => prev.map(m => {
      if (m.id !== mealId) return m;
      return { ...m, posts: newPostId ? [{ id: newPostId }] : [] };
    }));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.orange} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <FlatList
        data={flatData}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.type === 'header' ? (
            <SectionHeader date={item.date} />
          ) : (
            <MealRow meal={item.meal} onPress={setSelectedMeal} />
          )
        }
        ListHeaderComponent={
          <View style={styles.pageHeader}>
            <Text style={styles.pageTitle}>Food history</Text>
            {error ? <Text style={styles.pageError}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState onLog={() => navigation.navigate('LogMeal')} />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerSpinner}>
              <ActivityIndicator color={C.orange} size="small" />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.orange}
            colors={[C.orange]}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {selectedMeal && (
        <MealDetailModal
          key={selectedMeal.id}
          meal={selectedMeal}
          onClose={() => setSelectedMeal(null)}
          onUpdated={handleMealUpdated}
          onDeleted={handleMealDeleted}
          onPostChanged={handlePostChanged}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 32, flexGrow: 1 },

  pageHeader: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4 },
  pageTitle: { fontSize: 28, fontWeight: '800', color: C.white, letterSpacing: -0.5 },
  pageError: { fontSize: 13, color: '#ff6b6b', marginTop: 8 },

  sectionHeader: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.gray2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  thumb: { width: 54, height: 54, borderRadius: 12, backgroundColor: C.surface },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: C.border,
  },
  thumbEmoji: { fontSize: 26 },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: C.white, marginBottom: 3 },
  rowMeta: { fontSize: 12, color: C.gray3 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowScore: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  rowTime: { fontSize: 11, color: C.gray4 },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    paddingTop: 80,
  },
  emptyEmoji: { fontSize: 56, marginBottom: 20 },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.white,
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 15,
    color: C.gray1,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  emptyBtn: {
    backgroundColor: C.orange,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  emptyBtnText: { fontSize: 15, fontWeight: '700', color: C.white },

  footerSpinner: { paddingVertical: 24, alignItems: 'center' },

  // ── Detail modal ─────────────────────────────────────────────────────────────
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  detailSheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  detailHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginTop: 12,
  },
  detailPhoto: { width: '100%', height: 240, backgroundColor: C.surface },
  detailPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
  detailPhotoEmoji: { fontSize: 72 },
  detailClose: {
    position: 'absolute',
    top: 28,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCloseText: { fontSize: 13, color: C.white, fontWeight: '600' },

  detailBody: { paddingHorizontal: 24 },
  detailNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 20,
    paddingBottom: 14,
  },
  detailEmoji: { fontSize: 28 },
  detailName: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: C.white,
    letterSpacing: -0.3,
  },
  detailScore: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  detailChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipText: { fontSize: 12, color: C.gray1, fontWeight: '500' },
  detailSection: { marginBottom: 20 },
  detailSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.gray3,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  detailSectionText: { fontSize: 15, color: C.gray1, lineHeight: 22 },

  detailActions: { marginTop: 8, gap: 10 },
  editBtn: {
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  editBtnText: { fontSize: 15, fontWeight: '600', color: C.white },
  deleteBtn: {
    backgroundColor: C.redDim,
    borderWidth: 0.5,
    borderColor: C.redBorder,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteBtnText: { fontSize: 15, fontWeight: '600', color: C.red },

  // ── Edit mode ────────────────────────────────────────────────────────────────
  editBody: { paddingHorizontal: 24 },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 24,
  },
  editTitle: { fontSize: 17, fontWeight: '700', color: C.white },
  editCancelText: { fontSize: 15, color: C.gray2, fontWeight: '500' },
  editFieldGroup: { marginBottom: 20 },
  editFieldLabel: { fontSize: 13, color: C.gray2, marginBottom: 8, fontWeight: '500' },
  editOptional: { color: C.gray4, fontWeight: '400' },
  editInput: {
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.white,
  },
  editTextArea: { height: 88, textAlignVertical: 'top' },

  // Score stepper
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.inputBg,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  stepperBtn: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
  },
  stepperBtnText: { fontSize: 22, color: C.white, fontWeight: '300', lineHeight: 26 },
  stepperDisplay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  stepperScore: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  stepperOut: { fontSize: 14, fontWeight: '500', opacity: 0.6 },

  saveBtn: {
    backgroundColor: C.orange,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
  btnDisabled: { opacity: 0.6 },

  errorBox: {
    backgroundColor: '#2a0a0a',
    borderWidth: 0.5,
    borderColor: '#5a1a1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { fontSize: 13, color: '#ff6b6b', lineHeight: 18 },

  // ── Confirm delete mode ──────────────────────────────────────────────────────
  confirmBody: {
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 36,
    alignItems: 'center',
  },
  confirmEmoji: { fontSize: 44, marginBottom: 16 },
  confirmTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.white,
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmMsg: {
    fontSize: 14,
    color: C.gray1,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
  },
  confirmDeleteBtn: {
    width: '100%',
    backgroundColor: C.redDim,
    borderWidth: 0.5,
    borderColor: C.redBorder,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmDeleteText: { fontSize: 15, fontWeight: '700', color: C.red },
  confirmCancelBtn: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  confirmCancelText: { fontSize: 15, fontWeight: '600', color: C.white },

  // ── Share to feed mode ────────────────────────────────────────────────────────
  shareBtn: {
    backgroundColor: C.purple,
    borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginBottom: 10, flexDirection: 'row', justifyContent: 'center',
  },
  shareBtnText: { fontSize: 15, fontWeight: '700', color: C.white },
  sharePostedBtn: {
    backgroundColor: '#1a2a1a', borderWidth: 0.5, borderColor: '#2a5a2a',
    borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginBottom: 10,
  },
  sharePostedBtnText: { fontSize: 14, fontWeight: '600', color: C.green },

  sharePreview: {
    marginHorizontal: 24, marginBottom: 20, borderRadius: 16,
    height: 180, overflow: 'hidden', backgroundColor: '#111',
  },
  sharePreviewPhoto: { width: '100%', height: '100%' },
  sharePreviewFallback: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a',
  },
  shareScoreBadge: {
    position: 'absolute', top: 10, right: 10,
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
  },
  shareScoreNum: { fontSize: 15, fontWeight: '800', color: '#fff', lineHeight: 17 },
  shareScoreDen: { fontSize: 9, color: 'rgba(255,255,255,0.65)', lineHeight: 11 },
  shareTierRibbon: {
    position: 'absolute', top: 10, left: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  shareTierText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  sharePreviewBottom: {
    position: 'absolute', bottom: 10, left: 12, right: 12,
  },
  sharePreviewName: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  charCount: { fontSize: 11, color: C.gray3, textAlign: 'right', marginTop: 4 },
});
