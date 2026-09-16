-- 033_diet_spot_default.sql
-- The `spot` column on user_diet_preferences was added manually in the
-- Supabase console without a DEFAULT, causing NOT NULL violations on
-- every upsert from the app. This migration retroactively adds the default
-- so upserts that omit `spot` succeed without touching existing data.

-- `ADD COLUMN IF NOT EXISTS` does not alter a column that already exists.
-- Add it as nullable first so this migration works for both the existing
-- console-created schema and a fresh local schema, then normalize it below.
ALTER TABLE user_diet_preferences
  ADD COLUMN IF NOT EXISTS spot TEXT;

-- Patch any existing rows that have NULL.
UPDATE user_diet_preferences SET spot = 'general' WHERE spot IS NULL;

ALTER TABLE user_diet_preferences
  ALTER COLUMN spot SET DEFAULT 'general',
  ALTER COLUMN spot SET NOT NULL;
