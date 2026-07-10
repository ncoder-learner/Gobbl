-- 008_meal_tag.sql
-- Adds a breakfast/lunch/dinner tag to meals. Auto-guessed from time of
-- logging on the client, user-overridable before save. Nullable so
-- existing rows are unaffected; filterable via the index below.

ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS tag TEXT CHECK (tag IN ('breakfast', 'lunch', 'dinner'));

CREATE INDEX IF NOT EXISTS meals_tag_idx ON meals(tag);
