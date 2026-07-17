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

  return (
    <OnboardingCarousel
      slides={ONBOARDING_SLIDES}
      finalCtaLabel="Let's eat! 🍴"
      onFinish={handleComplete}
    />
  );
}
