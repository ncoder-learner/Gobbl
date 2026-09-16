-- Flexible Tracking uses primary_goal = 'no_restriction'. The live table
-- has a CHECK that rejected that value (and other in-app goal ids).
ALTER TABLE user_diet_preferences
  DROP CONSTRAINT IF EXISTS user_diet_preferences_primary_goal_check;

UPDATE user_diet_preferences
SET primary_goal = 'no_restriction'
WHERE primary_goal IS NULL
   OR primary_goal NOT IN (
     'no_restriction',
     'maintenance',
     'muscle_gain',
     'sport_performance',
     'weight_loss',
     'keto',
     'clean_eating',
     'fat_loss',
     'fat_loss_shred'
   );

ALTER TABLE user_diet_preferences
  ADD CONSTRAINT user_diet_preferences_primary_goal_check
  CHECK (primary_goal IN (
    'no_restriction',
    'maintenance',
    'muscle_gain',
    'sport_performance',
    'weight_loss',
    'keto',
    'clean_eating',
    'fat_loss',
    'fat_loss_shred'
  ));
