-- 006_block_filtering.sql
-- Bidirectional block visibility enforced at the DB layer.
-- Block row is one-directional; visibility effect is mutual.
-- All policies are RESTRICTIVE: they AND with existing PERMISSIVE policies to REMOVE access.

-- ─── 1. Helper: is there a block in EITHER direction between two users? ───
-- SECURITY DEFINER so it reads the full blocks table regardless of caller RLS
-- (caller can only see their own block rows; this needs both directions).
CREATE OR REPLACE FUNCTION is_blocked_between(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = user_a AND blocked_id = user_b)
       OR (blocker_id = user_b AND blocked_id = user_a)
  );
$$;

-- ─── 2. SELECT restrictions (content hidden both directions) ───
DROP POLICY IF EXISTS posts_not_blocked ON posts;
CREATE POLICY posts_not_blocked ON posts
  AS RESTRICTIVE FOR SELECT
  USING (NOT is_blocked_between(auth.uid(), user_id));

DROP POLICY IF EXISTS comments_not_blocked ON post_comments;
CREATE POLICY comments_not_blocked ON post_comments
  AS RESTRICTIVE FOR SELECT
  USING (NOT is_blocked_between(auth.uid(), user_id));

DROP POLICY IF EXISTS meals_not_blocked ON meals;
CREATE POLICY meals_not_blocked ON meals
  AS RESTRICTIVE FOR SELECT
  USING (NOT is_blocked_between(auth.uid(), user_id));

DROP POLICY IF EXISTS profiles_not_blocked ON profiles;
CREATE POLICY profiles_not_blocked ON profiles
  AS RESTRICTIVE FOR SELECT
  USING (NOT is_blocked_between(auth.uid(), id));

DROP POLICY IF EXISTS likes_not_blocked ON post_likes;
CREATE POLICY likes_not_blocked ON post_likes
  AS RESTRICTIVE FOR SELECT
  USING (NOT is_blocked_between(auth.uid(), user_id));

-- ─── 3. INSERT restriction: blocked users can't send friend requests ───
-- Existing users_send_requests has qual null (unrestricted). INSERT uses WITH CHECK.
DROP POLICY IF EXISTS friendships_not_blocked ON friendships;
CREATE POLICY friendships_not_blocked ON friendships
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (NOT is_blocked_between(requester_id, addressee_id));
