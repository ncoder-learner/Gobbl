import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import mobileAds, {
  BannerAd,
  BannerAdSize,
  TestIds,
  useForeground,
} from 'react-native-google-mobile-ads';
import { THEME as C } from '../lib/theme';

let adsInitPromise;

function initializeAdsOnce() {
  if (!adsInitPromise) {
    adsInitPromise = mobileAds().initialize();
  }
  return adsInitPromise;
}

const bannerUnitId = process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID || TestIds.ADAPTIVE_BANNER;

export default function AdMobBanner() {
  const bannerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    initializeAdsOnce()
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch(() => {
        if (mounted) setFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useForeground(() => {
    if (Platform.OS === 'ios') bannerRef.current?.load();
  });

  if (!ready || failed) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Advertisement</Text>
      <View style={styles.bannerBox}>
        <BannerAd
          ref={bannerRef}
          unitId={bannerUnitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          onAdFailedToLoad={() => setFailed(true)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  label: {
    marginBottom: 8,
    fontSize: 10,
    fontWeight: '600',
    color: C.gray3,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bannerBox: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
