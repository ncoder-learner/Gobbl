-- Existing preference rows may have been created by the interrupted setup
-- flow. A plan is only complete after the user intentionally saves step 3.
ALTER TABLE user_diet_preferences
  ADD COLUMN IF NOT EXISTS plan_completed_at TIMESTAMPTZ;
