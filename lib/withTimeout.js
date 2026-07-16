// Guards against a known class of supabase-js issue where a call can
// deadlock on the client's internal session/token-refresh lock and never
// resolve — neither succeeding nor throwing — most commonly right after a
// sign-out/sign-in transition. A genuine error from the call itself still
// rejects and propagates normally; this only adds an upper bound so a true
// hang eventually rejects too, instead of leaving the `await` stuck forever.
export function withTimeout(promise, ms, message = 'Request timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}
