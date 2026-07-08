import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  StatusBar, Dimensions, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_COLS  = 2;
const GRID_GAP   = 10;
const CARD_WIDTH = (SCREEN_WIDTH - 32 - GRID_GAP) / GRID_COLS;
const CARD_HEIGHT = CARD_WIDTH * 1.4;

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc', purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a',
  purpleText: '#ddb8ff', white: '#ffffff', gray1: '#888888', gray2: '#666666',
  gray4: '#444444', green: '#00c896', red: '#ff4444',
};

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'inappropriate', label: 'Inappropriate' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' },
];

function scoreToneColor(score) {
  const n = typeof score === 'number' ? score : Number(score);
  if (n < 3) return '#e5484d';
  if (n < 5) return '#f5a524';
  if (n < 7) return '#FF6B3D';
  if (n < 9) return '#00c896';
  return '#ffd166';
}

function formatScore(score) {
  const n = typeof score === 'number' ? score : Number(score);
  return isNaN(n) ? '—' : n.toFixed(1);
}

// ─── Mini post card (grid layout) ────────────────────────────────────────────

function MiniPostCard({ post }) {
  const meal  = post.meals;
  if (!meal) return null;
  const color = scoreToneColor(meal.score);

  return (
    <View style={styles.gridCard}>
      {meal.photo_url ? (
        <Image source={{ uri: meal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.gridNoPhoto]}>
          <Text style={styles.gridEmoji}>{meal.emoji || '🍽️'}</Text>
        </View>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']}
        locations={[0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.gridScoreBadge, { backgroundColor: color }]}>
        <Text style={styles.gridScoreText}>{formatScore(meal.score)}</Text>
      </View>
      {post.tier_rank != null && post.tier_rank <= 10 && (
        <View style={[styles.gridTierPill, { borderColor: color + 'aa' }]}>
          <Text style={[styles.gridTierText, { color }]}>#{post.tier_rank}</Text>
        </View>
      )}
      <Text style={styles.gridMealName} numberOfLines={1}>{meal.name}</Text>
    </View>
  );
}

// ─── Locked posts placeholder ─────────────────────────────────────────────────

function LockedPosts() {
  return (
    <View style={styles.locked}>
      <Ionicons name="lock-closed-outline" size={32} color={C.gray4} />
      <Text style={styles.lockedTitle}>Posts visible to friends</Text>
      <Text style={styles.lockedSub}>Add this person to see their meals.</Text>
    </View>
  );
}

// ─── Friend action button ─────────────────────────────────────────────────────

function FriendButton({ status, friendshipId, targetId, myId, onStatusChange }) {
  const [loading, setLoading] = useState(false);

  async function sendRequest() {
    setLoading(true);
    try {
      const { error } = await supabase.from('friendships').insert({
        requester_id: myId, addressee_id: targetId,
      });
      if (error) throw error;
      onStatusChange('outgoing', null);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelRequest() {
    setLoading(true);
    try {
      await supabase.from('friendships').delete().eq('id', friendshipId);
      onStatusChange(null, null);
    } catch { } finally { setLoading(false); }
  }

  async function acceptRequest() {
    setLoading(true);
    try {
      await supabase.from('friendships')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', friendshipId);
      onStatusChange('accepted', friendshipId);
    } catch { } finally { setLoading(false); }
  }

  async function removeFriend() {
    Alert.alert('Remove friend?', 'You\'ll stop seeing each other\'s posts.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setLoading(true);
          try {
            await supabase.from('friendships').delete().eq('id', friendshipId);
            onStatusChange(null, null);
          } catch { } finally { setLoading(false); }
        },
      },
    ]);
  }

  if (loading) return <ActivityIndicator color={C.orange} style={{ marginTop: 4 }} />;

  if (!status) {
    return (
      <TouchableOpacity style={styles.friendBtn} onPress={sendRequest} activeOpacity={0.85}>
        <Text style={styles.friendBtnText}>Add Friend</Text>
      </TouchableOpacity>
    );
  }
  if (status === 'outgoing') {
    return (
      <TouchableOpacity style={styles.friendBtnOutline} onPress={cancelRequest} activeOpacity={0.85}>
        <Text style={styles.friendBtnOutlineText}>Request Sent · Cancel</Text>
      </TouchableOpacity>
    );
  }
  if (status === 'incoming') {
    return (
      <TouchableOpacity style={[styles.friendBtn, { backgroundColor: C.green }]} onPress={acceptRequest} activeOpacity={0.85}>
        <Text style={styles.friendBtnText}>Accept Request</Text>
      </TouchableOpacity>
    );
  }
  if (status === 'accepted') {
    return (
      <TouchableOpacity style={styles.friendBtnOutline} onPress={removeFriend} activeOpacity={0.85}>
        <Text style={styles.friendBtnOutlineText}>Friends ✓</Text>
      </TouchableOpacity>
    );
  }
  return null;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function UserProfileScreen() {
  const navigation = useNavigation();
  const { userId } = useRoute().params;

  const [myId, setMyId]               = useState(null);
  const [profile, setProfile]         = useState(null);
  const [posts, setPosts]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [friendStatus, setFriendStatus] = useState(null); // null | 'accepted' | 'outgoing' | 'incoming'
  const [friendshipId, setFriendshipId] = useState(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function openActionMenu() {
    Alert.alert(
      '@' + (profile?.username || 'user'),
      undefined,
      [
        { text: 'Report', onPress: openReportModal },
        { text: 'Block', style: 'destructive', onPress: confirmBlock },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  function openReportModal() {
    setReportModalVisible(true);
  }

  async function submitReport(reason) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('reports').insert({
        reporter_id: myId, reported_id: userId, content_type: 'user', reason, status: 'pending',
      });
      if (error) throw error;
      setReportModalVisible(false);
      Alert.alert('Report submitted', 'Thanks for helping keep the community safe.');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBlock() {
    try {
      const { error } = await supabase.from('blocks').insert({
        blocker_id: myId, blocked_id: userId,
      });
      if (error && error.code !== '23505') throw error;
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  function confirmBlock() {
    Alert.alert(
      'Block @' + (profile.username || 'user') + '?',
      "You won't see each other's posts, profiles, or comments. They won't be notified.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: handleBlock },
      ]
    );
  }

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [userId])
  );

  async function loadProfile() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMyId(user.id);
      setIsOwnProfile(user.id === userId);

      const [profileResult, friendResult, postsResult] = await Promise.allSettled([
        supabase.from('profiles')
          .select('id, username, display_name, avatar_url')
          .eq('id', userId)
          .maybeSingle(),

        user.id !== userId
          ? supabase.from('friendships')
              .select('id, status, requester_id')
              .or(
                `and(requester_id.eq.${user.id},addressee_id.eq.${userId}),` +
                `and(requester_id.eq.${userId},addressee_id.eq.${user.id})`
              )
              .maybeSingle()
          : Promise.resolve({ value: null }),

        supabase.from('posts')
          .select(`id, tier_rank, created_at, meals(id, name, emoji, score, photo_url)`)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      if (profileResult.status === 'fulfilled') {
        setProfile(profileResult.value.data);
        setNotFound(!profileResult.value.data);
      } else {
        setNotFound(true);
      }

      if (friendResult.status === 'fulfilled') {
        const f = friendResult.value?.data ?? friendResult.value?.value;
        if (f) {
          setFriendshipId(f.id);
          if (f.status === 'accepted') {
            setFriendStatus('accepted');
          } else if (f.status === 'pending') {
            setFriendStatus(f.requester_id === user.id ? 'outgoing' : 'incoming');
          }
        } else {
          setFriendStatus(null);
          setFriendshipId(null);
        }
      }

      if (postsResult.status === 'fulfilled') {
        setPosts(postsResult.value.data || []);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }

  const isFriend = friendStatus === 'accepted' || isOwnProfile;
  const initials = (profile?.username?.[0] ?? profile?.display_name?.[0] ?? '?').toUpperCase();

  const listHeader = (
    <View style={styles.profileHeader}>
      {/* Avatar */}
      <View style={styles.bigAvatar}>
        <Text style={styles.bigAvatarLetter}>{initials}</Text>
      </View>

      {/* Name info */}
      {profile?.display_name ? (
        <Text style={styles.displayName}>{profile.display_name}</Text>
      ) : null}
      <Text style={styles.username}>@{profile?.username ?? '…'}</Text>

      {/* Friend button (only for other users) */}
      {!isOwnProfile && profile && (
        <FriendButton
          status={friendStatus}
          friendshipId={friendshipId}
          targetId={userId}
          myId={myId}
          onStatusChange={(newStatus, newId) => {
            setFriendStatus(newStatus);
            setFriendshipId(newId);
            if (newStatus === 'accepted') loadProfile();
          }}
        />
      )}

      {/* Posts section header */}
      <View style={styles.postsSectionHeader}>
        <Text style={styles.postsSectionTitle}>
          {isFriend ? `${posts.length} post${posts.length !== 1 ? 's' : ''}` : 'Posts'}
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={C.white} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.orange} />
        </View>
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={C.white} />
          </TouchableOpacity>
          <Text style={styles.navTitle}></Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.notFoundBox}>
          <Ionicons name="person-remove-outline" size={32} color={C.gray4} />
          <Text style={styles.notFoundText}>This user is unavailable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>@{profile?.username ?? ''}</Text>
        {!isOwnProfile && profile ? (
          <TouchableOpacity onPress={openActionMenu} hitSlop={12}>
            <Ionicons name="ellipsis-vertical" size={22} color={C.white} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      <FlatList
        data={isFriend ? posts : []}
        keyExtractor={item => item.id}
        numColumns={GRID_COLS}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => <MiniPostCard post={item} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          isFriend ? (
            <View style={styles.noPostsBox}>
              <Text style={styles.noPostsText}>No posts yet.</Text>
            </View>
          ) : (
            <LockedPosts />
          )
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />

      {/* Report confirmation modal */}
      <Modal
        visible={reportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !submitting && setReportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Report @{profile?.username ?? 'user'}</Text>
            <Text style={styles.modalBody}>
              What's the issue? Your report is reviewed by our team.
            </Text>

            {REPORT_REASONS.map(r => (
              <TouchableOpacity
                key={r.value}
                style={styles.reasonRow}
                onPress={() => submitReport(r.value)}
                disabled={submitting}
                activeOpacity={0.7}
              >
                <Text style={styles.reasonRowText}>{r.label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn, { marginTop: 10 }]}
              onPress={() => setReportModalVisible(false)}
              disabled={submitting}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 40 },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navTitle: { fontSize: 15, fontWeight: '600', color: C.white },

  profileHeader: {
    alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4,
  },
  bigAvatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.purpleDim, borderWidth: 2, borderColor: C.purpleBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  bigAvatarLetter: { fontSize: 30, fontWeight: '800', color: C.purpleText },
  displayName: { fontSize: 18, fontWeight: '700', color: C.white, marginBottom: 4 },
  username: { fontSize: 14, color: C.gray1, marginBottom: 16 },

  friendBtn: {
    backgroundColor: C.orange, borderRadius: 14,
    paddingHorizontal: 24, paddingVertical: 11, marginBottom: 20,
  },
  friendBtnText: { fontSize: 14, fontWeight: '700', color: C.white },
  friendBtnOutline: {
    borderWidth: 1, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 10, marginBottom: 20,
  },
  friendBtnOutlineText: { fontSize: 13, color: C.gray1 },

  postsSectionHeader: {
    width: '100%', paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: C.border,
    marginBottom: 4,
  },
  postsSectionTitle: { fontSize: 13, color: C.gray2, fontWeight: '600' },

  // Grid
  gridRow: { paddingHorizontal: 16, gap: GRID_GAP, marginBottom: GRID_GAP },
  gridCard: {
    width: CARD_WIDTH, height: CARD_HEIGHT,
    borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#111',
  },
  gridNoPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  gridEmoji: { fontSize: 44 },
  gridScoreBadge: {
    position: 'absolute', top: 8, right: 8,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  gridScoreText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  gridTierPill: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderRadius: 7,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  gridTierText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  gridMealName: {
    position: 'absolute', bottom: 8, left: 8, right: 8,
    fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: '500',
  },

  locked: {
    alignItems: 'center', paddingHorizontal: 36, paddingTop: 40, paddingBottom: 24,
  },
  lockedTitle: { fontSize: 16, fontWeight: '600', color: C.white, marginTop: 12, marginBottom: 6 },
  lockedSub: { fontSize: 13, color: C.gray2, textAlign: 'center' },

  notFoundBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  notFoundText: { fontSize: 16, fontWeight: '600', color: C.white, marginTop: 12, textAlign: 'center' },

  noPostsBox: { paddingHorizontal: 20, paddingTop: 20 },
  noPostsText: { fontSize: 14, color: C.gray2 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.white,
    marginBottom: 10,
  },
  modalBody: {
    fontSize: 14,
    color: C.gray1,
    lineHeight: 20,
    marginBottom: 20,
  },
  reasonRow: {
    paddingVertical: 14,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
  },
  reasonRowText: { fontSize: 15, fontWeight: '600', color: C.white },

  btn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnText: { fontSize: 15, fontWeight: '600', color: C.white },
  cancelBtn: {
    backgroundColor: C.bg,
    borderWidth: 0.5,
    borderColor: C.border,
  },
});
