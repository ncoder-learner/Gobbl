-- 014_fix_meals_tri_slot_visibility.sql
-- see_meals_of_visible_posts (predates this migration history — defined
-- directly on the dashboard) only matched posts.meal_id, the legacy/primary
-- slot. Once breakfast_meal_id/lunch_meal_id/dinner_meal_id were added
-- (migration 009) for tri-image posts, a friend viewing such a post could
-- only read whichever meal happened to be the primary slot — the other 1-2
-- meals (and, transitively, their places join for Day Trail) were silently
-- dropped by RLS. PostgREST returns null for embedded rows blocked by RLS
-- rather than erroring, so the feed/detail queries just appeared to be
-- missing data with no error to catch.

DROP POLICY IF EXISTS see_meals_of_visible_posts ON meals;
CREATE POLICY see_meals_of_visible_posts ON meals
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM posts p
      WHERE (
        p.meal_id = meals.id
        OR p.breakfast_meal_id = meals.id
        OR p.lunch_meal_id = meals.id
        OR p.dinner_meal_id = meals.id
      )
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
