-- 017_posts_last_updated_at.sql
-- Adds last_updated_at, bumped whenever a slot is added to an existing
-- post (see lib/postUtils.js's createPost, which now reuses today's post
-- instead of creating a duplicate). created_at stays untouched — it's still
-- the day-grouping key for FeedScreen's headers. FeedScreen's sort order
-- switches to last_updated_at so a post that just gained a new slot
-- resurfaces at the top, same as a brand-new post would.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill existing rows to their own created_at rather than "now" (the
-- ALTER's DEFAULT only applies going forward for new rows / where NULL).
UPDATE posts SET last_updated_at = created_at WHERE last_updated_at IS NULL;
