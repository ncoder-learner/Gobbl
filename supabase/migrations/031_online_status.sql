-- 031_online_status.sql
-- Adds last_seen_at column to profiles to track online/offline status.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();
