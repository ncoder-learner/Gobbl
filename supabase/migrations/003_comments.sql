-- Post comments
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS post_comments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID NOT NULL REFERENCES posts(id)    ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (length(content) >= 1 AND length(content) <= 300),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_comments_post_idx ON post_comments(post_id, created_at);

ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "see_comments_on_visible_posts" ON post_comments;
DROP POLICY IF EXISTS "users_can_comment"             ON post_comments;
DROP POLICY IF EXISTS "users_can_delete_own_comments" ON post_comments;

-- Visible if you can see the parent post (friends + own)
CREATE POLICY "see_comments_on_visible_posts" ON post_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_comments.post_id
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

CREATE POLICY "users_can_comment" ON post_comments
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_can_delete_own_comments" ON post_comments
  FOR DELETE USING (user_id = auth.uid());
