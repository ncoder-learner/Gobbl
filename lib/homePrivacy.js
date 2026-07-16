// Privacy handling for meals logged "at home" (LogMealScreen's "This was at
// home" quick option, which tags the meal with a synthetic `home:<userId>:
// <lat>:<lng>` place_id — see selectHome() in LogMealScreen.jsx). A home
// meal's real address must never render as text to anyone, and its exact
// (or even an approximate/offset) coordinate must never be plotted on a map
// for anyone but the owner — there is deliberately no fuzzed-coordinate
// fallback, since any offset is still a real point on a real map that can
// be zoomed into. Non-owner viewers get a non-mappable stand-in instead
// (see DayTrail.jsx's "home node").

export function isHomeMeal(meal) {
  return !!meal?.place_id && meal.place_id.startsWith('home:');
}

// Text label to show wherever a location name would normally render —
// 'Home' for every viewer, including the owner, so there's exactly one
// consistent presentation instead of per-screen judgment calls.
export function displayPlaceName(meal) {
  if (!meal) return null;
  if (isHomeMeal(meal)) return 'Home';
  return meal.places?.name ?? null;
}

// Real coordinates, safe to plot on an actual map — or null if this meal's
// location must never be plotted at all. Owners always get their real
// coordinates; a non-owner gets real coordinates for any non-home meal, and
// null (never an offset) for a home meal. Callers must treat null as "render
// a non-mappable stand-in," not "skip silently," wherever the UI needs to
// keep the stop in sequence (see DayTrail.jsx).
export function mappableCoords(meal, { isOwner }) {
  const lat = meal?.places?.lat;
  const lng = meal?.places?.lng;
  if (lat == null || lng == null) return null;
  if (isOwner || !isHomeMeal(meal)) return { lat, lng };
  return null;
}
