-- 023_profile_home_location_privacy.sql
-- profiles.home_lat/home_lng/home_place_name (013_profile_home_location.sql)
-- sat behind public_profiles_read (001, USING (auth.uid() IS NOT NULL)) —
-- meaning ANY authenticated user, not just friends, could read another
-- user's exact home coordinates. 013's own comment claimed "no new RLS
-- needed" because public_profiles_read "covers reads" — that's exactly the
-- bug: RLS is row-level, not column-level, so there's no way to carve out
-- per-column access on `profiles` itself. The fix is to move these columns
-- into their own owner-only table instead.
--
-- Every existing read/write site (AccountScreen.jsx, LogMealScreen.jsx,
-- ProfileInfoScreen.jsx) already only ever queries the CALLER's own home
-- location (`.eq('id', user.id)`) — nothing in the app reads another user's
-- home location today, so this is a pure hardening move, not a feature change.

CREATE TABLE IF NOT EXISTS profile_home_locations (
  user_id    UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  place_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profile_home_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_home_locations_select_own ON profile_home_locations;
CREATE POLICY profile_home_locations_select_own ON profile_home_locations
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS profile_home_locations_insert_own ON profile_home_locations;
CREATE POLICY profile_home_locations_insert_own ON profile_home_locations
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profile_home_locations_update_own ON profile_home_locations;
CREATE POLICY profile_home_locations_update_own ON profile_home_locations
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profile_home_locations_delete_own ON profile_home_locations;
CREATE POLICY profile_home_locations_delete_own ON profile_home_locations
  FOR DELETE USING (user_id = auth.uid());

-- Backfill existing home locations before dropping the old columns.
INSERT INTO profile_home_locations (user_id, lat, lng, place_name)
SELECT id, home_lat, home_lng, home_place_name
FROM profiles
WHERE home_lat IS NOT NULL AND home_lng IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE profiles DROP COLUMN IF EXISTS home_lat;
ALTER TABLE profiles DROP COLUMN IF EXISTS home_lng;
ALTER TABLE profiles DROP COLUMN IF EXISTS home_place_name;
