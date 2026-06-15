-- 004_meal_locations.sql
-- Adds a user-tagged location layer: a places lookup table keyed by
-- Google Places ID, and a nullable FK on meals so existing rows are unaffected.

-- ─── 1. places ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS places (
  place_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 2. RLS on places ─────────────────────────────────────────────────────────
ALTER TABLE places ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read all places (needed to display location on any meal)
CREATE POLICY "authenticated_can_read_places" ON places
  FOR SELECT TO authenticated USING (true);

-- Any signed-in user can insert a new place (tagged at meal-log time)
-- No UPDATE or DELETE — places are immutable once written.
CREATE POLICY "authenticated_can_insert_places" ON places
  FOR INSERT TO authenticated WITH CHECK (true);

-- ─── 3. Add place_id to meals ─────────────────────────────────────────────────
ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS place_id TEXT REFERENCES places(place_id);

-- ─── 4. Index for place → meals lookups (e.g. "all meals at this spot") ───────
CREATE INDEX IF NOT EXISTS meals_place_id_idx ON meals(place_id);
