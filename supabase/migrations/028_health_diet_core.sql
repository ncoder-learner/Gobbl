-- 028_health_diet_core.sql
-- Completes the isolated health/diet data model from the Phase 3 plan.

ALTER TABLE user_diet_preferences
  ADD COLUMN IF NOT EXISTS primary_goal TEXT NOT NULL DEFAULT 'no_restriction',
  ADD COLUMN IF NOT EXISTS calories INTEGER NOT NULL DEFAULT 2200,
  ADD COLUMN IF NOT EXISTS protein_grams INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS carbs_grams INTEGER NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS fat_grams INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS sodium_mg_limit INTEGER NOT NULL DEFAULT 2300,
  ADD COLUMN IF NOT EXISTS water_liters NUMERIC(4,1) NOT NULL DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS dietary_restrictions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_inclusions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_ingredients TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS meal_frequency INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS meal_timing_preference TEXT NOT NULL DEFAULT 'standard';

CREATE TABLE IF NOT EXISTS diet_meal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  meal_type TEXT NOT NULL DEFAULT 'snack',
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  date_key DATE NOT NULL DEFAULT CURRENT_DATE,
  calories INTEGER NOT NULL DEFAULT 0 CHECK (calories >= 0),
  protein NUMERIC(7,1) NOT NULL DEFAULT 0 CHECK (protein >= 0),
  carbs NUMERIC(7,1) NOT NULL DEFAULT 0 CHECK (carbs >= 0),
  fat NUMERIC(7,1) NOT NULL DEFAULT 0 CHECK (fat >= 0),
  sodium_mg NUMERIC(8,1) NOT NULL DEFAULT 0 CHECK (sodium_mg >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diet_meal_logs_user_date_idx
  ON diet_meal_logs (user_id, date_key, logged_at);

ALTER TABLE diet_meal_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "diet_meal_logs_select_own" ON diet_meal_logs;
DROP POLICY IF EXISTS "diet_meal_logs_insert_own" ON diet_meal_logs;
DROP POLICY IF EXISTS "diet_meal_logs_update_own" ON diet_meal_logs;
DROP POLICY IF EXISTS "diet_meal_logs_delete_own" ON diet_meal_logs;

CREATE POLICY "diet_meal_logs_select_own" ON diet_meal_logs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "diet_meal_logs_insert_own" ON diet_meal_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "diet_meal_logs_update_own" ON diet_meal_logs
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "diet_meal_logs_delete_own" ON diet_meal_logs
  FOR DELETE USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS diet_disclaimer_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  consent_summary TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diet_disclaimer_audit_user_idx
  ON diet_disclaimer_audit_logs (user_id, accepted_at DESC);

ALTER TABLE diet_disclaimer_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "diet_disclaimer_select_own" ON diet_disclaimer_audit_logs;
DROP POLICY IF EXISTS "diet_disclaimer_insert_own" ON diet_disclaimer_audit_logs;

CREATE POLICY "diet_disclaimer_select_own" ON diet_disclaimer_audit_logs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "diet_disclaimer_insert_own" ON diet_disclaimer_audit_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());
