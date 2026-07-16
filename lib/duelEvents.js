// Minimal in-memory pub/sub so a live Tier Duel vote (heard by
// DuelLiveListener, mounted once at the app root) can trigger the
// count-up animation on MyProfileScreen if it happens to be mounted at the
// same time — no global state library needed for one event type.
const listeners = new Set();

export function onDuelVoteReceived(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function emitDuelVoteReceived(payload) {
  for (const cb of listeners) cb(payload);
}
