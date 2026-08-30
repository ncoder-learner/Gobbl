# Phase 2: Retention Loop

## 1) Meal-time push notifications
- Trigger lunch and dinner nudges around the meal windows.
- Keep timing configurable per user, defaulting to the mid-day and evening windows already used by the board.
- Use the existing push-notification infrastructure rather than creating a separate service.

## 2) Activity ping for friends
- Notify a user when a friend logs a meal, but keep it lightweight.
- Sent as a social ping, not a full post or feed item.
- Reuse the same push-token and notification channel patterns already in the app.

## 3) Daily duel readiness
- Auto-match users with a friend when both have logged their required meals.
- Fire a result notification only after the duel result is ready and hidden until both sides complete.

## 4) Quick-log friction audit
- Reduce logging to a quick photo + tag + share flow.
- Avoid redundant screens when the user already has a photo and the tag is known.
- Keep share optional rather than blocking the save flow.

# Phase 3: Diet & Health Pivot

## Legal guardrails before shipping any diet feature
- Require an explicit tap-to-acknowledge disclaimer before a diet suggestion is generated.
- Log a timestamp of that acceptance for compliance and review.
- Use suggestion wording such as “here’s one option” rather than prescriptive commands.
- Add a checkpoint when the generated plan is below a safe nutrition floor and warn the user to consult a clinician.
- Update the Play Store data-safety section and privacy policy to list health-related categories if they are collected.
- Add an FTC disclosure clause to any paid or gifted influencer agreement.

## Build order
1. Create a `user_diet_preferences` table with per-user goals, inclusions, exclusions, sport, and macro targets.
2. Add static diet templates that are filtered to user constraints and restrictions.
3. Compute weekly insights from meals already logged: average sodium, calories, protein, and gaps versus target.
4. Pull activity data from Google Fit or Health Connect only as a read source, not as a custom tracker.
5. Treat a generated diet as a shareable object type that reuses the friend/feed visibility pattern.

# Implementation notes
- Keep diet tables isolated from the posts/feed schema so social features remain stable.
- Reuse Supabase row-level security patterns already present in the repository.
- Prefer static JSON templates and computed summaries over a heavy custom rules engine.
