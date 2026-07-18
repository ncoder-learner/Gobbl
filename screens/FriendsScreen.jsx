import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, StatusBar, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import { shareProfileLink } from '../lib/profileLink';
import { THEME as C } from '../lib/theme';

const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 280;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InitialsAvatar({ username, displayName, size = 40 }) {
  const letter = (username?.[0] ?? displayName?.[0] ?? '?').toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarLetter, { fontSize: size * 0.4 }]}>{letter}</Text>
    </View>
  );
}

function PersonRow({ profile, action }) {
  return (
    <View style={styles.personRow}>
      <InitialsAvatar username={profile.username} displayName={profile.display_name} />
      <View style={styles.personInfo}>
        <Text style={styles.personUsername}>@{profile.username}</Text>
        {profile.display_name ? (
          <Text style={styles.personDisplay}>{profile.display_name}</Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

// ─── Search result ────────────────────────────────────────────────────────────

function SearchResult({ profile, myId, onRequestSent }) {
  const [actionLoading, setActionLoading] = useState(false);

  async function sendRequest() {
    setActionLoading(true);
    try {
      const { error } = await supabase.from('friendships').insert({
        requester_id: myId,
        addressee_id: profile.id,
      });
      if (error) throw error;
      onRequestSent(profile.id);
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not send request.');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <PersonRow
      profile={profile}
      action={
        actionLoading ? (
          <ActivityIndicator color={C.orange} size="small" />
        ) : profile._status === 'accepted' ? (
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>Friends</Text>
          </View>
        ) : profile._status === 'outgoing' ? (
          <View style={[styles.statusPill, { borderColor: C.gray4 }]}>
            <Text style={[styles.statusPillText, { color: C.gray1 }]}>Sent</Text>
          </View>
        ) : profile._status === 'incoming' ? (
          <TouchableOpacity style={styles.addBtn} onPress={sendRequest}>
            <Text style={styles.addBtnText}>Accept</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={sendRequest}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        )
      }
    />
  );
}

// ─── Incoming request row ─────────────────────────────────────────────────────

function RequestRow({ row, myId, onAccepted, onDeclined }) {
  const [loading, setLoading] = useState(null); // 'accept' | 'decline'
  const profile = row.requester_id === myId ? row.addressee_profile : row.requester_profile;

  async function accept() {
    setLoading('accept');
    try {
      const { error } = await supabase
        .from('friendships').update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      // Notify the requester that their request was accepted
      const accepterUsername = row.addressee_profile?.username ?? row.addressee_profile?.display_name ?? 'Someone';
      supabase.functions.invoke('send-notification', {
        body: {
          targetUserId: row.requester_id,
          title: '🤝 Friend request accepted',
          body: `@${accepterUsername} accepted your friend request!`,
        },
      }).catch(() => {});
      onAccepted(row.id);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(null);
    }
  }

  async function decline() {
    setLoading('decline');
    try {
      const { error } = await supabase.from('friendships').delete().eq('id', row.id);
      if (error) throw error;
      onDeclined(row.id);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(null);
    }
  }

  if (!profile) return null;

  return (
    <View style={styles.personRow}>
      <InitialsAvatar username={profile.username} displayName={profile.display_name} />
      <View style={styles.personInfo}>
        <Text style={styles.personUsername}>@{profile.username}</Text>
        {profile.display_name ? <Text style={styles.personDisplay}>{profile.display_name}</Text> : null}
        <Text style={styles.requestLabel}>Wants to be friends</Text>
      </View>
      <View style={styles.requestActions}>
        {loading === 'decline' ? (
          <ActivityIndicator color={C.gray2} size="small" />
        ) : (
          <TouchableOpacity style={styles.declineBtn} onPress={decline} disabled={!!loading}>
            <Text style={styles.declineBtnText}>✕</Text>
          </TouchableOpacity>
        )}
        {loading === 'accept' ? (
          <View style={styles.acceptBtn}>
            <ActivityIndicator color={C.bg} size="small" />
          </View>
        ) : (
          <TouchableOpacity onPress={accept} disabled={!!loading} activeOpacity={0.85}>
            <LinearGradient colors={[C.orange, C.orangeDim]} style={styles.acceptBtn}>
              <Text style={styles.acceptBtnText}>Accept</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Friend row ───────────────────────────────────────────────────────────────

function FriendRow({ row, myId, onNavigate, onRemoved }) {
  const [loading, setLoading] = useState(false);
  const profile = row.requester_id === myId ? row.addressee_profile : row.requester_profile;

  async function removeFriend() {
    Alert.alert(
      `Remove @${profile.username}?`,
      'They won\'t be notified, but you\'ll stop seeing each other\'s posts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.from('friendships').delete().eq('id', row.id);
              if (error) throw error;
              onRemoved(row.id);
            } catch (err) {
              Alert.alert('Error', err.message);
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  if (!profile) return null;

  return (
    <TouchableOpacity style={styles.personRow} onPress={() => onNavigate(profile.id)} activeOpacity={0.75}>
      <InitialsAvatar username={profile.username} displayName={profile.display_name} />
      <View style={styles.personInfo}>
        <Text style={styles.personUsername}>@{profile.username}</Text>
        {profile.display_name ? <Text style={styles.personDisplay}>{profile.display_name}</Text> : null}
      </View>
      {loading ? (
        <ActivityIndicator color={C.gray2} size="small" />
      ) : (
        <TouchableOpacity
          onPress={removeFriend}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="person-remove-outline" size={18} color={C.gray4} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const navigation = useNavigation();

  const [myId, setMyId]                   = useState(null);
  const [myUsername, setMyUsername]       = useState(null);
  const [loading, setLoading]             = useState(true);
  const [incoming, setIncoming]           = useState([]);
  const [outgoing, setOutgoing]           = useState([]);
  const [friends, setFriends]             = useState([]);

  // Search state — live, debounced as the user types
  const [query, setQuery]                 = useState('');
  const [searching, setSearching]         = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [sentIds, setSentIds]             = useState(new Set());
  const debounceRef = useRef(null);
  const abortRef     = useRef(null);
  const searchSeqRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      loadFriends();
    }, [])
  );

  async function loadFriends() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMyId(user.id);
      supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
        .then(({ data }) => { if (data?.username) setMyUsername(data.username); })
        .catch(() => {});

      const { data, error } = await supabase
        .from('friendships')
        .select(`
          id, requester_id, addressee_id, status, created_at,
          requester_profile:profiles!requester_id(id, username, display_name, avatar_url),
          addressee_profile:profiles!addressee_id(id, username, display_name, avatar_url)
        `)
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = data || [];
      setIncoming(rows.filter(r => r.status === 'pending' && r.addressee_id === user.id));
      setOutgoing(rows.filter(r => r.status === 'pending' && r.requester_id === user.id));
      setFriends(rows.filter(r => r.status === 'accepted'));
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }

  // Debounced (280ms) live search: cancels the previous in-flight request via
  // AbortController and a request sequence number, so a slow earlier response
  // can never overwrite a newer one's results.
  async function runSearch(q) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++searchSeqRef.current;

    setSearching(true);
    try {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .or(`username.ilike.${q}%,display_name.ilike.${q}%`)
        .neq('id', myId)
        .limit(SEARCH_LIMIT)
        .abortSignal(controller.signal);
      if (error) throw error;
      if (seq !== searchSeqRef.current) return; // superseded by a newer query

      let results = profiles || [];
      if (results.length && myId) {
        const { data: friendships } = await supabase
          .from('friendships')
          .select('id, status, requester_id, addressee_id')
          .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`)
          .abortSignal(controller.signal);
        if (seq !== searchSeqRef.current) return;

        const statusById = new Map();
        (friendships || []).forEach(f => {
          const otherId = f.requester_id === myId ? f.addressee_id : f.requester_id;
          if (f.status === 'accepted') statusById.set(otherId, 'accepted');
          else if (f.status === 'pending') {
            statusById.set(otherId, f.requester_id === myId ? 'outgoing' : 'incoming');
          }
        });
        results = results.map(p => ({
          ...p,
          _status: sentIds.has(p.id) ? 'outgoing' : (statusById.get(p.id) ?? null),
        }));
      }

      setSearchResults(results);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (seq === searchSeqRef.current) setSearchResults([]);
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }

  function handleQueryChange(text) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = text.trim().toLowerCase().replace('@', '');
    if (!q) {
      abortRef.current?.abort();
      searchSeqRef.current++; // invalidate any in-flight response
      setSearchResults([]);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function handleRequestSent(profileId) {
    setSentIds(prev => new Set([...prev, profileId]));
    setSearchResults(prev => prev.map(p => p.id === profileId ? { ...p, _status: 'outgoing' } : p));
    // Optimistically add to outgoing list
    loadFriends();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={C.white} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => shareProfileLink(myUsername)} hitSlop={12}>
          <Ionicons name="share-outline" size={22} color={C.white} />
        </TouchableOpacity>
      </View>
      <Text style={styles.pageTitle}>Friends</Text>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={friends}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <FriendRow
              row={item}
              myId={myId}
              onNavigate={userId => navigation.navigate('UserProfile', { userId })}
              onRemoved={id => setFriends(prev => prev.filter(f => f.id !== id))}
            />
          )}
          ListHeaderComponent={
            <>
              {/* Search — live as you type, debounced */}
              <View style={styles.searchSection}>
                <Text style={styles.sectionLabel}>Find by username</Text>
                <View style={styles.searchInputWrap}>
                  <Text style={styles.searchAt}>@</Text>
                  <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={handleQueryChange}
                    placeholder="username"
                    placeholderTextColor={C.gray4}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {searching && <ActivityIndicator color={C.gray2} size="small" />}
                </View>

                {!searching && query.trim() && searchResults.length === 0 ? (
                  <Text style={styles.notFound}>No users found for "{query.trim()}".</Text>
                ) : null}

                {searchResults.map(profile => (
                  <SearchResult
                    key={profile.id}
                    profile={profile}
                    myId={myId}
                    onRequestSent={handleRequestSent}
                  />
                ))}
              </View>

              {/* Incoming requests */}
              {incoming.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    Friend requests{incoming.length > 0 ? ` (${incoming.length})` : ''}
                  </Text>
                  {incoming.map(row => (
                    <RequestRow
                      key={row.id}
                      row={row}
                      myId={myId}
                      onAccepted={id => {
                        setIncoming(prev => prev.filter(r => r.id !== id));
                        loadFriends();
                      }}
                      onDeclined={id => setIncoming(prev => prev.filter(r => r.id !== id))}
                    />
                  ))}
                </View>
              )}

              {/* Outgoing pending */}
              {outgoing.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Pending sent</Text>
                  {outgoing.map(row => {
                    const profile = row.addressee_profile;
                    if (!profile) return null;
                    return (
                      <View key={row.id} style={styles.personRow}>
                        <InitialsAvatar username={profile.username} displayName={profile.display_name} />
                        <View style={styles.personInfo}>
                          <Text style={styles.personUsername}>@{profile.username}</Text>
                          {profile.display_name ? <Text style={styles.personDisplay}>{profile.display_name}</Text> : null}
                        </View>
                        <TouchableOpacity
                          onPress={async () => {
                            await supabase.from('friendships').delete().eq('id', row.id);
                            setOutgoing(prev => prev.filter(r => r.id !== row.id));
                          }}
                        >
                          <Text style={styles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Friends header */}
              {(loading || friends.length > 0) && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {friends.length > 0 ? `Friends (${friends.length})` : 'Friends'}
                  </Text>
                </View>
              )}
            </>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.noFriends}>
                <Text style={styles.noFriendsText}>No friends yet — find someone above!</Text>
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      </KeyboardAvoidingView>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={C.orange} />
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  listContent: { paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 14,
  },
  pageTitle: {
    fontFamily: C.serif, fontSize: 34, color: C.white,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4,
  },

  searchSection: {
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8,
    marginBottom: 4,
  },
  section: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  sectionLabel: {
    fontSize: 12, color: C.gray2, fontWeight: '600', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: 12,
  },

  searchInputWrap: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 14, paddingHorizontal: 14, height: 44,
  },
  searchAt: { fontSize: 16, color: C.gray2, marginRight: 4 },
  searchInput: { flex: 1, fontSize: 15, color: C.white },
  notFound: { fontSize: 13, color: C.gray2, marginTop: 2, marginBottom: 8 },

  personRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
    gap: 12,
  },
  avatar: {
    backgroundColor: '#242424', borderWidth: 1, borderColor: C.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontFamily: C.serif, color: C.white },
  personInfo: { flex: 1 },
  personUsername: { fontSize: 14, fontWeight: '600', color: C.white },
  personDisplay: { fontSize: 12, color: C.gray1, marginTop: 1 },
  requestLabel: { fontSize: 11, color: C.gray2, marginTop: 2 },

  requestActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  acceptBtn: {
    paddingHorizontal: 16, height: 32, borderRadius: C.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  acceptBtnText: { fontSize: 13, color: C.bg, fontWeight: '700' },
  declineBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2a0a0a', borderWidth: 1, borderColor: '#4a1a1a',
    alignItems: 'center', justifyContent: 'center',
  },
  declineBtnText: { fontSize: 14, color: C.red, fontWeight: '600' },

  addBtn: {
    backgroundColor: C.orange, borderRadius: C.pill,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: C.white },
  statusPill: {
    borderWidth: 1, borderColor: C.green, borderRadius: C.pill,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  statusPillText: { fontSize: 12, color: C.green, fontWeight: '600' },
  cancelText: { fontSize: 13, color: C.gray2 },

  noFriends: { paddingHorizontal: 20, paddingVertical: 12 },
  noFriendsText: { fontSize: 14, color: C.gray2 },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,13,13,0.5)',
  },
});
