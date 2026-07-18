-- 022_meal_skips.sql
-- Private per-user "skip this meal" marker: lets a user mark a breakfast/
-- lunch/dinner slot as intentionally skipped for a given day. Strictly
-- owner-only (no friend visibility, unlike posts/meals) — never surfaced to
-- anyone else, so this is a plain private row keyed to auth.uid(), same
-- pattern as the `blocks` table in 005_moderation.sql.

CREATE TABLE IF NOT EXISTS meal_skips (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  slot       TEXT NOT NULL CHECK (slot IN ('breakfast','lunch','dinner')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, day, slot)
);

CREATE INDEX IF NOT EXISTS idx_meal_skips_user_day ON meal_skips(user_id, day);

ALTER TABLE meal_skips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meal_skips_select_own ON meal_skips;
CREATE POLICY meal_skips_select_own ON meal_skips
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS meal_skips_insert_own ON meal_skips;
CREATE POLICY meal_skips_insert_own ON meal_skips
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS meal_skips_delete_own ON meal_skips;
CREATE POLICY meal_skips_delete_own ON meal_skips
  FOR DELETE USING (user_id = auth.uid());
