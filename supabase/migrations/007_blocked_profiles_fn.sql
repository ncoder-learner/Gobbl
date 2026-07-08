-- 007_blocked_profiles_fn.sql
-- Lets a user see the profiles of people THEY blocked (their own blocks only).
-- SECURITY DEFINER bypasses the symmetric profiles_not_blocked policy, but is
-- safe because it filters strictly to blocks where blocker_id = auth.uid().

CREATE OR REPLACE FUNCTION get_my_blocked_profiles()
RETURNS TABLE (block_id UUID, blocked_id UUID, username TEXT, display_name TEXT, avatar_url TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT b.id, b.blocked_id, p.username, p.display_name, p.avatar_url, b.created_at
  FROM blocks b
  JOIN profiles p ON p.id = b.blocked_id
  WHERE b.blocker_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;
