import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'No authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(
    authHeader.replace('Bearer ', '')
  );

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete user data — explicit per-table deletes rather than relying solely on
  // FK cascades, so a schema change that drops a CASCADE doesn't silently leak data.
  // Children before parents: post_likes/post_comments reference posts, which
  // references meals; friendships/reports/blocks reference profiles directly.
  const tableDeletes = [
    supabaseAdmin.from('post_likes').delete().eq('user_id', user.id),
    supabaseAdmin.from('post_comments').delete().eq('user_id', user.id),
    supabaseAdmin.from('posts').delete().eq('user_id', user.id),
    supabaseAdmin.from('friendships').delete().or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
    supabaseAdmin.from('reports').delete().or(`reporter_id.eq.${user.id},reported_id.eq.${user.id}`),
    supabaseAdmin.from('blocks').delete().or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`),
    supabaseAdmin.from('meals').delete().eq('user_id', user.id),
  ];

  for (const result of await Promise.all(tableDeletes)) {
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Remove uploaded meal photos (stored under `${user.id}/...` in the meal-photos bucket)
  const { data: files, error: listError } = await supabaseAdmin
    .storage
    .from('meal-photos')
    .list(user.id);

  if (listError) {
    return new Response(JSON.stringify({ error: listError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (files && files.length > 0) {
    const { error: removeError } = await supabaseAdmin
      .storage
      .from('meal-photos')
      .remove(files.map((f) => `${user.id}/${f.name}`));

    if (removeError) {
      return new Response(JSON.stringify({ error: removeError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').delete().eq('id', user.id);
  if (profileError) {
    return new Response(JSON.stringify({ error: profileError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
