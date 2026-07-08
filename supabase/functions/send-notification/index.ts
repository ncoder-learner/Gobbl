import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface Payload {
  targetUserId: string;
  title: string;
  body: string;
}

Deno.serve(async (req) => {
  try {
    // Verify the caller is authenticated, and derive their id from the token
    // itself rather than trusting anything the client sends.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const senderId = authData.user.id;

    const { targetUserId, title, body }: Payload = await req.json();
    if (!targetUserId || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }

    const { data: blockRows } = await supabase
      .from('blocks')
      .select('id')
      .or(`and(blocker_id.eq.${senderId},blocked_id.eq.${targetUserId}),and(blocker_id.eq.${targetUserId},blocked_id.eq.${senderId})`)
      .limit(1);
    if (blockRows && blockRows.length > 0) {
      return new Response(JSON.stringify({ sent: false, reason: 'blocked' }), { status: 200 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', targetUserId)
      .single();

    const pushToken = profile?.push_token;
    if (!pushToken || !pushToken.startsWith('ExponentPushToken')) {
      return new Response(JSON.stringify({ sent: false, reason: 'no_token' }), { status: 200 });
    }

    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: pushToken, title, body, sound: 'default' }),
    });

    const result = await expoRes.json();
    return new Response(JSON.stringify({ sent: true, result }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
