-- Social layer migration
-- Run in the Supabase SQL editor (Dashboard → SQL Editor).

-- ─── 1. profiles: add username + avatar_url ───────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Case-insensitive unique index (usernames are stored lowercase)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON profiles (lower(username)) WHERE username IS NOT NULL;

-- ─── 2. friendships ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(requester_id, addressee_id),
  CHECK (requester_id != addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships(requester_id);

-- ─── 3. reports (safety stub) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── 4. posts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  meal_id    UUID NOT NULL REFERENCES meals(id)    ON DELETE CASCADE,
  caption    TEXT CHECK (length(caption) <= 200),
  visibility TEXT NOT NULL DEFAULT 'friends'
             CHECK (visibility IN ('friends', 'private')),
  tier_rank  INT,          -- snapshot of poster's yearly rank at post-creation time
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(meal_id)          -- one post per meal; DELETE the row to un-post
);

CREATE INDEX IF NOT EXISTS posts_user_id_idx    ON posts(user_id);
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);

-- ─── 5. RLS ───────────────────────────────────────────────────────────────────

-- profiles: all authenticated users can read profiles (needed for friend search + feed)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_profiles_read"       ON profiles;
DROP POLICY IF EXISTS "users_update_own_profile"   ON profiles;
CREATE POLICY "public_profiles_read" ON profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "users_update_own_profile" ON profiles
  FOR ALL USING (id = auth.uid());

-- friendships
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_see_own_friendships"   ON friendships;
DROP POLICY IF EXISTS "users_send_requests"         ON friendships;
DROP POLICY IF EXISTS "users_respond_to_requests"   ON friendships;
DROP POLICY IF EXISTS "users_remove_friendships"    ON friendships;

CREATE POLICY "users_see_own_friendships" ON friendships
  FOR SELECT USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Prevent sending a request to someone who blocked you
CREATE POLICY "users_send_requests" ON friendships
  FOR INSERT WITH CHECK (
    requester_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM friendships f2
      WHERE f2.requester_id = addressee_id
        AND f2.addressee_id = auth.uid()
        AND f2.status = 'blocked'
    )
  );

CREATE POLICY "users_respond_to_requests" ON friendships
  FOR UPDATE USING (addressee_id = auth.uid() OR requester_id = auth.uid());

CREATE POLICY "users_remove_friendships" ON friendships
  FOR DELETE USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- reports
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_can_report" ON reports;
CREATE POLICY "users_can_report" ON reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());

-- posts
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "see_own_and_friends_posts"   ON posts;
DROP POLICY IF EXISTS "users_can_create_posts"      ON posts;
DROP POLICY IF EXISTS "users_can_manage_own_posts"  ON posts;
DROP POLICY IF EXISTS "users_can_delete_own_posts"  ON posts;

CREATE POLICY "see_own_and_friends_posts" ON posts
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = posts.user_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = posts.user_id)
        )
    )
  );

CREATE POLICY "users_can_create_posts" ON posts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_can_manage_own_posts" ON posts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "users_can_delete_own_posts" ON posts
  FOR DELETE USING (user_id = auth.uid());

-- ─── 6. delete-account cleanup ────────────────────────────────────────────────
-- Handled in supabase/functions/delete-account/index.ts (posts, post_likes,
-- post_comments, friendships, reports, blocks, meals, storage, profiles, auth user).
