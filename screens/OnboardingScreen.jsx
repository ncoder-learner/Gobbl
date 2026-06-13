import { useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';

const { width: W } = Dimensions.get('window');

const C = {
  bg: '#0d0d0d',
  surface: '#1a1a1a',
  border: '#2a2a2a',
  orange: '#FF6B3D',
  purple: '#8855cc',
  purpleDim: '#1a0d1a',
  purpleBorder: '#3a2a4a',
  white: '#ffffff',
  gray1: '#888888',
  gray2: '#666666',
  gray4: '#444444',
};

const INFO_SLIDES = [
  {
    emoji: '📸',
    title: 'Log & rate',
    body: 'Snap a photo of anything you eat. FoodWrapped identifies the dish and pre-fills the details — just rate it and keep going.',
  },
  {
    emoji: '🏆',
    title: 'Remember & rank',
    body: 'Every meal you rate is remembered and automatically ranked into your tier list. Never forget what you loved or where it was from.',
  },
  {
    emoji: '👥',
    title: 'See what friends eat',
    body: 'Follow friends to see their ratings and rankings. Find your next meal through people with the same taste.',
  },
];

const TOTAL_SLIDES = INFO_SLIDES.length;

export default function OnboardingScreen({ onDone }) {
  const scrollRef = useRef(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  function handleScroll(e) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / W);
    if (idx !== currentIdx) setCurrentIdx(idx);
  }

  function goTo(idx) {
    scrollRef.current?.scrollTo({ x: idx * W, animated: true });
    setCurrentIdx(idx);
  }

  function handleNext() {
    if (currentIdx < TOTAL_SLIDES - 1) {
      goTo(currentIdx + 1);
    } else {
      handleComplete();
    }
  }

  async function handleComplete() {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').upsert({
          id: user.id,
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (_) {
      // Non-fatal: proceed even if save fails. The gate in App.js trusts local state.
    } finally {
      setSaving(false);
      onDone();
    }
  }

  const isLastSlide = currentIdx === TOTAL_SLIDES - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

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
        {INFO_SLIDES.map((slide, i) => (
          <View key={i} style={styles.slide}>
            <View style={styles.artBox}>
              <LinearGradient
                colors={['#1e0a38', '#2a0d4a']}
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
        {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => goTo(i)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={[styles.dot, i === currentIdx && styles.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Next / Get started CTA */}
      <View style={styles.ctaWrap}>
        <TouchableOpacity
          style={[styles.ctaBtn, saving && styles.ctaBtnDisabled]}
          onPress={handleNext}
          disabled={saving}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['#8855cc', '#6633aa']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.ctaBtnText}>
            {isLastSlide ? "Let's eat! 🍴" : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

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
    borderColor: '#3a1a5a',
  },
  slideEmoji: { fontSize: 58 },

  slideTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: C.white,
    textAlign: 'center',
    letterSpacing: -0.5,
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
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)' },
  dotActive: { width: 20, height: 6, borderRadius: 3, backgroundColor: C.purple },

  ctaWrap: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8 },
  ctaBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    overflow: 'hidden',
  },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: C.white, letterSpacing: 0.2 },
});
