// Single source of truth for the local-timezone YYYY-MM-DD date key used
// for streak bucketing, Tier Duel day scoping, and skip records across the
// app — this used to be copy-pasted (identically) into 7 different files,
// which is exactly the kind of thing that quietly drifts.

// Local-timezone YYYY-MM-DD for a Date object.
export function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Same, but for an ISO timestamp string (e.g. a Supabase created_at column)
// instead of a Date — kept as a distinctly-named function rather than
// overloading localDateKey's parameter type, since a Date and an ISO string
// aren't interchangeable at the call site.
export function localDateKeyFromISO(iso) {
  return localDateKey(new Date(iso));
}
