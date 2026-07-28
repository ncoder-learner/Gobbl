import { supabase } from './supabase';
import { withTimeout } from './withTimeout';

// Completes whatever auth flow handed control back to the app via a deep
// link — Google/Apple OAuth's browser redirect, and now the email
// confirmation link too (both land here with either a PKCE `?code=` or an
// implicit-grant `#access_token=&refresh_token=` fragment; which one
// depends on the flow type configured in the Supabase dashboard, not on
// which flow triggered it, so both are always checked).
//
// Runs the instant the browser/mail-client session hands off to the
// app — exactly the moment a supabase-js client can deadlock on its
// internal session lock if a sign-out happened earlier in the same
// session. There's no user-facing UI here to "hang" if that happens — it
// would just silently never resolve — hence the timeout on every branch.
export async function completeAuthFromUrl(url) {
  if (!url) return false;

  const codeMatch = url.match(/[?&]code=([^&]+)/);
  if (codeMatch) {
    await withTimeout(
      supabase.auth.exchangeCodeForSession(codeMatch[1]),
      15000, 'Signing you in is taking too long. Please try again.',
    );
    return true;
  }

  const hashMatch = url.match(/#(.+)/);
  if (hashMatch) {
    const params = new URLSearchParams(hashMatch[1]);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      await withTimeout(
        supabase.auth.setSession({ access_token, refresh_token }),
        15000, 'Signing you in is taking too long. Please try again.',
      );
      return true;
    }
  }
  return false;
}
