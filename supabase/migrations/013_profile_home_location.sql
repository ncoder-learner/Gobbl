-- 013_profile_home_location.sql
-- Adds a one-time "home location" to profiles, used by LogMealScreen's
-- "This was at home" quick option. Stored directly as lat/lng + a label
-- rather than a places(place_id) FK, since a manual pin drop has no
-- Google place_id — a searched address still just fills these same columns.
-- No new RLS needed: "users_update_own_profile" (001) already covers writes
-- to any profiles column for the owner, and "public_profiles_read" covers
-- reads.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS home_place_name TEXT;
