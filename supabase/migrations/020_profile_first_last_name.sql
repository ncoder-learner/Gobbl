-- 020_profile_first_last_name.sql
-- Adds first_name/last_name for the post-signup profile-info onboarding step
-- (screens/ProfileInfoScreen.jsx). These feed the shared Avatar's initials
-- fallback indirectly: the onboarding step also backfills display_name from
-- them when display_name is still empty, so every existing Avatar call site
-- (which already reads display_name) benefits without further changes.
-- `city` already exists on profiles (used by AccountScreen) but was never
-- captured in a tracked migration — added here too, defensively, so a fresh
-- database created from these migrations alone ends up with the same shape
-- as the live one.
-- profile_details_completed gates the onboarding step itself (mirrors the
-- existing onboarding_completed pattern in App.js) — true once the user has
-- either submitted or skipped it, independent of whether any field was
-- actually filled in.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_details_completed BOOLEAN NOT NULL DEFAULT false;
