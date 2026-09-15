-- `sport` was made NOT NULL in the deployed database outside the original
-- migration. Standard nutrition plans still need a valid non-sport value.
ALTER TABLE user_diet_preferences
  ADD COLUMN IF NOT EXISTS sport TEXT;

UPDATE user_diet_preferences
  SET sport = 'casual_fitness'
  WHERE sport IS NULL;

ALTER TABLE user_diet_preferences
  ALTER COLUMN sport SET DEFAULT 'casual_fitness',
  ALTER COLUMN sport SET NOT NULL;

-- A DEFAULT only applies when the client omits a column. Older app builds
-- explicitly send `sport: null`, so normalize that value before NOT NULL is
-- evaluated as well.
CREATE OR REPLACE FUNCTION normalize_user_diet_preference_sport()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sport IS NULL THEN
    NEW.sport = 'casual_fitness';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_user_diet_preference_sport ON user_diet_preferences;
CREATE TRIGGER trg_normalize_user_diet_preference_sport
  BEFORE INSERT OR UPDATE ON user_diet_preferences
  FOR EACH ROW
  EXECUTE FUNCTION normalize_user_diet_preference_sport();
