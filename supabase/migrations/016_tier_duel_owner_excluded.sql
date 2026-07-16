-- 016_tier_duel_owner_excluded.sql
-- 015 deliberately let the post owner insert/update a vote row at the RLS
-- layer (per that spec's literal wording: "friends of the post owner (and
-- the owner) can insert/update their own vote"), relying on the client UI
-- to hide voting from the owner. The spec has since been tightened to
-- "friends (not the owner) can insert/update their own vote" — enforce that
-- at the DB layer too, not just in the UI. Reads (vote counts) are
-- unaffected; the owner can still see the tally.

DROP POLICY IF EXISTS "friends_can_vote" ON post_votes;
CREATE POLICY "friends_can_vote" ON post_votes
  FOR INSERT WITH CHECK (
    voter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_votes.post_id
        AND p.user_id != auth.uid()
        AND EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.requester_id = auth.uid() AND f.addressee_id = p.user_id)
              OR (f.addressee_id = auth.uid() AND f.requester_id = p.user_id)
            )
        )
    )
  );

DROP POLICY IF EXISTS "friends_can_change_vote" ON post_votes;
CREATE POLICY "friends_can_change_vote" ON post_votes
  FOR UPDATE USING (voter_id = auth.uid())
  WITH CHECK (
    voter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_votes.post_id
        AND p.user_id != auth.uid()
        AND EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.requester_id = auth.uid() AND f.addressee_id = p.user_id)
              OR (f.addressee_id = auth.uid() AND f.requester_id = p.user_id)
            )
        )
    )
  );
