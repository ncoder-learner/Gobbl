-- 011_profile_customization.sql
-- Adds bio + banner_color to profiles. avatar_url already exists (001_social_layer.sql).
-- Visibility/edit RLS is unchanged: "public_profiles_read" (001) already lets any
-- authenticated user SELECT these new columns, and "users_update_own_profile"
-- (FOR ALL, id = auth.uid()) already lets only the owner write them.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT CHECK (length(bio) <= 150);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banner_color TEXT DEFAULT 'orange';

-- ─── avatars bucket + storage RLS ──────────────────────────────────────────
-- Public bucket (read is world-readable, like meal-photos) but writes are
-- restricted to the caller's own folder. AccountScreen.jsx uploads to a fixed
-- `${user.id}/avatar.jpg` path with upsert:true, so INSERT and UPDATE both
-- need to be allowed for the owner (upsert may resolve to either depending
-- on whether the object already exists).
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_insert"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete"  ON storage.objects;

CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
