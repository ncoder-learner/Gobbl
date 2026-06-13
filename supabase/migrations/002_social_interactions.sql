-- Social interactions: likes + push token
-- Run in Supabase SQL Editor.

-- ── push_token on profiles ────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token TEXT;

-- ── post_likes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_likes (
  post_id    UUID NOT NULL REFERENCES posts(id)    ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_likes_user_idx ON post_likes(user_id);

ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_see_likes" ON post_likes;
DROP POLICY IF EXISTS "users_can_like"              ON post_likes;
DROP POLICY IF EXISTS "users_can_unlike"            ON post_likes;

-- Anyone signed in can read like counts
CREATE POLICY "authenticated_can_see_likes" ON post_likes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Users can only like as themselves
CREATE POLICY "users_can_like" ON post_likes
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can only remove their own likes
CREATE POLICY "users_can_unlike" ON post_likes
  FOR DELETE USING (user_id = auth.uid());
