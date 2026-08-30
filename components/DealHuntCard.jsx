// components/DealHuntCard.jsx
import { View, Text, Image, TouchableOpacity, Linking, StyleSheet } from 'react-native';

export default function DealHuntCard({ deal }) {
  const copyCode = () => {
    if (deal.code) Clipboard.setStringAsync(deal.code);
  };

  return (
    <View style={styles.card}>
      {deal.image_url && (
        <Image source={{ uri: deal.image_url }} style={styles.promoImage} />
      )}

      <View style={styles.content}>
        <View style={styles.header}>
          {deal.deal_businesses?.logo_url && (
            <Image source={{ uri: deal.deal_businesses.logo_url }} style={styles.logo} />
          )}
          <Text style={styles.businessName}>{deal.deal_businesses?.name}</Text>
        </View>

        <Text style={styles.message}>{deal.title}</Text>

        {deal.code ? (
          <TouchableOpacity style={styles.codeBox} onPress={copyCode}>
            <Text style={styles.codeText}>{deal.code}</Text>
            <Text style={styles.copyHint}>tap to copy</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => deal.deep_link_url && Linking.openURL(deal.deep_link_url)}
          >
            <Text style={styles.linkText}>Get Deal</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 220, borderRadius: 14, backgroundColor: '#1a1a1a', marginRight: 10, overflow: 'hidden' },
  promoImage: { width: '100%', height: 100 },
  content: { padding: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  logo: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  businessName: { color: '#fff', fontWeight: '700', fontSize: 13 },
  message: { color: '#ddd', fontSize: 13, marginBottom: 10 },
  codeBox: { borderWidth: 1, borderColor: '#ff8800', borderRadius: 8, padding: 8, alignItems: 'center' },
  codeText: { color: '#ff8800', fontWeight: '700', fontSize: 15, letterSpacing: 1 },
  copyHint: { color: '#888', fontSize: 10, marginTop: 2 },
  linkBtn: { backgroundColor: '#ff8800', borderRadius: 8, padding: 8, alignItems: 'center' },
  linkText: { color: '#000', fontWeight: '700', fontSize: 13 },
});