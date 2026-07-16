-- 019_per_slot_tier_duel.sql
-- Reworks Tier Duel from a within-post competition (friends pick which of
-- one person's 3 meals they'd eat) to a per-slot competition across
-- friends (everyone's lunch competes against everyone else's lunch, scoped
-- to the viewer's friend graph). Old post_votes rows are test data from the
-- old model and don't map onto the new shape — dropped, not migrated.

DROP TABLE IF EXISTS post_votes CASCADE;

CREATE TABLE post_votes (
  voter_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  meal_id    UUID NOT NULL REFERENCES meals(id)    ON DELETE CASCADE,
  slot       TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
  -- Local calendar day the slot belongs to, set by the client — mirrors how
  -- DayBoardScreen already computes "today" client-side rather than
  -- trusting the DB's (UTC) CURRENT_DATE, which would misalign near
  -- midnight for users west of UTC.
  day        DATE NOT NULL,
  -- What the monthly win-count queries range over (see winsForMonth in
  -- lib/postVotes.js) — a date-range query, not a stored/reset counter.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (voter_id, meal_id),   -- a voter holds at most one vote per meal
  UNIQUE (voter_id, slot, day)       -- ...and at most one active vote per slot per day;
                                      -- this is the upsert target for "move my vote"
);

CREATE INDEX post_votes_meal_id_idx ON post_votes(meal_id);
CREATE INDEX post_votes_created_at_idx ON post_votes(created_at);

ALTER TABLE post_votes ENABLE ROW LEVEL SECURITY;

-- Friends can read vote counts on any meal they can see. Reuses
-- meal_owner_id() (SECURITY DEFINER, from migration 010) so this doesn't
-- have to re-derive visibility against meals' own opaque RLS a third way.
CREATE POLICY "friends_can_see_votes" ON post_votes
  FOR SELECT USING (
    voter_id = auth.uid()
    OR meal_owner_id(post_votes.meal_id) = auth.uid()
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = meal_owner_id(post_votes.meal_id))
          OR (f.addressee_id = auth.uid() AND f.requester_id = meal_owner_id(post_votes.meal_id))
        )
    )
  );

-- Insert your own vote for a friend's meal — never your own meal, enforced
-- here (not just client-side), since RLS is the real security boundary.
CREATE POLICY "friends_can_vote" ON post_votes
  FOR INSERT WITH CHECK (
    voter_id = auth.uid()
    AND meal_owner_id(post_votes.meal_id) != auth.uid()
    AND EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = meal_owner_id(post_votes.meal_id))
          OR (f.addressee_id = auth.uid() AND f.requester_id = meal_owner_id(post_votes.meal_id))
        )
    )
  );

-- Move your vote to a different meal in the same slot/day (upsert target).
CREATE POLICY "friends_can_change_vote" ON post_votes
  FOR UPDATE USING (voter_id = auth.uid())
  WITH CHECK (
    voter_id = auth.uid()
    AND meal_owner_id(post_votes.meal_id) != auth.uid()
  );

CREATE POLICY "voters_can_remove_vote" ON post_votes
  FOR DELETE USING (voter_id = auth.uid());
