-- 005_moderation.sql
-- UGC moderation: extend reports for content reporting + add blocks table.

-- ─── 1. Extend reports for content (not just profiles) ───
ALTER TABLE reports
  ALTER COLUMN reported_id DROP NOT NULL;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS content_type TEXT
    CHECK (content_type IN ('user','meal','post','comment')),
  ADD COLUMN IF NOT EXISTS content_id   UUID,
  ADD COLUMN IF NOT EXISTS detail        TEXT,
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reviewed','actioned','dismissed'));

-- reason becomes a fixed category; table is empty pre-launch so safe to constrain.
ALTER TABLE reports
  ADD CONSTRAINT reports_reason_check
    CHECK (reason IN ('spam','harassment','inappropriate','impersonation','other'));

-- must target either a user OR a piece of content
ALTER TABLE reports
  ADD CONSTRAINT reports_target_check
    CHECK (reported_id IS NOT NULL OR (content_type IS NOT NULL AND content_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_content ON reports(content_type, content_id);

-- ─── 2. Blocks table ───
CREATE TABLE IF NOT EXISTS blocks (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

-- ─── 3. RLS ───
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blocks_select_own ON blocks;
CREATE POLICY blocks_select_own ON blocks
  FOR SELECT USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS blocks_insert_own ON blocks;
CREATE POLICY blocks_insert_own ON blocks
  FOR INSERT WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS blocks_delete_own ON blocks;
CREATE POLICY blocks_delete_own ON blocks
  FOR DELETE USING (blocker_id = auth.uid());
