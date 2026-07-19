import { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { THEME as C } from '../lib/theme';

const { width: W } = Dimensions.get('window');

// Pure carousel UI, no completion/persistence logic — OnboardingScreen wraps
// this for the real first-run flow (marks onboarding_completed), AccountScreen's
// "How it works" wraps it for a no-op replay. Keeping the UI here means the
// two can never visually drift apart.
export default function OnboardingCarousel({ slides, finalCtaLabel = "Let's eat! 🍴", showClose = false, onClose, onFinish }) {
  const scrollRef = useRef(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const totalSlides = slides.length;

  function handleScroll(e) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / W);
    if (idx !== currentIdx) setCurrentIdx(idx);
  }

  function goTo(idx) {
    scrollRef.current?.scrollTo({ x: idx * W, animated: true });
    setCurrentIdx(idx);
  }

  function handleNext() {
    if (currentIdx < totalSlides - 1) {
      goTo(currentIdx + 1);
    } else {
      onFinish();
    }
  }

  const isLastSlide = currentIdx === totalSlides - 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {showClose && (
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color={C.gray1} />
        </TouchableOpacity>
      )}

      {/* Shared across every slide (outside the paged ScrollView) rather
          than per-slide, so it doesn't reset/re-animate on swipe. */}
      <View style={styles.brandRow}>
        <Image source={require('../assets/logo-mark.png')} style={styles.brandLogo} />
        <Image source={require('../assets/wordmark.png')} style={styles.brandWordmark} />
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        decelerationRate="fast"
        disableIntervalMomentum
        bounces={false}
        style={styles.scrollView}
      >
        {slides.map((slide, i) => (
          <View key={i} style={styles.slide}>
            <View style={styles.artBox}>
              <LinearGradient
                colors={['#161616', '#000000']}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.slideEmoji}>{slide.emoji}</Text>
            </View>
            <Text style={styles.slideTitle}>{slide.title}</Text>
            <Text style={styles.slideBody}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Progress dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: totalSlides }).map((_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => goTo(i)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={[styles.dot, i === currentIdx && styles.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Next / final CTA */}
      <View style={styles.ctaWrap}>
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaBtnText}>
            {isLastSlide ? finalCtaLabel : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  closeBtn: {
    position: 'absolute', top: 12, right: 16, zIndex: 1,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  brandRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 8, marginBottom: 4,
  },
  brandLogo: { width: 24, height: 24, resizeMode: 'contain' },
  brandWordmark: { height: 24, aspectRatio: 494 / 250, resizeMode: 'contain' },

  scrollView: { flex: 1 },

  slide: {
    width: W,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },

  artBox: {
    width: 130,
    height: 130,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.glassBorder,
  },
  slideEmoji: { fontSize: 58 },

  slideTitle: {
    fontFamily: C.serif,
    fontSize: 30,
    color: C.white,
    textAlign: 'center',
    marginBottom: 14,
  },
  slideBody: {
    fontSize: 15,
    color: C.gray1,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(245,245,247,0.15)' },
  dotActive: { width: 20, height: 6, borderRadius: 3, backgroundColor: C.orange },

  ctaWrap: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8 },
  ctaBtn: {
    borderRadius: C.pill,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: C.white,
  },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: C.bg, letterSpacing: 0.2 },
});
