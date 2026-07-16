-- 015_tier_duel_votes.sql
-- "Tier Duel" — a single-tap vote for which meal slot (breakfast/lunch/
-- dinner) a friend would want to eat, on posts with 2+ filled slots.
-- PRIMARY KEY (post_id, voter_id) is the UNIQUE constraint the spec calls
-- for — one voter, one vote per post; re-voting a different slot updates
-- that same row (client does an upsert) rather than adding a second vote.
-- Mirrors post_comments' see_comments_on_visible_posts pattern (003) for
-- visibility, so blocking (meals_not_blocked-style enforcement already on
-- `posts` itself) is inherited transitively through the EXISTS subquery
-- against `posts` — no separate RESTRICTIVE policy needed here.

CREATE TABLE IF NOT EXISTS post_votes (
  post_id    UUID NOT NULL REFERENCES posts(id)    ON DELETE CASCADE,
  voter_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slot       TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (post_id, voter_id)
);

CREATE INDEX IF NOT EXISTS post_votes_post_idx ON post_votes(post_id);

ALTER TABLE post_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "see_votes_on_visible_posts" ON post_votes;
DROP POLICY IF EXISTS "friends_can_vote"           ON post_votes;
DROP POLICY IF EXISTS "friends_can_change_vote"    ON post_votes;
DROP POLICY IF EXISTS "voters_can_remove_own_vote" ON post_votes;

-- Vote counts readable by anyone who can see the parent post (owner + accepted friends).
CREATE POLICY "see_votes_on_visible_posts" ON post_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_votes.post_id
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

-- Insert your own vote — only if you can see the post (owner or accepted
-- friend). The client UI additionally hides voting from the post owner;
-- RLS follows the spec's "friends of the post owner (and the owner) can
-- insert/update" wording rather than hard-blocking the owner at the DB layer.
CREATE POLICY "friends_can_vote" ON post_votes
  FOR INSERT WITH CHECK (
    voter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_votes.post_id
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

-- Change your own vote (moving it to a different slot).
CREATE POLICY "friends_can_change_vote" ON post_votes
  FOR UPDATE USING (voter_id = auth.uid())
  WITH CHECK (
    voter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_votes.post_id
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

-- Remove your own vote (tapping your current pick again, to undo it).
CREATE POLICY "voters_can_remove_own_vote" ON post_votes
  FOR DELETE USING (voter_id = auth.uid());
