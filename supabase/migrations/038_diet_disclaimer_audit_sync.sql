-- 038_diet_disclaimer_audit_sync.sql
-- Ensures audit logging table for medical disclaimers and restrictive diet checkpoints exists with proper RLS,
-- and optionally tracks disclaimer_version directly on user_diet_preferences.

-- 1. Ensure diet_disclaimer_audit_logs table exists
CREATE TABLE IF NOT EXISTS diet_disclaimer_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  consent_summary TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes for efficient lookup by user and acceptance time
CREATE INDEX IF NOT EXISTS diet_disclaimer_audit_user_idx
  ON diet_disclaimer_audit_logs (user_id, accepted_at DESC);

-- 3. Row-level security: users can only view and insert their own audit logs
ALTER TABLE diet_disclaimer_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "diet_disclaimer_select_own" ON diet_disclaimer_audit_logs;
DROP POLICY IF EXISTS "diet_disclaimer_insert_own" ON diet_disclaimer_audit_logs;

CREATE POLICY "diet_disclaimer_select_own" ON diet_disclaimer_audit_logs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "diet_disclaimer_insert_own" ON diet_disclaimer_audit_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 4. Optional column on user_diet_preferences for fast version checking
ALTER TABLE user_diet_preferences
  ADD COLUMN IF NOT EXISTS disclaimer_version TEXT;
