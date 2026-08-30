-- 027_user_diet_preferences.sql
-- Isolated diet feature data, kept separate from the social/feed schema.

CREATE TABLE IF NOT EXISTS user_diet_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  activity_level TEXT DEFAULT 'moderate'
    CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'athlete')),
  sport TEXT,
  target_calories INTEGER,
  target_protein_g INTEGER,
  target_sodium_mg INTEGER,
  inclusions TEXT[] NOT NULL DEFAULT '{}',
  exclusions TEXT[] NOT NULL DEFAULT '{}',
  medical_note TEXT,
  disclaimer_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_diet_preferences_user_id_idx
  ON user_diet_preferences (user_id);

ALTER TABLE user_diet_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "diet_preferences_select_own" ON user_diet_preferences;
DROP POLICY IF EXISTS "diet_preferences_insert_own" ON user_diet_preferences;
DROP POLICY IF EXISTS "diet_preferences_update_own" ON user_diet_preferences;
DROP POLICY IF EXISTS "diet_preferences_delete_own" ON user_diet_preferences;

CREATE POLICY "diet_preferences_select_own" ON user_diet_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "diet_preferences_insert_own" ON user_diet_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "diet_preferences_update_own" ON user_diet_preferences
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "diet_preferences_delete_own" ON user_diet_preferences
  FOR DELETE USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION set_user_diet_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_diet_preferences_updated_at ON user_diet_preferences;
CREATE TRIGGER trg_user_diet_preferences_updated_at
  BEFORE UPDATE ON user_diet_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_user_diet_preferences_updated_at();
