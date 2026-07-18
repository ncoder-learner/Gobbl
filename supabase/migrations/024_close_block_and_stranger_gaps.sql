-- 024_close_block_and_stranger_gaps.sql
-- Two related gaps found in a pre-launch RLS audit:
--
-- 1. post_likes/post_comments INSERT (018_per_meal_likes_comments.sql) only
--    checked `user_id = auth.uid()` plus that meal_id belongs to the
--    referenced post — it never checked the caller's relationship to the
--    POST OWNER at all. Anyone holding a valid post_id/meal_id pair (a
--    stranger's post, or a friend they've since been blocked by) could
--    still insert a like or comment. Fixed by folding the same
--    self-or-accepted-friend check post_comments' SELECT policy already
--    uses (003_comments.sql) into the INSERT WITH CHECK, plus an explicit
--    is_blocked_between() check.
--
-- 2. post_votes (019_per_slot_tier_duel.sql) was never block-filtered at
--    all — only gated on `friendships.status = 'accepted'`. Blocking a user
--    doesn't change or remove the friendship row (there is no 'blocked'
--    friendship status in use anywhere in the app), so a friend-then-
--    blocked pair keeps full Tier Duel visibility and voting rights against
--    each other. Fixed by adding is_blocked_between() to post_votes'
--    SELECT/INSERT/UPDATE policies, matching the pattern already used on
--    posts/meals/profiles/post_likes/comments (006_block_filtering.sql).

-- ─── post_likes ───
DROP POLICY IF EXISTS "users_can_like" ON post_likes;
CREATE POLICY "users_can_like" ON post_likes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_likes.post_id
        AND post_likes.meal_id IN (p.meal_id, p.breakfast_meal_id, p.lunch_meal_id, p.dinner_meal_id)
        AND NOT is_blocked_between(auth.uid(), p.user_id)
        AND (
          p.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM friendships f
            WHERE f.status = 'accepted'
              AND (
                (f.requester_id = auth.uid() AND f.addressee_id = p.user_id)
                OR (f.addressee_id = auth.uid() AND f.requester_id = p.user_id)
              )
          )
        )
    )
  );

-- ─── post_comments ───
DROP POLICY IF EXISTS "users_can_comment" ON post_comments;
CREATE POLICY "users_can_comment" ON post_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_comments.post_id
        AND post_comments.meal_id IN (p.meal_id, p.breakfast_meal_id, p.lunch_meal_id, p.dinner_meal_id)
        AND NOT is_blocked_between(auth.uid(), p.user_id)
        AND (
          p.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM friendships f
            WHERE f.status = 'accepted'
              AND (
                (f.requester_id = auth.uid() AND f.addressee_id = p.user_id)
                OR (f.addressee_id = auth.uid() AND f.requester_id = p.user_id)
              )
          )
        )
    )
  );

-- ─── post_votes: add block filtering to SELECT/INSERT/UPDATE ───
DROP POLICY IF EXISTS "friends_can_see_votes" ON post_votes;
CREATE POLICY "friends_can_see_votes" ON post_votes
  FOR SELECT USING (
    voter_id = auth.uid()
    OR (
      NOT is_blocked_between(auth.uid(), meal_owner_id(post_votes.meal_id))
      AND (
        meal_owner_id(post_votes.meal_id) = auth.uid()
        OR EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.requester_id = auth.uid() AND f.addressee_id = meal_owner_id(post_votes.meal_id))
              OR (f.addressee_id = auth.uid() AND f.requester_id = meal_owner_id(post_votes.meal_id))
            )
        )
      )
    )
  );

DROP POLICY IF EXISTS "friends_can_vote" ON post_votes;
CREATE POLICY "friends_can_vote" ON post_votes
  FOR INSERT WITH CHECK (
    voter_id = auth.uid()
    AND meal_owner_id(post_votes.meal_id) != auth.uid()
    AND NOT is_blocked_between(auth.uid(), meal_owner_id(post_votes.meal_id))
    AND EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = meal_owner_id(post_votes.meal_id))
          OR (f.addressee_id = auth.uid() AND f.requester_id = meal_owner_id(post_votes.meal_id))
        )
    )
  );

DROP POLICY IF EXISTS "friends_can_change_vote" ON post_votes;
CREATE POLICY "friends_can_change_vote" ON post_votes
  FOR UPDATE USING (voter_id = auth.uid())
  WITH CHECK (
    voter_id = auth.uid()
    AND meal_owner_id(post_votes.meal_id) != auth.uid()
    AND NOT is_blocked_between(auth.uid(), meal_owner_id(post_votes.meal_id))
  );

-- ─── friendships: block-filtering was INSERT-only (006_block_filtering.sql)
-- ─── — add it to UPDATE too, so a blocked pair can't resurrect a pending
-- ─── request into an accepted friendship after the block.
DROP POLICY IF EXISTS friendships_not_blocked_update ON friendships;
CREATE POLICY friendships_not_blocked_update ON friendships
  AS RESTRICTIVE FOR UPDATE
  USING (NOT is_blocked_between(requester_id, addressee_id))
  WITH CHECK (NOT is_blocked_between(requester_id, addressee_id));
