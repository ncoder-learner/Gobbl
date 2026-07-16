-- 018_per_meal_likes_comments.sql
-- post_likes/post_comments keyed only to post_id meant liking or commenting
-- on one meal slot (e.g. maya's lunch) applied to the whole day's post —
-- visible on her breakfast and dinner too, since SlotViewerScreen and
-- MealDetailScreen treat the meal-in-a-slot as the unit of display but the
-- underlying rows had no way to distinguish which slot. Adds meal_id,
-- backfills it, and re-keys uniqueness/RLS around it. post_id is kept
-- (not dropped) — still used for the post-level "like this post" surface
-- on FeedScreen and for post-level aggregate counts on MyProfileScreen,
-- neither of which need to change.

-- 1. Add meal_id, nullable for now (backfilled below).
ALTER TABLE post_likes    ADD COLUMN IF NOT EXISTS meal_id UUID REFERENCES meals(id) ON DELETE CASCADE;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS meal_id UUID REFERENCES meals(id) ON DELETE CASCADE;

-- 2. Backfill to each post's first-filled slot (breakfast > lunch > dinner),
--    falling back to the legacy primary meal_id for pre-tri-image posts.
UPDATE post_likes pl
SET meal_id = COALESCE(p.breakfast_meal_id, p.lunch_meal_id, p.dinner_meal_id, p.meal_id)
FROM posts p
WHERE p.id = pl.post_id AND pl.meal_id IS NULL;

UPDATE post_comments pc
SET meal_id = COALESCE(p.breakfast_meal_id, p.lunch_meal_id, p.dinner_meal_id, p.meal_id)
FROM posts p
WHERE p.id = pc.post_id AND pc.meal_id IS NULL;

-- 3. Enforce NOT NULL now that every row has one.
ALTER TABLE post_likes    ALTER COLUMN meal_id SET NOT NULL;
ALTER TABLE post_comments ALTER COLUMN meal_id SET NOT NULL;

-- 4. Re-key post_likes' uniqueness: "one like per user per POST" becomes
--    "one like per user per MEAL" — a user can now like a friend's
--    breakfast AND lunch on the same post as two separate likes.
ALTER TABLE post_likes DROP CONSTRAINT post_likes_pkey;
ALTER TABLE post_likes ADD PRIMARY KEY (meal_id, user_id);
CREATE INDEX IF NOT EXISTS post_likes_post_id_idx ON post_likes(post_id); -- keep post_id queryable

CREATE INDEX IF NOT EXISTS post_comments_meal_id_idx ON post_comments(meal_id, created_at);

-- 5. INSERT policies gain an integrity check: meal_id must actually belong
--    to the referenced post (one of its 4 slot columns) — stops a
--    like/comment being attached to a meal from an unrelated post.
--    SELECT (visibility) policies are unchanged — seeing a slot's
--    likes/comments still just requires seeing the parent post, same as
--    before.
DROP POLICY IF EXISTS "users_can_like" ON post_likes;
CREATE POLICY "users_can_like" ON post_likes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_likes.post_id
        AND post_likes.meal_id IN (p.meal_id, p.breakfast_meal_id, p.lunch_meal_id, p.dinner_meal_id)
    )
  );

DROP POLICY IF EXISTS "users_can_comment" ON post_comments;
CREATE POLICY "users_can_comment" ON post_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_comments.post_id
        AND post_comments.meal_id IN (p.meal_id, p.breakfast_meal_id, p.lunch_meal_id, p.dinner_meal_id)
    )
  );
