import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Pressable, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', white: '#ffffff', gray1: '#888888', gray2: '#666666',
  inputBg: '#161616', purple: '#8855cc', purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a',
  purpleText: '#ddb8ff',
};

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function CommentRow({ comment, myId, onDelete }) {
  const profile = comment.profiles;
  const isOwn = comment.user_id === myId;
  const initial = (profile?.username?.[0] ?? '?').toUpperCase();

  return (
    <View style={styles.commentRow}>
      <View style={styles.commentAvatar}>
        {profile?.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.commentAvatarImage} />
        ) : (
          <Text style={styles.commentAvatarLetter}>{initial}</Text>
        )}
      </View>
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Text style={styles.commentUsername}>@{profile?.username ?? '…'}</Text>
          <Text style={styles.commentTime}>{timeAgo(comment.created_at)}</Text>
        </View>
        <Text style={styles.commentContent}>{comment.content}</Text>
      </View>
      {isOwn && (
        <TouchableOpacity onPress={() => onDelete(comment.id)} hitSlop={10} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={14} color={C.gray2} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// `mealId` is optional: pass it when this sheet is scoped to one specific
// meal-in-a-slot (SlotViewerScreen, MealDetailScreen) so comments filter to
// and get inserted against that meal only. Omit it for a post-level surface
// (FeedScreen's card, which shows all 1-3 slots at once and has no single
// meal to scope to) — falls back to the pre-migration post_id-only
// behavior, showing every comment across the whole post.
export default function CommentSheet({ visible, postId, mealId, postOwnerId, onDismiss, onCommentPosted }) {
  const [comments, setComments]   = useState([]);
  const [myId, setMyId]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [text, setText]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible && postId) {
      loadComments();
    } else {
      setComments([]);
      setText('');
    }
  }, [visible, postId, mealId]);

  async function loadComments() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMyId(user?.id ?? null);

      let query = supabase
        .from('post_comments')
        .select('id, user_id, content, created_at, profiles!post_comments_user_id_fkey(username, avatar_url)')
        .order('created_at', { ascending: true })
        .limit(100);
      query = mealId ? query.eq('meal_id', mealId) : query.eq('post_id', postId);
      const { data } = await query;

      setComments(data || []);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('post_comments')
        .insert({ post_id: postId, meal_id: mealId, user_id: myId, content: trimmed })
        .select('id, user_id, content, created_at, profiles!post_comments_user_id_fkey(username, avatar_url)')
        .single();

      if (error) throw error;
      setComments(prev => [...prev, data]);
      setText('');
      onCommentPosted?.();

      // Notify post owner if it's someone else's post
      if (postOwnerId && postOwnerId !== myId) {
        const myUsername = data.profiles?.username ?? 'Someone';
        supabase.functions.invoke('send-notification', {
          body: {
            targetUserId: postOwnerId,
            title: '💬 New comment',
            body: `@${myUsername} commented on your meal!`,
          },
        }).catch(() => {});
      }
    } catch {
      // Non-fatal
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteComment(id) {
    setComments(prev => prev.filter(c => c.id !== id));
    await supabase.from('post_comments').delete().eq('id', id).catch(() => {});
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetWrap}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Comments</Text>
              <TouchableOpacity onPress={onDismiss} hitSlop={10}>
                <Ionicons name="close" size={20} color={C.gray1} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={C.orange} />
              </View>
            ) : comments.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
              </View>
            ) : (
              <FlatList
                data={comments}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <CommentRow comment={item} myId={myId} onDelete={deleteComment} />
                )}
                style={styles.list}
                showsVerticalScrollIndicator={false}
              />
            )}

            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Add a comment…"
                placeholderTextColor={C.gray2}
                value={text}
                onChangeText={setText}
                maxLength={300}
                multiline
                returnKeyType="send"
                onSubmitEditing={submit}
              />
              <TouchableOpacity
                onPress={submit}
                disabled={!text.trim() || submitting}
                style={[styles.sendBtn, (!text.trim() || submitting) && styles.sendBtnDisabled]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={C.white} />
                ) : (
                  <Ionicons name="send" size={16} color={C.white} />
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
  },
  sheetWrap: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '75%', minHeight: 280,
    borderTopWidth: 0.5, borderColor: C.border,
  },
  handle: {
    width: 36, height: 4, backgroundColor: C.border,
    borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: C.white },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyBox: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, color: C.gray2, textAlign: 'center' },

  list: { flex: 1 },

  commentRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  commentAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.purpleDim, borderWidth: 1, borderColor: C.purpleBorder,
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1,
    overflow: 'hidden',
  },
  commentAvatarImage: { width: '100%', height: '100%' },
  commentAvatarLetter: { fontSize: 12, fontWeight: '700', color: C.purpleText },
  commentBody: { flex: 1 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  commentUsername: { fontSize: 12, fontWeight: '700', color: C.white },
  commentTime: { fontSize: 11, color: C.gray2 },
  commentContent: { fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 19 },
  deleteBtn: { padding: 4, marginLeft: 6 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 0.5, borderTopColor: C.border, gap: 10,
  },
  input: {
    flex: 1, backgroundColor: C.inputBg, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 9,
    color: C.white, fontSize: 14, maxHeight: 80,
    borderWidth: 0.5, borderColor: C.border,
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: C.border },
});
