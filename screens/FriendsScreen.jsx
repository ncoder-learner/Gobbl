import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, SafeAreaView, StatusBar, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purple: '#8855cc', purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a',
  purpleText: '#ddb8ff', white: '#ffffff', gray1: '#888888', gray2: '#666666',
  gray4: '#444444', green: '#00c896', red: '#ff4444', redDim: '#2a0a0a',
  inputBg: '#161616',
};

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
        {loading === 'accept' ? (
          <ActivityIndicator color={C.orange} size="small" />
        ) : (
          <TouchableOpacity style={styles.acceptBtn} onPress={accept} disabled={!!loading}>
            <Text style={styles.acceptBtnText}>✓</Text>
          </TouchableOpacity>
        )}
        {loading === 'decline' ? (
          <ActivityIndicator color={C.gray2} size="small" />
        ) : (
          <TouchableOpacity style={styles.declineBtn} onPress={decline} disabled={!!loading}>
            <Text style={styles.declineBtnText}>✕</Text>
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
  const [loading, setLoading]             = useState(true);
  const [incoming, setIncoming]           = useState([]);
  const [outgoing, setOutgoing]           = useState([]);
  const [friends, setFriends]             = useState([]);

  // Search state
  const [query, setQuery]                 = useState('');
  const [searching, setSearching]         = useState(false);
  const [searchResult, setSearchResult]   = useState(null); // profile | 'not_found' | null
  const [sentIds, setSentIds]             = useState(new Set());

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

  async function handleSearch() {
    const q = query.trim().toLowerCase().replace('@', '');
    if (!q) return;
    setSearching(true);
    setSearchResult(null);

    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .ilike('username', q)
        .neq('id', myId)
        .limit(1);

      if (!profiles?.length) {
        setSearchResult('not_found');
        return;
      }

      const profile = profiles[0];

      // Check existing friendship status
      const { data: existing } = await supabase
        .from('friendships')
        .select('id, status, requester_id')
        .or(
          `and(requester_id.eq.${myId},addressee_id.eq.${profile.id}),` +
          `and(requester_id.eq.${profile.id},addressee_id.eq.${myId})`
        )
        .maybeSingle();

      let status = null;
      if (existing) {
        if (existing.status === 'accepted') status = 'accepted';
        else if (existing.status === 'pending') {
          status = existing.requester_id === myId ? 'outgoing' : 'incoming';
        }
      }
      if (sentIds.has(profile.id)) status = 'outgoing';

      setSearchResult({ ...profile, _status: status });
    } catch {
      setSearchResult('not_found');
    } finally {
      setSearching(false);
    }
  }

  function handleRequestSent(profileId) {
    setSentIds(prev => new Set([...prev, profileId]));
    setSearchResult(prev => prev && prev.id ? { ...prev, _status: 'outgoing' } : prev);
    // Optimistically add to outgoing list
    loadFriends();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Friends</Text>
        <View style={{ width: 22 }} />
      </View>

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
              {/* Search */}
              <View style={styles.searchSection}>
                <Text style={styles.sectionLabel}>Find by username</Text>
                <View style={styles.searchRow}>
                  <View style={styles.searchInputWrap}>
                    <Text style={styles.searchAt}>@</Text>
                    <TextInput
                      style={styles.searchInput}
                      value={query}
                      onChangeText={text => {
                        setQuery(text);
                        setSearchResult(null);
                      }}
                      placeholder="username"
                      placeholderTextColor={C.gray4}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={handleSearch}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.searchBtn, searching && { opacity: 0.6 }]}
                    onPress={handleSearch}
                    disabled={searching}
                    activeOpacity={0.85}
                  >
                    {searching
                      ? <ActivityIndicator color={C.white} size="small" />
                      : <Text style={styles.searchBtnText}>Search</Text>
                    }
                  </TouchableOpacity>
                </View>

                {searchResult === 'not_found' ? (
                  <Text style={styles.notFound}>No user found with that username.</Text>
                ) : searchResult ? (
                  <SearchResult
                    profile={searchResult}
                    myId={myId}
                    onRequestSent={handleRequestSent}
                  />
                ) : null}
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
    paddingHorizontal: 20, paddingVertical: 14,
  },
  headerTitle: {
    fontWeight: '700', fontSize: 17, color: C.white, fontWeight: '700',
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

  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inputBg, borderWidth: 0.5, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 12, height: 44,
  },
  searchAt: { fontSize: 16, color: C.gray2, marginRight: 4 },
  searchInput: { flex: 1, fontSize: 15, color: C.white },
  searchBtn: {
    backgroundColor: C.orange, borderRadius: 12,
    paddingHorizontal: 16, height: 44, alignItems: 'center', justifyContent: 'center',
  },
  searchBtnText: { fontSize: 14, fontWeight: '600', color: C.white },
  notFound: { fontSize: 13, color: C.gray2, marginTop: 2, marginBottom: 8 },

  personRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
    gap: 12,
  },
  avatar: {
    backgroundColor: C.purpleDim, borderWidth: 1, borderColor: C.purpleBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { color: C.purpleText, fontWeight: '700' },
  personInfo: { flex: 1 },
  personUsername: { fontSize: 14, fontWeight: '600', color: C.white },
  personDisplay: { fontSize: 12, color: C.gray1, marginTop: 1 },
  requestLabel: { fontSize: 11, color: C.gray2, marginTop: 2 },

  requestActions: { flexDirection: 'row', gap: 6 },
  acceptBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#0a2a18', borderWidth: 1, borderColor: '#1a4a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  acceptBtnText: { fontSize: 15, color: C.green, fontWeight: '700' },
  declineBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2a0a0a', borderWidth: 1, borderColor: '#4a1a1a',
    alignItems: 'center', justifyContent: 'center',
  },
  declineBtnText: { fontSize: 14, color: C.red, fontWeight: '600' },

  addBtn: {
    backgroundColor: C.orange, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  addBtnText: { fontSize: 13, fontWeight: '600', color: C.white },
  statusPill: {
    borderWidth: 1, borderColor: C.green, borderRadius: 10,
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
