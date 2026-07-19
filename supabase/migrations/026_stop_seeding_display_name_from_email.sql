-- 026_stop_seeding_display_name_from_email.sql
-- handle_new_user() (a trigger function set up directly on the dashboard —
-- never tracked in a migration until now, same blind spot as `meals`) was
-- seeding every new profile's display_name with split_part(email, '@', 1) —
-- i.e. the literal local-part of the signup email. display_name is shown
-- prominently and publicly (profile header, friend list rows) wherever it's
-- set, with no privacy treatment at all — unlike the raw email address
-- itself, which the app deliberately never displays. A user who never
-- customized "Display name" in Account Settings was unknowingly showing
-- their email's local-part to every friend who viewed their profile.
--
-- Fix: stop seeding display_name at all. Every screen that reads it
-- already falls back correctly when it's null/absent (Avatar's initials
-- fallback chain, username display, etc.).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- Backfill: clear display_name for any existing profile where it still
-- exactly matches the email-derived seed value (i.e. was never
-- intentionally customized by the user).
UPDATE profiles p
SET display_name = NULL
FROM auth.users u
WHERE p.id = u.id
  AND p.display_name = split_part(u.email, '@', 1);
