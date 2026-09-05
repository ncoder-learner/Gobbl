-- 032_reset_last_seen.sql
-- The previous migration (031) added last_seen_at with DEFAULT now(),
-- which stamped every existing row with the migration time, making everyone
-- appear "Active now". Reset to NULL so only real app heartbeats count.
UPDATE profiles SET last_seen_at = NULL;
