-- 033_diet_spot_default.sql
-- The `spot` column on user_diet_preferences was added manually in the
-- Supabase console without a DEFAULT, causing NOT NULL violations on
-- every upsert from the app. This migration retroactively adds the default
-- so upserts that omit `spot` succeed without touching existing data.

ALTER TABLE user_diet_preferences
  ADD COLUMN IF NOT EXISTS spot TEXT NOT NULL DEFAULT 'general';

-- Patch any existing rows that have NULL.
UPDATE user_diet_preferences SET spot = 'general' WHERE spot IS NULL;
