import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ONBOARDING_SLIDES } from '../lib/onboardingContent';
import OnboardingCarousel from '../components/OnboardingCarousel';

// First-run wrapper around the shared carousel UI — marks
// profiles.onboarding_completed on finish. See AccountScreen's "How it
// works" for the no-op replay of the same slides.
export default function OnboardingScreen({ onDone }) {
  const [saving, setSaving] = useState(false);

  async function handleComplete() {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase.from('profiles').upsert({
          id: user.id,
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        });
        // Still let the user through either way — re-showing this carousel
        // once more next launch is annoying but not harmful, and blocking
        // "Let's eat!" on a network hiccup would be worse. But App.js's
        // startup gate (App.js:319-351) re-reads onboarding_completed from
        // the DB on every load, so a silently swallowed failure here does
        // mean it comes back — worth at least logging so it's visible.
        if (error) console.warn('[Onboarding] failed to persist onboarding_completed:', error.message);
      }
    } catch (err) {
      console.warn('[Onboarding] failed to persist onboarding_completed:', err?.message ?? err);
    } finally {
      setSaving(false);
      onDone();
    }
  }

  return (
    <OnboardingCarousel
      slides={ONBOARDING_SLIDES}
      finalCtaLabel="Let's eat! 🍴"
      onFinish={handleComplete}
    />
  );
}
