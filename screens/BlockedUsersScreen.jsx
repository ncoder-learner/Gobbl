import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const C = {
  bg: '#0d0d0d', surface: '#1a1a1a', border: '#2a2a2a',
  orange: '#FF6B3D', purpleDim: '#1a0d1a', purpleBorder: '#3a2a4a', purpleText: '#ddb8ff',
  white: '#ffffff', gray1: '#888888', gray2: '#666666', gray4: '#444444',
};

function BlockedRow({ block, onUnblock }) {
  const [loading, setLoading] = useState(false);
  const label = block.username ? `@${block.username}` : 'Blocked user';
  const initials = (block.username?.[0] ?? '?').toUpperCase();

  function confirmUnblock() {
    Alert.alert(
      `Unblock ${label}?`,
      "You'll be able to see each other's posts, profiles, and comments again.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: doUnblock },
      ]
    );
  }

  async function doUnblock() {
    setLoading(true);
    try {
      const { error } = await supabase.from('blocks').delete().eq('id', block.id);
      if (error) throw error;
      onUnblock(block.id);
    } catch (err) {
      Alert.alert('Error', err.message);
      setLoading(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>{initials}</Text>
      </View>
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      {loading ? (
        <ActivityIndicator color={C.orange} />
      ) : (
        <TouchableOpacity style={styles.unblockBtn} onPress={confirmUnblock} activeOpacity={0.8}>
          <Text style={styles.unblockBtnText}>Unblock</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function BlockedUsersScreen() {
  const navigation = useNavigation();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadBlocks();
    }, [])
  );

  async function loadBlocks() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_my_blocked_profiles');
      if (error) throw error;

      setBlocks((data || []).map(row => ({
        id: row.block_id,
        blocked_id: row.blocked_id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        created_at: row.created_at,
      })));
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }

  function handleUnblocked(blockId) {
    setBlocks(prev => prev.filter(b => b.id !== blockId));
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Blocked Users</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.orange} />
        </View>
      ) : (
        <FlatList
          data={blocks}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <BlockedRow block={item} onUnblock={handleUnblocked} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>You haven't blocked anyone.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  navTitle: { fontSize: 15, fontWeight: '600', color: C.white },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.purpleDim, borderWidth: 1, borderColor: C.purpleBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontSize: 15, fontWeight: '700', color: C.purpleText },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: C.white },

  unblockBtn: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  unblockBtnText: { fontSize: 13, fontWeight: '600', color: C.gray1 },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: C.gray2 },
});
