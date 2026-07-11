-- 010_meal_photos.sql
-- Lets a meal carry more than one photo, added any time after logging (not
-- just at creation). meals.photo_url stays as the first/primary photo for
-- backward compatibility — everything after that lives in meal_photos.

-- ─── 1. meal_photos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meal_photos (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meal_id    UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  photo_url  TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meal_photos_meal_id_idx ON meal_photos(meal_id, position);

-- ─── 2. Ownership lookup, bypassing meals' own RLS ─────────────────────────────
-- meals' base SELECT policy isn't defined in this repo (the table predates
-- migrations, set up directly in the dashboard), so a plain subquery against
-- meals from inside meal_photos' policies would silently be filtered by
-- whatever that policy is — e.g. if it's owner-only, a friend's visibility
-- check below would always evaluate false, even though it shouldn't. This
-- SECURITY DEFINER function sidesteps that: it always resolves the true
-- owner, decoupling meal_photos visibility from meals' own RLS internals.
CREATE OR REPLACE FUNCTION meal_owner_id(target_meal_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT user_id FROM meals WHERE id = target_meal_id;
$$;

-- ─── 3. RLS — mirrors meal-level visibility: owner + accepted friends can
--    view, only the owner can add/delete their own meal's photos ────────────
ALTER TABLE meal_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_photos_owner_or_friends_read" ON meal_photos
  FOR SELECT USING (
    meal_owner_id(meal_photos.meal_id) = auth.uid()
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = meal_owner_id(meal_photos.meal_id))
          OR (f.addressee_id = auth.uid() AND f.requester_id = meal_owner_id(meal_photos.meal_id))
        )
    )
  );

-- Mirrors meals_not_blocked (006_block_filtering.sql) using the same
-- is_blocked_between() helper — blocked pairs can't see each other's photos
-- even if (hypothetically) still marked as friends.
CREATE POLICY "meal_photos_not_blocked" ON meal_photos
  AS RESTRICTIVE FOR SELECT
  USING (NOT is_blocked_between(auth.uid(), meal_owner_id(meal_photos.meal_id)));

CREATE POLICY "meal_photos_owner_insert" ON meal_photos
  FOR INSERT WITH CHECK (meal_owner_id(meal_photos.meal_id) = auth.uid());

CREATE POLICY "meal_photos_owner_delete" ON meal_photos
  FOR DELETE USING (meal_owner_id(meal_photos.meal_id) = auth.uid());
