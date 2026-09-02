-- 029_meal_nutrition.sql
-- Nutrition estimates captured during AI-assisted meal logging.

ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS calories INTEGER NOT NULL DEFAULT 0 CHECK (calories >= 0),
  ADD COLUMN IF NOT EXISTS protein_g NUMERIC(7,1) NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
  ADD COLUMN IF NOT EXISTS carbs_g NUMERIC(7,1) NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
  ADD COLUMN IF NOT EXISTS fat_g NUMERIC(7,1) NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
  ADD COLUMN IF NOT EXISTS sodium_mg NUMERIC(8,1) NOT NULL DEFAULT 0 CHECK (sodium_mg >= 0),
  ADD COLUMN IF NOT EXISTS nutrition_items JSONB NOT NULL DEFAULT '[]'::jsonb;