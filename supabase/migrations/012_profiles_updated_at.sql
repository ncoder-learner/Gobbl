-- 012_profiles_updated_at.sql
-- profiles never had an updated_at column, but AccountScreen.jsx's
-- handleSaveProfile/pickAvatar/handleDevReset upserts all write one —
-- PostgREST rejected those writes with "Could not find the 'updated_at'
-- column of 'profiles' in the schema cache". Adding it makes those writes
-- succeed instead of stripping the column from three call sites.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
