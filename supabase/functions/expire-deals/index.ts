import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase
    .from('deals')
    .update({ status: 'expired' })
    .lt('expires_at', new Date().toISOString())
    .eq('status', 'active')
    .select('id')

  if (error) {
    console.error('expire-deals failed:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ expired: data?.length ?? 0 }))
})