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
    // Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { targetUserId, title, body }: Payload = await req.json();
    if (!targetUserId || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', targetUserId)
      .single();

    const token = profile?.push_token;
    if (!token || !token.startsWith('ExponentPushToken')) {
      return new Response(JSON.stringify({ sent: false, reason: 'no_token' }), { status: 200 });
    }

    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    });

    const result = await expoRes.json();
    return new Response(JSON.stringify({ sent: true, result }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
