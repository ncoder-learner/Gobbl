-- 009_tri_image_posts.sql
-- Adds up to 3 meal slots (breakfast/lunch/dinner) to posts, so a single
-- post can bundle a day's meals into one card instead of exactly one.
--
-- meal_id/caption/tier_rank are left untouched, per requirement. meal_id
-- keeps pointing at whichever slot is "primary" for a post (the app sets it
-- to the first filled slot, breakfast > lunch > dinner), so the existing
-- NOT NULL/UNIQUE constraint and any code still reading post.meal_id keep
-- working unchanged.

-- ─── 1. New slot columns ────────────────────────────────────────────────────
-- ON DELETE SET NULL (not CASCADE like the legacy meal_id): deleting one meal
-- in a tri-image post should only drop that one image, not the whole post
-- along with the other 1-2 meals still attached to it. See note at the bottom
-- of this file about the residual asymmetry this leaves with meal_id.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS breakfast_meal_id UUID REFERENCES meals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lunch_meal_id     UUID REFERENCES meals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dinner_meal_id    UUID REFERENCES meals(id) ON DELETE SET NULL;

-- One post per meal per slot, mirroring the existing UNIQUE(meal_id).
-- Postgres UNIQUE indexes allow any number of NULLs, so unfilled slots
-- (the common case — most posts will only fill 1 or 2 of the 3) are fine.
CREATE UNIQUE INDEX IF NOT EXISTS posts_breakfast_meal_id_key ON posts(breakfast_meal_id);
CREATE UNIQUE INDEX IF NOT EXISTS posts_lunch_meal_id_key     ON posts(lunch_meal_id);
CREATE UNIQUE INDEX IF NOT EXISTS posts_dinner_meal_id_key    ON posts(dinner_meal_id);

-- ─── 2. Backfill existing posts ─────────────────────────────────────────────
-- Route each existing post's single meal into the slot matching that meal's
-- tag. Meals with no tag (tag IS NULL) or any unrecognized tag value fall
-- back to breakfast_meal_id, so no existing post loses its image.
-- Guarded by "all three slots still NULL" so re-running this migration is a
-- no-op on rows already backfilled.
UPDATE posts p
SET breakfast_meal_id = CASE WHEN m.tag IS DISTINCT FROM 'lunch' AND m.tag IS DISTINCT FROM 'dinner' THEN p.meal_id END,
    lunch_meal_id     = CASE WHEN m.tag = 'lunch'  THEN p.meal_id END,
    dinner_meal_id    = CASE WHEN m.tag = 'dinner' THEN p.meal_id END
FROM meals m
WHERE m.id = p.meal_id
  AND p.breakfast_meal_id IS NULL
  AND p.lunch_meal_id IS NULL
  AND p.dinner_meal_id IS NULL;

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────
-- Row Level Security in Postgres is row-scoped, not column-scoped: the
-- existing policies on posts (see_own_and_friends_posts, users_can_create_posts,
-- users_can_manage_own_posts, users_can_delete_own_posts, defined in
-- 001_social_layer.sql) already govern every column on the row, including
-- these three new ones — no new policy statements are needed or even
-- expressible here. A friend who could already read a post's meal_id/caption
-- can read its breakfast/lunch/dinner_meal_id too, and only the post's owner
-- can write any of them (INSERT/UPDATE policies both key on user_id =
-- auth.uid()), exactly mirroring today's single-meal behavior.

-- ─── Known asymmetry ─────────────────────────────────────────────────────────
-- meal_id (untouched, per requirement) is still ON DELETE CASCADE: deleting
-- the specific meal that meal_id points at (the post's "primary" slot) still
-- deletes the whole post today, even if the other 1-2 slots still have valid
-- meals attached. The 3 new slot columns don't have this problem (SET NULL
-- above), but meal_id itself does, since its CASCADE behavior wasn't part of
-- what this migration was asked to change. Flagging for a follow-up decision:
-- fixing it fully needs either a trigger to re-point meal_id at a surviving
-- slot before the cascade fires, or relaxing meal_id to SET NULL too (which
-- would need its NOT NULL constraint reconsidered).
