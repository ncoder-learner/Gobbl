-- 030_story_reactions.sql
-- Adds emoji column to post_likes so story reactions persist which specific emoji was tapped.

ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '🔥';
