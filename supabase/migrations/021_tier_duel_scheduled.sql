-- 021_tier_duel_scheduled.sql
-- Reworks Tier Duel from an always-open per-slot vote (019) into a
-- scheduled event: a slot's duel unlocks once that slot's window closes
-- (see lib/postVotes.js's SLOT_CLOSE / isDuelUnlocked, same boundaries as
-- the log flow's auto-guessed tag). post_votes itself is unchanged — its
-- (voter_id, meal_id) key + UNIQUE(voter_id, slot, day) already matches
-- what this needs, so nothing is dropped here.
--
-- wins_seen_at tracks when the user last saw their win count, so the
-- profile can count-up from their previous total to their new one instead
-- of just showing a static number (lib/postVotes.js's newWinsSince).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wins_seen_at TIMESTAMPTZ;

-- post_votes wasn't in the realtime publication yet — needed so a live vote
-- on a friend's meal can push a Postgres Changes event. RLS still applies
-- to postgres_changes payloads (friends_can_see_votes, from 019): a
-- subscriber only receives an INSERT they'd be allowed to SELECT, so a vote
-- on a stranger's meal is never delivered to an unauthorized client.
ALTER PUBLICATION supabase_realtime ADD TABLE post_votes;
